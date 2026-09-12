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
import * as tradeConstants from '@/external/bot-skeleton/services/tradeEngine/trade/state/constants';

describe('automated contract gate', () => {
    const binaryMatrixPurchaseTypes = ['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER'] as const;

    afterEach(() => {
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

    it.each(binaryMatrixPurchaseTypes)(
        'allows one generated Binary Matrix %s buy per symbol and tick epoch',
        async purchaseType => {
            const xmlPath = path.resolve(__dirname, '../../../public/bots/Binary_Matrix_AI.xml');
            const xml = fs.readFileSync(xmlPath, 'utf8');
            const document = new DOMParser().parseFromString(xml, 'application/xml');
            const purchaseTypes = Array.from(document.querySelectorAll('block[type="apollo_purchase2"]')).map(block =>
                block.querySelector('field[name="PURCHASE_LIST"]')?.textContent?.trim()
            );

            expect(purchaseTypes).toEqual(['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER']);
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
            const generatedBeforePurchase = new Function(
                'Bot',
                `return (async () => Bot.purchase('${purchaseType}', undefined))();`
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

            // Keep the shared gate clean for the next generated branch case.
            settle(7002);
        }
    );
});
