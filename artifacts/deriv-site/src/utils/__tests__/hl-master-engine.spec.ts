import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { HLMasterEngine } from '@/utils/hl-master-engine';

const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

describe('HL master direct runner', () => {
    let emit: (message: Record<string, any>) => void;
    let sent: Record<string, any>[];

    beforeEach(() => {
        sent = [];
        api_base.is_authorized = true;

        const subscriptions: Array<(message: Record<string, any>) => void> = [];
        emit = message => subscriptions.forEach(callback => callback({ data: message }));

        api_base.api = {
            onMessage: () => ({
                subscribe: callback => {
                    subscriptions.push(callback);
                    return {
                        unsubscribe: () => {
                            const index = subscriptions.indexOf(callback);
                            if (index >= 0) subscriptions.splice(index, 1);
                        },
                    };
                },
            }),
            send: payload => {
                sent.push(payload);
                if (payload.ticks) {
                    queueMicrotask(() =>
                        emit({
                            msg_type: 'tick',
                            subscription: { id: 'tick-sub' },
                            tick: { epoch: 1700000000, quote: 123.456 },
                            req_id: payload.req_id,
                        })
                    );
                }
                if (payload.proposal) {
                    queueMicrotask(() =>
                        emit({
                            msg_type: 'proposal',
                            req_id: payload.req_id,
                            proposal: {
                                id: `${payload.contract_type}-proposal`,
                                ask_price: payload.amount,
                            },
                        })
                    );
                }
                if (payload.buy) {
                    queueMicrotask(() =>
                        emit({
                            msg_type: 'buy',
                            req_id: payload.req_id,
                            buy: {
                                contract_id: `${payload.buy}-contract`,
                                buy_price: payload.price,
                            },
                        })
                    );
                }
            },
        } as any;
    });

    afterEach(() => {
        api_base.api = null;
        api_base.is_authorized = false;
    });

    it('sends Higher and Lower buys at the configured stake in one pair', async () => {
        const logs: string[] = [];
        const engine = new HLMasterEngine({ symbol: '1HZ100V', stake: 0.35 });
        engine.onLog = log => logs.push(log.message);

        expect(engine.start()).toBe(true);
        await flush();
        await flush();

        const proposals = sent.filter(payload => payload.proposal);
        const buys = sent.filter(payload => payload.buy);

        expect(proposals).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    contract_type: 'HIGHER',
                    amount: 0.35,
                    barrier: '+1',
                    duration: 5,
                }),
                expect.objectContaining({
                    contract_type: 'LOWER',
                    amount: 0.35,
                    barrier: '-1',
                    duration: 5,
                }),
            ])
        );
        expect(buys).toEqual([
            expect.objectContaining({ buy: 'HIGHER-proposal', price: 0.35 }),
            expect.objectContaining({ buy: 'LOWER-proposal', price: 0.35 }),
        ]);
        expect(buys[1].req_id).toBe(buys[0].req_id + 1);
        expect(logs.some(message => message.includes('$0.70 total'))).toBe(true);

        engine.stop(false);
    });
});