jest.mock('@/utils/edging-pro-engine', () => ({
    EdgingProEngine: jest.fn().mockImplementation(config => {
        return {
            config,
            start: jest.fn(() => true),
            stop: jest.fn(),
            pause: jest.fn(),
            resume: jest.fn(),
            onLog: undefined as ((entry: { message: string; type: string }) => void) | undefined,
            onVirtualSettlement: undefined as ((settlement: any) => void) | undefined,
            onStatus: undefined as ((status: string) => void) | undefined,
            onPosition: undefined as ((position: unknown) => void) | undefined,
        };
    }),
}));

jest.mock('@/utils/store-helpers', () => ({
    helpers: {},
}));

import { observer } from '@/external/bot-skeleton/utils/observer';
import RunPanelStore from '@/stores/run-panel-store';
import { EdgingProEngine } from '@/utils/edging-pro-engine';

describe('Edging pro DBot Builder run integration', () => {
    const originalBlockly = (window as any).Blockly;

    afterEach(() => {
        observer.unregisterAll('bot.running');
        observer.unregisterAll('bot.sell');
        observer.unregisterAll('bot.stop');
        observer.unregisterAll('bot.bot_ready');
        observer.unregisterAll('bot.click_stop');
        observer.unregisterAll('bot.stop_button_click');
        observer.unregisterAll('bot.trade_again');
        observer.unregisterAll('contract.status');
        observer.unregisterAll('bot.contract');
        observer.unregisterAll('Error');
        observer.unregisterAll('bot.setPurchaseInProgress');
        (window as any).Blockly = originalBlockly;
        (EdgingProEngine as jest.Mock).mockClear();
    });

    it('reads the XML block settings and uses the normal Run-panel controls', async () => {
        const fieldValues: Record<string, string> = {
            LAST_X: '6',
            STAKE: '0.75',
            OVER_PREDICTION: '6',
            UNDER_PREDICTION: '3',
            MARTINGALE: '1.8',
            TAKE_PROFIT: '12',
            STOP_LOSS: '40',
            USE_VIRTUAL_HOOK: 'FALSE',
            VIRTUAL_LOSS_THRESHOLD: '3',
        };
        const marketBlock = {
            type: 'trade_definition_market',
            getFieldValue: (field: string) => (field === 'SYMBOL_LIST' ? '1HZ50V' : null),
        };
        const strategyBlock = {
            type: 'edging_pro_strategy',
            getFieldValue: (field: string) => fieldValues[field],
            getNextBlock: () => null,
        };
        const purchaseConditionBlock = {
            type: 'edging_pro_purchase_condition',
            getNextBlock: () => null,
        };
        const tradeDefinitionBlock = {
            type: 'trade_definition',
            getInputTargetBlock: (name: string) => (name === 'INITIALIZATION' ? strategyBlock : null),
        };
        const beforePurchaseBlock = {
            type: 'before_purchase',
            getInputTargetBlock: (name: string) =>
                name === 'BEFOREPURCHASE_STACK' ? purchaseConditionBlock : null,
        };
        (window as any).Blockly = {
            derivWorkspace: {
                getAllBlocks: () => [
                    tradeDefinitionBlock,
                    marketBlock,
                    strategyBlock,
                    beforePurchaseBlock,
                    purchaseConditionBlock,
                ],
            },
        };

        const dbot = {
            saveRecentWorkspace: jest.fn(),
            unHighlightAllBlocks: jest.fn(),
            getStrategySounds: jest.fn(() => []),
        };
        const journal = {
            pushMessage: jest.fn(),
            active_bot_template_id: 'edging-pro-engine',
        };
        const summaryCard = { clear: jest.fn(), onBotContractEvent: jest.fn() };
        const transactions = {
            onBotContractEvent: jest.fn(),
            pushVirtualHookTransaction: jest.fn(),
        };
        const ui = {
            setAccountSwitcherDisabledMessage: jest.fn(),
            setPromptHandler: jest.fn(),
        };
        const runPanel = new RunPanelStore(
            { dbot, journal, summary_card: summaryCard, transactions } as any,
            {
                client: { is_logged_in: true, currency: 'EUR' },
                common: { is_socket_opened: false },
                ui,
            } as any
        );

        await runPanel.onRunButtonClick();

        expect(EdgingProEngine).toHaveBeenCalledWith({
            symbol: '1HZ50V',
            currency: 'EUR',
            initialStake: 0.75,
            martingale: 1.8,
            takeProfit: 12,
            stopLoss: 40,
            lastX: 6,
            overPrediction: 6,
            underPrediction: 3,
            useVirtualHook: false,
            virtualLossThreshold: 3,
        });
        const engine = (EdgingProEngine as jest.Mock).mock.results[0].value;
        expect(engine.start).toHaveBeenCalledTimes(1);
        expect(runPanel.is_running).toBe(true);
        expect(ui.setAccountSwitcherDisabledMessage).toHaveBeenCalled();

        const sharedSettlement = {
            entryTickSerial: 17,
            market: '1HZ50V',
            entryEpoch: 100,
            settlementEpoch: 101,
            entrySpot: '1024.15',
            exitSpot: '1024.16',
        };
        engine.onVirtualSettlement({
            ...sharedSettlement,
            outcome: 'loss',
            contractType: 'DIGITOVER',
            prediction: 5,
        });
        engine.onVirtualSettlement({
            ...sharedSettlement,
            outcome: 'win',
            contractType: 'DIGITUNDER',
            prediction: 4,
        });
        expect(transactions.pushVirtualHookTransaction).toHaveBeenNthCalledWith(1,
            expect.objectContaining({
                journalScope: 'edging-pro',
                virtualTradeId: `edging-pro:${runPanel.run_id}:17:DIGITOVER`,
                outcome: 'loss',
                contractType: 'DIGITOVER',
                market: '1HZ50V',
                entrySpot: '1024.15',
                exitSpot: '1024.16',
            })
        );
        expect(transactions.pushVirtualHookTransaction).toHaveBeenNthCalledWith(2,
            expect.objectContaining({
                journalScope: 'edging-pro',
                virtualTradeId: `edging-pro:${runPanel.run_id}:17:DIGITUNDER`,
                outcome: 'win',
                contractType: 'DIGITUNDER',
                market: '1HZ50V',
                entrySpot: '1024.15',
                exitSpot: '1024.16',
            })
        );

        runPanel.onPauseButtonClick();
        expect(engine.pause).toHaveBeenCalledTimes(1);
        expect(runPanel.is_paused).toBe(true);

        runPanel.onStopButtonClick();
        expect(engine.stop).toHaveBeenCalledTimes(1);
        engine.onStatus('stopped');
        expect(runPanel.is_running).toBe(false);
        expect(runPanel.native_edging_pro_engine).toBeNull();
    });
});