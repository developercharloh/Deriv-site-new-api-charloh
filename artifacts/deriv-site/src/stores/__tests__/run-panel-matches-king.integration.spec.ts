jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: null, is_authorized: true, account_info: {} },
}));
jest.mock('@/utils/store-helpers', () => ({ helpers: {} }));

import RunPanelStore from '@/stores/run-panel-store';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { contract_stages } from '@/constants/contract-stage';

describe('Matches King Stop with real contract tracking', () => {
    const originalBlockly = (window as any).Blockly;
    const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    let panel: RunPanelStore;
    let listener: ((message: any) => void) | undefined;
    let sent: any[];
    let lockHeld: boolean;
    let unsubscribe: jest.Mock;
    let fields: Record<string, string>;

    beforeEach(() => {
        jest.useFakeTimers();
        sent = [];
        lockHeld = false;
        unsubscribe = jest.fn(() => { listener = undefined; });
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: {
                request: async (name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) => {
                    lockHeld = true;
                    try { await callback({ name }); } finally { lockHeld = false; }
                },
            },
        });
        (api_base as any).api = {
            send: (request: any) => sent.push(request),
            balance: jest.fn().mockResolvedValue({}),
            onMessage: () => ({
                subscribe: (callback: (message: any) => void) => {
                    listener = callback;
                    return { unsubscribe };
                },
            }),
        };
        fields = {
            DIGIT_COUNT: '2', DIGIT_1: '4', DIGIT_2: '7', STAKE: '0.5',
            MARTINGALE: '2', TAKE_PROFIT: '100', STOP_LOSS: '100', VIRTUAL_LOSS_THRESHOLD: '1',
        };
        const strategy = {
            type: 'matches_king_strategy',
            getFieldValue: (name: string) => fields[name],
            getNextBlock: () => null,
        };
        const condition = { type: 'matches_king_purchase_condition', getNextBlock: () => null };
        (window as any).Blockly = {
            derivWorkspace: {
                getAllBlocks: () => [
                    strategy, condition,
                    { type: 'trade_definition', getInputTargetBlock: () => strategy },
                    { type: 'before_purchase', getInputTargetBlock: () => condition },
                    { type: 'trade_definition_market', getFieldValue: () => '1HZ75V' },
                ],
            },
        };
        panel = new RunPanelStore({
            dbot: {},
            journal: { pushMessage: jest.fn() },
            transactions: { onBotContractEvent: jest.fn() },
        } as any, {
            client: { loginid: 'VRTC_MATCHES_TEST', currency: 'USD' },
            common: { is_socket_opened: false },
            ui: { setPromptHandler: jest.fn(), setAccountSwitcherDisabledMessage: jest.fn() },
        } as any);
        expect(panel.startNativeMatchesKingBot()).toBe(true);
    });

    afterEach(() => {
        panel.native_matches_king_engine?.stop();
        panel.disposeReactionsFn();
        (window as any).Blockly = originalBlockly;
        if (locksDescriptor) Object.defineProperty(navigator, 'locks', locksDescriptor);
        else delete (navigator as any).locks;
        (api_base as any).api = null;
        delete (globalThis as any).__DERIV_AUTOMATED_CONTRACT_GATE__;
        jest.useRealTimers();
    });

    const tick = (epoch: number, quote = 100.01) => {
        const request = sent.find(item => item.ticks_history);
        listener!({
            data: {
                msg_type: 'tick', req_id: request.req_id,
                subscription: { id: 'ticks-test' },
                tick: { quote, pip_size: 2, epoch },
            },
        });
    };

    it.each(['TRUE', 'FALSE', undefined])('reads Use Virtual Hook=%s from Blockly and routes real entries correctly', async value => {
        panel.native_matches_king_engine?.stop();
        await Promise.resolve();
        if (value === undefined) delete fields.USE_VIRTUAL_HOOK;
        else fields.USE_VIRTUAL_HOOK = value;
        sent = [];
        expect(panel.startNativeMatchesKingBot()).toBe(true);
        tick(1);
        expect(sent.filter(request => request.proposal === 1)).toHaveLength(value === 'FALSE' ? 2 : 0);
        if (value !== 'FALSE') {
            tick(2);
            tick(3);
            expect(sent.filter(request => request.proposal === 1)).toHaveLength(2);
        }
        panel.onStopBotClick();
        // Resolve the outstanding proposals with rejection, so no live buy is
        // accepted and the stopping engine can release its resources.
        sent.filter(request => request.proposal === 1).forEach(request => listener?.({
            data: { req_id: request.req_id, error: { message: 'Stopped test proposal' } },
        }));
        await Promise.resolve();
        await Promise.resolve();
    });

    it.each(['scanning', 'paused'])('stops via the visible control while %s and releases the lock', async mode => {
        if (mode === 'paused') panel.onPauseButtonClick();
        panel.onStopBotClick();
        await Promise.resolve();
        await Promise.resolve();
        expect(panel.is_running).toBe(false);
        expect(panel.is_paused).toBe(false);
        expect(panel.is_stop_button_visible).toBe(false);
        expect(panel.native_matches_king_engine).toBeNull();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(lockHeld).toBe(false);
    });

    it('uses numeric broker IDs, receives all outcomes after Stop, and returns the panel to Run', async () => {
        tick(1); // virtual entry
        tick(2); // virtual loss
        tick(3); // real batch
        const proposals = sent.filter(item => item.proposal === 1);
        expect(proposals).toHaveLength(2);
        proposals.forEach((request, index) => listener!({
            data: {
                msg_type: 'proposal', req_id: request.req_id,
                proposal: { id: `proposal-${index}`, ask_price: 0.5, payout: 3.52 },
            },
        }));
        const buys = sent.filter(item => item.buy);
        expect(buys).toHaveLength(2);
        expect(panel.is_stop_button_disabled).toBe(false);
        panel.onPauseButtonClick();
        panel.onStopBotClick(); // buy acknowledgements have not arrived yet
        expect(panel.is_native_bot_stopping).toBe(true);
        expect(panel.is_paused).toBe(false);
        expect(panel.contract_stage).toBe(contract_stages.IS_STOPPING);
        buys.forEach((request, index) => listener!({
            data: {
                msg_type: 'buy', req_id: request.req_id,
                buy: { contract_id: 20705121999 + index, buy_price: 0.5, payout: 3.52 },
            },
        }));
        await Promise.resolve();
        const tracking = sent.filter(item => item.proposal_open_contract);
        expect(tracking).toHaveLength(2);
        tracking.forEach(request => {
            expect(Number.isSafeInteger(request.contract_id)).toBe(true);
        });
        expect(panel.native_matches_king_engine).not.toBeNull();
        tracking.forEach((request, index) => listener!({
            data: {
                msg_type: 'proposal_open_contract', req_id: request.req_id,
                subscription: { id: `position-${index}` },
                proposal_open_contract: {
                    contract_id: request.contract_id, is_sold: 1, status: 'lost',
                    profit: -0.5, entry_tick: 100.01, exit_tick: 100.02,
                },
            },
        }));
        await Promise.resolve();
        await Promise.resolve();
        expect(panel.is_running).toBe(false);
        expect(panel.is_stop_button_visible).toBe(false);
        expect(panel.native_matches_king_engine).toBeNull();
        expect(panel.is_native_bot_stopping).toBe(false);
        expect(lockHeld).toBe(false);
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(sent.filter(item => item.buy)).toHaveLength(2);
        expect((panel.root_store.transactions.onBotContractEvent as jest.Mock).mock.calls
            .filter(([event]) => event.status === 'lost' && event.is_expired)).toHaveLength(2);
    });
});
