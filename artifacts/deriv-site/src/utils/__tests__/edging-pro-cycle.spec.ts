const mockTraderInstances: any[] = [];

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: {}, is_authorized: true },
}));

jest.mock('@/utils/dtrader-engine', () => ({
    DTraderEngine: jest.fn().mockImplementation(() => {
        const trader = {
            onTick: (_spot: string, _digit: number) => {},
            onPosition: (_position: unknown) => {},
            onStatus: (_status: string) => {},
            onLog: (_log: unknown) => {},
            start: jest.fn(),
            stop: jest.fn(),
            quoteDigitPair: jest.fn().mockResolvedValue({
                quotes: [
                    { side: 'over', askPrice: 0.5, payout: 0.9 },
                    { side: 'under', askPrice: 0.5, payout: 0.9 },
                ],
                accepted: [],
                failed: [],
            }),
            buyDigitPairNow: jest.fn().mockResolvedValue({
                quotes: [],
                accepted: [
                    { side: 'over', contractId: 'over-contract', buyPrice: 0.5, payout: 0.9, stake: 0.5 },
                    { side: 'under', contractId: 'under-contract', buyPrice: 0.5, payout: 0.9, stake: 0.5 },
                ],
                failed: [],
            }),
        };
        mockTraderInstances.push(trader);
        return trader;
    }),
}));

jest.mock('@/external/bot-skeleton/utils/observer', () => ({
    observer: { emit: jest.fn() },
}));

import { EdgingProEngine, type EdgingProConfig } from '@/utils/edging-pro-engine';

const config: EdgingProConfig = {
    symbol: '1HZ50V',
    currency: 'USD',
    initialStake: 0.5,
    martingale: 2,
    takeProfit: 10,
    stopLoss: 30,
    lastX: 2,
    overPrediction: 5,
    underPrediction: 4,
    useVirtualHook: true,
    virtualLossThreshold: 1,
};

const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

describe('EdgingProEngine Virtual Hook cycle', () => {
    beforeEach(() => {
        mockTraderInstances.length = 0;
        delete (globalThis as any).__DERIV_EDGING_PRO_ENGINE__;
        delete (globalThis as any).__DERIV_AUTOMATED_CONTRACT_GATE__;
    });

    afterEach(() => {
        mockTraderInstances.forEach(trader => trader.stop());
    });

    it('buys the pair after the configured virtual losses, applies Martingale, then resets the virtual counter', async () => {
        const engine = new EdgingProEngine(config);
        const stats: any[] = [];
        engine.onStats = value => stats.push(value);
        expect(engine.start()).toBe(true);
        const trader = mockTraderInstances[0];

        trader.onTick('100.00', 4);
        trader.onTick('100.01', 5);
        await flushPromises();
        expect(trader.quoteDigitPair).toHaveBeenCalledTimes(1);

        trader.onTick('100.02', 4);
        expect(stats[stats.length - 1].consecutiveVirtualLosses).toBe(1);
        expect(trader.buyDigitPairNow).not.toHaveBeenCalled();

        trader.onTick('100.03', 5);
        await flushPromises();
        expect(trader.buyDigitPairNow).toHaveBeenCalledTimes(1);

        trader.onPosition({ contractId: 'over-contract', isOpen: false, profit: -1 } as any);
        trader.onPosition({ contractId: 'under-contract', isOpen: false, profit: -1 } as any);

        expect(stats[stats.length - 1]).toEqual(expect.objectContaining({
            profit: -2,
            losses: 1,
            currentStake: 1,
            consecutiveVirtualLosses: 0,
            activeContracts: 0,
        }));
        engine.stop();
    });
});