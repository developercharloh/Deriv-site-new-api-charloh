const mockTraderInstances: any[] = [];
let mockBuyBatchPromise: Promise<any> | null = null;

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: {}, is_authorized: true },
}));

jest.mock('@/utils/bot-contract-gate', () => ({
    tryAcquireBotContractGate: jest.fn(() => true),
    releaseBotContractGate: jest.fn(),
}));

jest.mock('@/utils/dtrader-engine', () => ({
    DTraderEngine: jest.fn().mockImplementation(() => {
        const trader = {
            onTick: (_spot: string, _digit: number, _epoch?: number, _tickId?: string) => {},
            onPosition: (_position: unknown) => {},
            onStatus: (_status: string) => {},
            onLog: (_log: unknown) => {},
            start: jest.fn(),
            stop: jest.fn(),
            buyDigitBatchNow: jest.fn(() =>
                mockBuyBatchPromise ??
                Promise.resolve({
                    accepted: [{ side: '7', contractId: 'contract-7', buyPrice: 0.5, payout: 0.9, stake: 0.5 }],
                    failed: [],
                })
            ),
        };
        mockTraderInstances.push(trader);
        return trader;
    }),
}));

import { MatchesKingEngine, type MatchesKingConfig } from '@/utils/matches-king-engine';

const config: MatchesKingConfig = {
    symbol: '1HZ75V',
    currency: 'USD',
    accountId: 'VRTC_MATCHES_KING_TEST',
    digits: [7],
    stake: 0.5,
    martingale: 2,
    takeProfit: 10,
    stopLoss: 30,
    virtualLossThreshold: 1,
};

const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

describe('MatchesKingEngine stop lifecycle', () => {
    beforeEach(() => {
        mockTraderInstances.length = 0;
        mockBuyBatchPromise = null;
    });

    it.each([false, true])('stops immediately while scanning or paused=%s', paused => {
        const engine = new MatchesKingEngine(config);
        const trader = mockTraderInstances[0];
        const statuses: string[] = [];
        const releaseLock = jest.fn();
        engine.onStatus = status => statuses.push(status);
        (engine as any).running = true;
        (engine as any).paused = paused;
        (engine as any).releaseLock = releaseLock;

        engine.stop();

        expect(statuses).toEqual(['stopped']);
        expect((engine as any).running).toBe(false);
        expect((engine as any).paused).toBe(false);
        expect(trader.stop).toHaveBeenCalledTimes(1);
        expect(releaseLock).toHaveBeenCalledTimes(1);
    });

    it('keeps tracking accepted contracts and stops after their settlement', () => {
        const engine = new MatchesKingEngine(config);
        const trader = mockTraderInstances[0];
        const statuses: string[] = [];
        const releaseLock = jest.fn();
        engine.onStatus = status => statuses.push(status);
        (engine as any).running = true;
        (engine as any).paused = true;
        (engine as any).releaseLock = releaseLock;
        (engine as any).liveBatch = {
            acceptedIds: ['contract-7'],
            positions: new Map(),
            buyComplete: true,
            partial: false,
        };

        engine.stop();

        expect(statuses).toEqual(['stopping']);
        expect(trader.stop).not.toHaveBeenCalled();
        expect(releaseLock).not.toHaveBeenCalled();

        trader.onPosition({ contractId: 'contract-7', isOpen: false, profit: -0.5 });

        expect(statuses).toEqual(['stopping', 'stopped']);
        expect(trader.stop).toHaveBeenCalledTimes(1);
        expect(releaseLock).toHaveBeenCalledTimes(1);
    });

    it('reconciles a settled batch immediately when Stop is pressed', () => {
        const engine = new MatchesKingEngine(config);
        const trader = mockTraderInstances[0];
        (engine as any).running = true;
        (engine as any).liveBatch = {
            acceptedIds: ['contract-7'],
            positions: new Map([
                ['contract-7', { contractId: 'contract-7', isOpen: false, profit: -0.5 }],
            ]),
            buyComplete: true,
            partial: false,
        };
        const statuses: string[] = [];
        engine.onStatus = status => statuses.push(status);

        engine.stop();

        expect(statuses).toEqual(['stopped']);
        expect(trader.stop).toHaveBeenCalledTimes(1);
        expect((engine as any).liveBatch).toBeNull();
    });

    it('prevents new entries while a buy is completing and stops after accepted contracts settle', async () => {
        let resolveBuy!: (value: any) => void;
        mockBuyBatchPromise = new Promise(resolve => {
            resolveBuy = resolve;
        });
        const engine = new MatchesKingEngine(config);
        const trader = mockTraderInstances[0];
        const statuses: string[] = [];
        engine.onStatus = status => statuses.push(status);
        (engine as any).running = true;
        (engine as any).latestEpoch = 10;

        const buying = (engine as any).buyLiveBatch(10);
        await flushPromises();
        engine.stop();
        expect(statuses).toContain('stopping');
        expect(trader.stop).not.toHaveBeenCalled();
        const guard = trader.buyDigitBatchNow.mock.calls[0][1];
        expect(guard()).not.toBeNull();
        trader.onTick('100.08', 8, 11);
        expect(trader.buyDigitBatchNow).toHaveBeenCalledTimes(1);

        resolveBuy({
            accepted: [{ side: '7', contractId: 'contract-7', buyPrice: 0.5, payout: 0.9, stake: 0.5 }],
            failed: [],
        });
        await buying;
        expect((engine as any).running).toBe(false);
        expect(statuses[statuses.length - 1]).toBe('stopping');

        trader.onPosition({ contractId: 'contract-7', isOpen: false, profit: -0.5 });
        expect(statuses[statuses.length - 1]).toBe('stopped');
        expect(trader.stop).toHaveBeenCalledTimes(1);
    });
});
