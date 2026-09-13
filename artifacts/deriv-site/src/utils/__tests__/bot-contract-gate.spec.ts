import fs from 'node:fs';
import path from 'node:path';

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: {
        api: null,
        account_info: { loginid: 'VRTC-BINARY-MATRIX' },
        subscriptions: [],
        is_authorized: true,
        pushSubscription(subscription) {
            this.subscriptions.push(subscription);
        },
        clearSubscriptions() {
            this.subscriptions = [];
        },
    },
}));

import {
    markBotTick,
    releaseBotContractGate,
    setBotContractGateContract,
    tryAcquireBotContractGate,
} from '@/utils/bot-contract-gate';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import TradeEngine from '@/external/bot-skeleton/services/tradeEngine/trade';
import getBotInterface from '@/external/bot-skeleton/services/tradeEngine/Interface/BotInterface';
import { createDetails } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import * as tradeConstants from '@/external/bot-skeleton/services/tradeEngine/trade/state/constants';

describe('generated bot settlement results', () => {
    const contract = (profit: number) => ({
        buy_price: 0.5,
        sell_price: profit > 0 ? 1 : 0,
        profit,
        currency: 'USD',
        contract_type: 'DIGITEVEN',
        transaction_ids: { buy: 'test-buy' },
        entry_tick_time: 1700000000,
        exit_tick_time: 1700000001,
        entry_tick: 1,
        exit_tick: 2,
        barrier: '',
    });

    it('reads the last settled result instead of the currently open contract', () => {
        const engine: any = {
            data: { contract: contract(-0.5) },
            lastSettledContract: null,
        };
        const bot = getBotInterface(engine);

        // No settlement yet: keep the initial stake path.
        expect(bot.isResult('win')).toBe(true);
        expect(bot.isResult('loss')).toBe(false);

        // An open winning contract must not be mistaken for the result.
        engine.lastSettledContract = contract(-0.5);
        engine.data.contract = contract(0.5);
        expect(bot.isResult('loss')).toBe(true);
        expect(bot.isResult('win')).toBe(false);

        // A settled win resets the next stake path.
        engine.lastSettledContract = contract(0.5);
        expect(bot.isResult('win')).toBe(true);
        expect(bot.isResult('loss')).toBe(false);
    });

    it('keeps Binary Matrix stake progression authoritative in FAST', () => {
        const previousBlockly = window.Blockly;
        const workspace = {
            getAllBlocks: () => [
                { type: 'last_digits_condition' },
                {
                    type: 'variables_set',
                    getFieldValue: () => 'martingale-id',
                    getInputTargetBlock: (name: string) =>
                        name === 'VALUE'
                            ? {
                                type: 'math_number_positive',
                                getFieldValue: () => '2',
                            }
                            : null,
                },
            ],
            getVariableById: (id: string) => id === 'martingale-id' ? { name: 'Martingale' } : null,
        };
        (window as any).Blockly = { derivWorkspace: workspace };

        const engine: any = Object.create(TradeEngine.prototype);
        engine.binaryMatrixStakeState = null;

        expect(engine.getBinaryMatrixTradeOptions({ amount: 0.5 }).amount).toBe(0.5);
        engine.applyBinaryMatrixSettlement({ buy_price: 0.5, sell_price: 0, profit: -0.5 });
        expect(engine.getBinaryMatrixTradeOptions({ amount: 0.5 }).amount).toBe(1);
        engine.applyBinaryMatrixSettlement({ buy_price: 1, sell_price: 1.85, profit: 0.85 });
        expect(engine.getBinaryMatrixTradeOptions({ amount: 1 }).amount).toBe(0.5);

        (window as any).Blockly = previousBlockly;
    });

    it('counts only settled Binary Matrix wins and requests repeated re-analysis', () => {
        const previousBlockly = window.Blockly;
        const workspace = {
            getAllBlocks: () => [
                { type: 'last_digits_condition' },
                {
                    type: 'variables_set',
                    getFieldValue: () => 'reanalysis-id',
                    getInputTargetBlock: (name: string) =>
                        name === 'VALUE'
                            ? {
                                type: 'math_number',
                                getFieldValue: () => '2',
                            }
                            : null,
                },
            ],
            getVariableById: (id: string) => id === 'reanalysis-id' ? { name: 'Re Analyse After' } : null,
        };
        (window as any).Blockly = { derivWorkspace: workspace };

        const engine: any = Object.create(TradeEngine.prototype);
        engine.options = { symbol: 'R_25' };
        engine.symbol = 'R_25';
        engine.latestTick = { epoch: 101 };
        engine.binaryMatrixStakeState = {
            initialStake: 0.5,
            currentStake: 0.5,
            multiplier: 2,
            winsSinceAnalysis: 0,
            reanalysisPending: false,
            reanalysisBlockedEpoch: null,
        };
        engine.isBinaryMatrixWorkspace = TradeEngine.prototype.isBinaryMatrixWorkspace;
        engine.readBinaryMatrixNumberVariable = TradeEngine.prototype.readBinaryMatrixNumberVariable;

        engine.applyBinaryMatrixSettlement({ buy_price: 0.5, sell_price: 1, profit: 0.5 });
        expect(engine.binaryMatrixStakeState.winsSinceAnalysis).toBe(1);
        expect(engine.binaryMatrixStakeState.reanalysisPending).toBe(false);

        engine.latestTick = { epoch: 102 };
        engine.applyBinaryMatrixSettlement({ buy_price: 0.5, sell_price: 1, profit: 0.5 });
        expect(engine.binaryMatrixStakeState.winsSinceAnalysis).toBe(0);
        expect(engine.binaryMatrixStakeState.reanalysisPending).toBe(true);
        expect(engine.binaryMatrixStakeState.reanalysisBlockedEpoch).toBe(102);

        (window as any).Blockly = previousBlockly;
    });

    it('does not change ordinary DBot stake options', () => {
        const previousBlockly = window.Blockly;
        const tradeOptions = {
            amount: 0.5,
            basis: 'stake',
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
            symbol: 'R_25',
        };
        (window as any).Blockly = {
            derivWorkspace: {
                getAllBlocks: () => [{ type: 'trade_definition_tradeoptions' }],
            },
        };

        const engine: any = Object.create(TradeEngine.prototype);
        engine.binaryMatrixStakeState = null;

        expect(engine.getBinaryMatrixTradeOptions(tradeOptions)).toEqual(tradeOptions);
        engine.applyBinaryMatrixSettlement({ buy_price: 0.5, sell_price: 0, profit: -0.5 });
        expect(engine.binaryMatrixStakeState).toBeNull();

        (window as any).Blockly = previousBlockly;
    });

    it('carries Binary Matrix Martingale through the generated FAST loop and broker settlements', async () => {
        window.localStorage.setItem('dbot_execution_speed', 'fast');
        const previousBlockly = window.Blockly;
        const xmlPath = path.resolve(__dirname, '../../../public/bots/Binary_Matrix_AI.xml');
        const xml = fs.readFileSync(xmlPath, 'utf8');
        const document = new DOMParser().parseFromString(xml, 'application/xml');
        const martingaleVariable = Array.from(document.querySelectorAll('variable')).find(
            variable => variable.textContent?.trim() === 'Martingale'
        );
        const martingaleId = martingaleVariable?.getAttribute('id');
        const martingaleSetter = Array.from(document.querySelectorAll('block[type="variables_set"]')).find(
            block => block.querySelector('field[name="VAR"]')?.getAttribute('id') === martingaleId
        );
        const martingaleValue = martingaleSetter?.querySelector('value[name="VALUE"] field[name="NUM"]')?.textContent?.trim();
        const purchaseType =
            document.querySelector('block[type="apollo_purchase2"] field[name="PURCHASE_LIST"]')?.textContent?.trim() ??
            'DIGITEVEN';

        expect(martingaleId).toBeTruthy();
        expect(martingaleValue).toBe('2');
        expect(document.querySelector('block[type="trade_again"]')).not.toBeNull();

        const blockTypes = Array.from(document.querySelectorAll('block')).map(block => block.getAttribute('type'));
        const workspace = {
            getAllBlocks: () => blockTypes.map(type => ({ type })),
            getVariableById: (id: string) => (id === martingaleId ? { name: 'Martingale' } : null),
        };
        (window as any).Blockly = { derivWorkspace: workspace };

        const subscriptions: Array<(message: { data: Record<string, any> }) => void> = [];
        const sent: Array<Record<string, any>> = [];
        const buyAmounts: number[] = [];
        const cycleDoneResolvers: Array<() => void> = [];
        let nextContractId = 8101;
        const settlementProfits = [-0.5, 0.85, 0.85];
        const api = {
            onMessage: () => ({
                subscribe: (callback: (message: { data: Record<string, any> }) => void) => {
                    subscriptions.push(callback);
                    return {
                        unsubscribe: () => {
                            const index = subscriptions.indexOf(callback);
                            if (index >= 0) subscriptions.splice(index, 1);
                        },
                    };
                },
            }),
            send: jest.fn(),
        };

        api_base.api = api;
        api_base.account_info = { loginid: 'VRTC-BINARY-MATRIX' };
        api_base.subscriptions = [];
        api_base.is_stopping = false;
        api_base.is_running = true;

        const emit = (data: Record<string, any>) => {
            [...subscriptions].forEach(subscription => subscription({ data }));
        };

        (api.send as jest.Mock).mockImplementation((payload: Record<string, any>) => {
            sent.push(payload);
            if (payload.buy) {
                const contractId = nextContractId++;
                buyAmounts.push(Number(payload.price));
                return Promise.resolve({
                    buy: {
                        transaction_id: `transaction-${contractId}`,
                        contract_id: contractId,
                        buy_price: payload.price,
                        payout: Number(payload.price) + 0.85,
                    },
                });
            }

            if (payload.proposal_open_contract) {
                const contractId = Number(payload.contract_id);
                const buyIndex = contractId - 8101;
                const buyPrice = buyAmounts[buyIndex];
                const profit = settlementProfits[buyIndex];
                setTimeout(() => {
                    emit({
                        msg_type: 'proposal_open_contract',
                        proposal_open_contract: {
                            contract_id: contractId,
                            is_sold: 1,
                            is_expired: 1,
                            is_valid_to_sell: 0,
                            buy_price: buyPrice,
                            sell_price: buyPrice + profit,
                            profit,
                            currency: 'USD',
                            contract_type: purchaseType,
                            transaction_ids: {
                                buy: `transaction-${contractId}`,
                                sell: `sell-${contractId}`,
                            },
                            entry_tick_time: 1700000000 + buyIndex,
                            exit_tick_time: 1700000001 + buyIndex,
                            entry_tick: 1,
                            exit_tick: 2,
                            barrier: '',
                        },
                    });
                    setTimeout(() => {
                        engine.store.dispatch({
                            type: buyIndex < 2 ? tradeConstants.FAST_REARM : tradeConstants.SELL,
                        });
                        cycleDoneResolvers.shift()?.();
                    }, 0);
                }, 0);
            }

            return Promise.resolve({});
        });

        const engine: any = new TradeEngine({
            observer: {
                emit: jest.fn(),
                register: jest.fn(),
            },
            ticksService: {},
        });
        engine.options = {
            symbol: 'R_25',
            timeMachineEnabled: false,
            shouldRestartOnError: false,
        };
        engine.accountInfo = api_base.account_info;
        engine.is_proposal_subscription_required = false;

        engine.startFastClock = jest.fn(() => {
            // The real clock releases the first FAST slot after its interval.
            // Keep that first release deterministic; settled contracts release
            // the following slots through the mocked broker cycle below.
            engine.fastClockActive = true;
            setTimeout(() => engine.store.dispatch({ type: tradeConstants.FAST_REARM }), 0);
        });

        const waitForCycle = () =>
            new Promise<void>(resolve => {
                cycleDoneResolvers.push(resolve);
            });

        // This is the control flow emitted by the loaded Binary Matrix
        // trade-definition, purchase, and trade-again blocks. Native async
        // calls keep the test boundary deterministic while preserving the
        // generated before/during scope transitions.
        const bot = getBotInterface(engine);
        for (let cycle = 0; cycle < 3; cycle += 1) {
            bot.start({
                limitations: {},
                duration: 1,
                duration_unit: 't',
                currency: 'USD',
                amount: +(Number(0.5).toFixed(2)),
                basis: 'stake',
            });
            const cycleDone = waitForCycle();
            expect(await engine.watch('before')).toBe(true);
            await bot.purchase(purchaseType);
            const during = engine.watch('during');
            await cycleDone;
            await expect(during).resolves.toBe(false);
        }
        bot.isTradeAgain(false);

        expect(buyAmounts).toEqual([0.5, 1, 0.5]);
        expect(sent.filter(payload => payload.buy).map(payload => payload.parameters.amount)).toEqual([0.5, 1, 0.5]);
        expect(engine.lastSettledContract.profit).toBe(0.85);
        expect(engine.binaryMatrixStakeState.currentStake).toBe(0.5);

        engine.stopFastClock();
        (window as any).Blockly = previousBlockly;
    });
});

describe('automated contract gate', () => {
    const binaryMatrixPurchaseTypes = ['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER'] as const;

    it.each([
        [{ buy_price: 0.5, sell_price: 0.5, profit: -0.5 }, 'loss'],
        [{ buy_price: 0.5, sell_price: 0.5, profit: 0 }, 'loss'],
        [{ buy_price: 0.5, sell_price: 1.5, profit: 1 }, 'win'],
    ])('classifies the reported settlement profit correctly: %j', (contract, expectedResult) => {
        const details = createDetails({
            ...contract,
            currency: 'USD',
            transaction_ids: { buy: 'buy-test' },
        });

        expect(details[10]).toBe(expectedResult);
    });

    afterEach(() => {
        window.localStorage.removeItem('dbot_execution_speed');
        api_base.api = null;
        api_base.subscriptions = [];
    });

    it('allows only one owner until that owner settles', () => {
        const firstRunner = {};
        const secondRunner = {};

        expect(tryAcquireBotContractGate(firstRunner)).toBe(true);
        setBotContractGateContract(firstRunner, 12345);
        expect(tryAcquireBotContractGate(secondRunner)).toBe(false);

        releaseBotContractGate(firstRunner, 99999);
        expect(tryAcquireBotContractGate(secondRunner)).toBe(false);

        releaseBotContractGate(firstRunner, 12345);
        expect(tryAcquireBotContractGate(secondRunner)).toBe(true);
        releaseBotContractGate(secondRunner);
    });

    it('does not allow a second purchase on the same tick after settlement', () => {
        const firstRunner = {};
        const secondRunner = {};

        markBotTick('R_25', 100);
        expect(tryAcquireBotContractGate(firstRunner)).toBe(true);
        setBotContractGateContract(firstRunner, 54321);
        releaseBotContractGate(firstRunner, 54321);

        expect(tryAcquireBotContractGate(secondRunner)).toBe(false);

        markBotTick('R_25', 101);
        expect(tryAcquireBotContractGate(secondRunner)).toBe(true);
        releaseBotContractGate(secondRunner);
    });

    it('allows exactly one FAST re-entry immediately after settlement', () => {
        window.localStorage.setItem('dbot_execution_speed', 'fast');
        const firstRunner = {};
        const secondRunner = {};
        const signalKey = 'R_25:150';

        markBotTick('R_25', 150);
        expect(tryAcquireBotContractGate(firstRunner)).toBe(true);
        setBotContractGateContract(firstRunner, 7001);
        expect(releaseBotContractGate(firstRunner, 7001, signalKey, true)).toBe(true);

        expect(tryAcquireBotContractGate(firstRunner, signalKey)).toBe(true);
        setBotContractGateContract(firstRunner, 7002);
        expect(tryAcquireBotContractGate(secondRunner, signalKey)).toBe(false);
        expect(releaseBotContractGate(firstRunner, 7002, signalKey, true)).toBe(true);
        expect(tryAcquireBotContractGate(secondRunner, signalKey)).toBe(true);
        releaseBotContractGate(secondRunner);
    });

    it('never allows a new contract while another contract is open', () => {
        window.localStorage.setItem('dbot_execution_speed', 'fast');
        const runner = {};
        const duplicateRunner = {};

        markBotTick('R_25', 200);
        expect(tryAcquireBotContractGate(runner)).toBe(true);
        setBotContractGateContract(runner, 6001);

        markBotTick('R_25', 201);
        expect(tryAcquireBotContractGate(runner)).toBe(false);

        expect(tryAcquireBotContractGate(duplicateRunner, 'R_25:201')).toBe(false);

        releaseBotContractGate(runner, 6001);
        expect(tryAcquireBotContractGate(duplicateRunner)).toBe(true);
        releaseBotContractGate(duplicateRunner);
    });

    it('does not release a FAST slot while the engine still has an active contract', () => {
        jest.useFakeTimers();
        const engine: any = Object.create(TradeEngine.prototype);
        engine.store = { dispatch: jest.fn() };
        engine.getActiveContractIds = jest.fn(() => ['7001']);

        try {
            engine.startFastClock();
            expect(engine.store.dispatch).not.toHaveBeenCalled();

            engine.getActiveContractIds.mockReturnValue([]);
            jest.advanceTimersByTime(2000);
            expect(engine.store.dispatch).toHaveBeenCalledWith({ type: tradeConstants.FAST_REARM });
        } finally {
            engine.stopFastClock();
            jest.useRealTimers();
        }
    });

    it.each(binaryMatrixPurchaseTypes)(
        'allows one generated Binary Matrix %s buy per symbol and tick epoch',
        async purchaseType => {
            const xmlPath = path.resolve(__dirname, '../../../public/bots/Binary_Matrix_AI.xml');
            const xml = fs.readFileSync(xmlPath, 'utf8');
            const document = new DOMParser().parseFromString(xml, 'application/xml');
            const purchaseTypes = Array.from(document.querySelectorAll('block[type="apollo_purchase2"]')).map(block =>
                block.querySelector('field[name="PURCHASE_LIST"]')?.textContent?.trim()
            );
            const predictions = new Map(
                Array.from(document.querySelectorAll('block[type="apollo_purchase2"]')).map(block => [
                    block.querySelector('field[name="PURCHASE_LIST"]')?.textContent?.trim(),
                    block.querySelector('value[name="PREDICTION"] field[name="NUM"]')?.textContent?.trim(),
                ])
            );

            expect(purchaseTypes).toEqual(['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER']);
            expect(predictions.get('DIGITOVER')).toBe('4');
            expect(predictions.get('DIGITUNDER')).toBe('5');
            expect(purchaseTypes).toContain(purchaseType);
            expect(document.querySelector('block[type="trade_again"]')).not.toBeNull();

            const subscriptions: Array<(message: { data: Record<string, any> }) => void> = [];
            const sent: Array<Record<string, any>> = [];
            let nextContractId = 7001;
            const api = {
                onMessage: () => ({
                    subscribe: (callback: (message: { data: Record<string, any> }) => void) => {
                        subscriptions.push(callback);
                        return {
                            unsubscribe: () => {
                                const index = subscriptions.indexOf(callback);
                                if (index >= 0) subscriptions.splice(index, 1);
                            },
                        };
                    },
                }),
                send: jest.fn(),
            };

            api_base.api = api;
            api_base.account_info = { loginid: 'VRTC-BINARY-MATRIX' };
            api_base.subscriptions = [];

            const engine = new TradeEngine({
                observer: {
                    emit: jest.fn(),
                    register: jest.fn(),
                },
                ticksService: {},
            });
            engine.options = {
                symbol: 'R_25',
                timeMachineEnabled: false,
            };
            engine.tradeOptions = {
                amount: 0.5,
                basis: 'stake',
                currency: 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: 'R_25',
            };
            engine.accountInfo = api_base.account_info;
            engine.is_proposal_subscription_required = false;
            const bot = getBotInterface(engine);
            const prediction = predictions.get(purchaseType) ?? 'undefined';
            const generatedBeforePurchase = new Function(
                'Bot',
                `return (async () => Bot.purchase('${purchaseType}', ${prediction}))();`
            );
            const generatedTradeAgain = new Function(
                'Bot',
                'return (() => { Bot.isTradeAgain(true); return true; })();'
            );

            const buyRequests: Array<{ symbol: string; epoch: number }> = [];
            const sendBuy = api.send as jest.Mock;
            sendBuy.mockImplementation((payload: Record<string, any>) => {
                sent.push(payload);
                if (!payload.buy) return Promise.resolve({});

                buyRequests.push({
                    symbol: payload.parameters.underlying_symbol,
                    epoch: engine.store.getState().newTick,
                });
                const contractId = nextContractId++;
                return Promise.resolve({
                    buy: {
                        transaction_id: `transaction-${contractId}`,
                        contract_id: contractId,
                        buy_price: payload.price,
                        payout: 0.95,
                    },
                });
            });

            const emit = (data: Record<string, any>) => {
                [...subscriptions].forEach(subscription => subscription({ data }));
            };
            const settle = (contractId: number) => {
                emit({
                    msg_type: 'proposal_open_contract',
                    proposal_open_contract: {
                        contract_id: contractId,
                        is_sold: 1,
                        is_expired: 1,
                        is_valid_to_sell: 0,
                        buy_price: 0.5,
                        sell_price: 0,
                        currency: 'USD',
                        transaction_ids: { sell: `sell-${contractId}` },
                    },
                });
            };

            const firstEpoch = 700 + binaryMatrixPurchaseTypes.indexOf(purchaseType) * 2;
            engine.store.dispatch({ type: tradeConstants.START });
            engine.store.dispatch({ type: tradeConstants.NEW_TICK, payload: firstEpoch });
            await generatedBeforePurchase(bot);
            expect(buyRequests).toEqual([{ symbol: 'R_25', epoch: firstEpoch }]);

            settle(7001);
            expect(generatedTradeAgain(bot)).toBe(true);

            // The generated outer loop starts the before-purchase phase again without
            // receiving a new tick. The gate must reject that re-entry.
            engine.store.dispatch({ type: tradeConstants.START });
            await generatedBeforePurchase(bot);
            expect(buyRequests).toEqual([{ symbol: 'R_25', epoch: firstEpoch }]);

            engine.store.dispatch({ type: tradeConstants.NEW_TICK, payload: firstEpoch + 1 });
            await generatedBeforePurchase(bot);
            expect(buyRequests).toEqual([
                { symbol: 'R_25', epoch: firstEpoch },
                { symbol: 'R_25', epoch: firstEpoch + 1 },
            ]);

            expect(
                sent.filter(payload => payload.buy).map(payload => payload.parameters.underlying_symbol)
            ).toEqual(['R_25', 'R_25']);
            expect(sent.filter(payload => payload.buy).map(payload => payload.parameters.contract_type)).toEqual([
                purchaseType,
                purchaseType,
            ]);
            if (purchaseType === 'DIGITOVER' || purchaseType === 'DIGITUNDER') {
                expect(sent.filter(payload => payload.buy).map(payload => payload.parameters.barrier)).toEqual(
                    purchaseType === 'DIGITOVER' ? [4, 4] : [5, 5]
                );
            }

            // Keep the shared gate clean for the next generated branch case.
            settle(7002);
        }
    );

    it('re-enters condition scanning after the configured re-analysis reset', () => {
        const xmlPath = path.resolve(__dirname, '../../../public/bots/Binary_Matrix_AI.xml');
        const xml = fs.readFileSync(xmlPath, 'utf8');
        const document = new DOMParser().parseFromString(xml, 'application/xml');
        const beforePurchase = document.querySelector('block[type="before_purchase"]');

        expect(beforePurchase).not.toBeNull();
        expect(beforePurchase?.querySelector('block[type="controls_whileUntil"]')).not.toBeNull();
        expect(beforePurchase?.querySelectorAll('block[type="last_digits_condition"]')).toHaveLength(4);
    });
});
