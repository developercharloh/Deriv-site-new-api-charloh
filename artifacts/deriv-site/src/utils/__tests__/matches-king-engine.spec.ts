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
            buyDigitBatchNow: jest.fn((configs: any[]) =>
                mockBuyBatchPromise ??
                Promise.resolve({
                    accepted: configs.map(({ side, config }) => ({
                        side,
                        contractId: `contract-${side}`,
                        buyPrice: config.stake,
                        payout: 0.9,
                        stake: config.stake,
                    })),
                    failed: [],
                })
            ),
        };
        mockTraderInstances.push(trader);
        return trader;
    }),
}));

import { MatchesKingEngine, type MatchesKingConfig } from '@/utils/matches-king-engine';
import { tryAcquireBotContractGate } from '@/utils/bot-contract-gate';

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

describe('MatchesKingEngine rate-limit recovery', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mockTraderInstances.length = 0;
        mockBuyBatchPromise = null;
        (tryAcquireBotContractGate as jest.Mock).mockReturnValue(true);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('keeps running after a rate-limited batch and retries on a fresh tick after cooldown', async () => {
        mockBuyBatchPromise = Promise.resolve({
            accepted: [],
            failed: [{ side: '7', message: 'You have reached the rate limit for buy.' }],
        });
        const engine = new MatchesKingEngine({ ...config, useVirtualHook: false });
        const trader = mockTraderInstances[0];
        const statuses: string[] = [];
        engine.onStatus = status => statuses.push(status);
        (engine as any).running = true;

        trader.onTick('100.01', 1, 1);
        await flushPromises();

        expect((engine as any).running).toBe(true);
        expect(statuses[statuses.length - 1]).toBe('waiting');
        expect(trader.stop).not.toHaveBeenCalled();

        mockBuyBatchPromise = null;
        trader.onTick('100.02', 2, 2);
        await flushPromises();
        expect(trader.buyDigitBatchNow).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(1_000);
        expect(statuses[statuses.length - 1]).toBe('scanning');

        trader.onTick('100.03', 3, 3);
        await flushPromises();
        expect(trader.buyDigitBatchNow).toHaveBeenCalledTimes(2);
        expect((engine as any).liveBatch.acceptedIds).toEqual(['contract-7']);

        engine.stop();
        trader.onPosition({ contractId: 'contract-7', isOpen: false, profit: -0.5 });
        expect(statuses[statuses.length - 1]).toBe('stopped');
    });

    it('honors Stop when a rate-limited purchase is still in flight', async () => {
        let resolveBuy!: (value: any) => void;
        mockBuyBatchPromise = new Promise(resolve => {
            resolveBuy = resolve;
        });
        const engine = new MatchesKingEngine({ ...config, useVirtualHook: false });
        const trader = mockTraderInstances[0];
        const statuses: string[] = [];
        engine.onStatus = status => statuses.push(status);
        (engine as any).running = true;
        (engine as any).latestEpoch = 1;

        const buying = (engine as any).buyLiveBatch(1);
        await flushPromises();
        engine.stop();
        resolveBuy({
            accepted: [],
            failed: [{ side: '7', message: 'You have reached the rate limit for buy.' }],
        });
        await buying;

        expect((engine as any).running).toBe(false);
        expect((engine as any).rateLimitTimer).toBeNull();
        expect(statuses[statuses.length - 1]).toBe('stopped');
        expect(trader.stop).toHaveBeenCalledTimes(1);
    });

    it('keeps the run alive through repeated rate limits with a capped cooldown', async () => {
        const engine = new MatchesKingEngine({ ...config, useVirtualHook: false });
        const trader = mockTraderInstances[0];
        (engine as any).running = true;
        const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];

        for (let index = 0; index < expectedDelays.length; index += 1) {
            mockBuyBatchPromise = Promise.resolve({
                accepted: [],
                failed: [{ side: '7', message: 'You have reached the rate limit for buy.' }],
            });
            trader.onTick(`100.0${index}`, index, index + 1);
            await flushPromises();

            expect((engine as any).running).toBe(true);
            expect((engine as any).rateLimitUntil - Date.now()).toBe(expectedDelays[index]);
            jest.advanceTimersByTime(expectedDelays[index]);
        }

        engine.stop();
        expect((engine as any).running).toBe(false);
        expect(trader.stop).toHaveBeenCalledTimes(1);
    });

    it('tracks an accepted partial batch and continues instead of resending or stopping', async () => {
        mockBuyBatchPromise = Promise.resolve({
            accepted: [{ side: '7', contractId: 'contract-7', buyPrice: 0.5, payout: 0.9, stake: 0.5 }],
            failed: [{ side: '8', message: 'You have reached the rate limit for buy.' }],
        });
        const engine = new MatchesKingEngine({
            ...config,
            digits: [7, 8],
            useVirtualHook: false,
        });
        const trader = mockTraderInstances[0];
        const statuses: string[] = [];
        engine.onStatus = status => statuses.push(status);
        (engine as any).running = true;

        trader.onTick('100.01', 1, 1);
        await flushPromises();
        expect((engine as any).running).toBe(true);
        expect((engine as any).liveBatch.acceptedIds).toEqual(['contract-7']);

        trader.onPosition({ contractId: 'contract-7', isOpen: false, profit: -0.5 });
        expect((engine as any).running).toBe(true);
        expect((engine as any).liveBatch).toBeNull();
        expect(statuses[statuses.length - 1]).toBe('waiting');

        jest.advanceTimersByTime(1_000);
        mockBuyBatchPromise = null;
        trader.onTick('100.02', 2, 2);
        await flushPromises();
        expect(trader.buyDigitBatchNow).toHaveBeenCalledTimes(2);
        expect((engine as any).liveBatch.acceptedIds).toEqual(['contract-7', 'contract-8']);

        engine.stop();
        trader.onPosition({ contractId: 'contract-7', isOpen: false, profit: -0.5 });
        trader.onPosition({ contractId: 'contract-8', isOpen: false, profit: -0.5 });
        expect(statuses[statuses.length - 1]).toBe('stopped');
    });

    it('still honors Stop Loss after a rate-limited partial batch settles', async () => {
        mockBuyBatchPromise = Promise.resolve({
            accepted: [{ side: '7', contractId: 'contract-7', buyPrice: 0.5, payout: 0.9, stake: 0.5 }],
            failed: [{ side: '8', message: 'You have reached the rate limit for buy.' }],
        });
        const engine = new MatchesKingEngine({
            ...config,
            digits: [7, 8],
            stopLoss: 0.5,
            useVirtualHook: false,
        });
        const trader = mockTraderInstances[0];
        const alerts: Array<{ kind: string; profit: number }> = [];
        engine.onAlert = (kind, profit) => alerts.push({ kind, profit });
        (engine as any).running = true;

        trader.onTick('100.01', 1, 1);
        await flushPromises();
        trader.onPosition({ contractId: 'contract-7', isOpen: false, profit: -0.5 });

        expect((engine as any).running).toBe(false);
        expect(alerts).toEqual([{ kind: 'sl', profit: -0.5 }]);
        expect(trader.stop).toHaveBeenCalledTimes(1);
    });
});

describe('Matches King Use Virtual Hook setting', () => {
    beforeEach(() => {
        mockTraderInstances.length = 0;
        mockBuyBatchPromise = null;
        (tryAcquireBotContractGate as jest.Mock).mockReturnValue(true);
    });

    it.each([true, undefined])('keeps the virtual-loss gate enabled when Use Virtual Hook is %s', async useVirtualHook => {
        const engine = new MatchesKingEngine({ ...config, useVirtualHook });
        const trader = mockTraderInstances[0];
        const virtualSettlement = jest.fn();
        engine.onVirtualSettlement = virtualSettlement;
        (engine as any).running = true;
        trader.onTick('100.01', 1, 1);
        expect(trader.buyDigitBatchNow).not.toHaveBeenCalled();
        trader.onTick('100.02', 2, 2);
        expect(virtualSettlement).toHaveBeenCalledTimes(1);
        expect(trader.buyDigitBatchNow).not.toHaveBeenCalled();
        trader.onTick('100.03', 3, 3);
        await flushPromises();
        expect(trader.buyDigitBatchNow).toHaveBeenCalledTimes(1);
        engine.stop();
        trader.onPosition({ contractId: 'contract-7', isOpen: false, profit: -0.5 });
    });

    it('buys immediately without virtual trades when false and keeps Martingale/reset behavior', async () => {
        const engine = new MatchesKingEngine({ ...config, useVirtualHook: false });
        const trader = mockTraderInstances[0];
        const virtualSettlement = jest.fn();
        engine.onVirtualSettlement = virtualSettlement;
        (engine as any).running = true;
        trader.onTick('100.01', 1, 1);
        await flushPromises();
        expect(trader.buyDigitBatchNow).toHaveBeenCalledTimes(1);
        expect(trader.buyDigitBatchNow.mock.calls[0][0][0].config.stake).toBe(0.5);
        trader.onTick('100.02', 2, 2);
        expect(trader.buyDigitBatchNow).toHaveBeenCalledTimes(1); // still open
        trader.onPosition({ contractId: 'contract-7', isOpen: false, profit: -0.5 });
        trader.onTick('100.03', 3, 3);
        await flushPromises();
        expect(trader.buyDigitBatchNow).toHaveBeenCalledTimes(2);
        expect(trader.buyDigitBatchNow.mock.calls[1][0][0].config.stake).toBe(1);
        trader.onPosition({ contractId: 'contract-7', isOpen: false, profit: 2 });
        trader.onTick('100.04', 4, 4);
        await flushPromises();
        expect(trader.buyDigitBatchNow.mock.calls[2][0][0].config.stake).toBe(0.5);
        expect(virtualSettlement).not.toHaveBeenCalled();
        engine.stop();
        trader.onPosition({ contractId: 'contract-7', isOpen: false, profit: -0.5 });
    });

    it('still enforces pause, Stop and the live contract gate with the hook disabled', async () => {
        const engine = new MatchesKingEngine({ ...config, useVirtualHook: false });
        const trader = mockTraderInstances[0];
        (engine as any).running = true;
        engine.pause();
        trader.onTick('100.01', 1, 1);
        expect(trader.buyDigitBatchNow).not.toHaveBeenCalled();
        engine.resume();
        (tryAcquireBotContractGate as jest.Mock).mockReturnValue(false);
        trader.onTick('100.02', 2, 2);
        expect(trader.buyDigitBatchNow).not.toHaveBeenCalled();
        engine.stop();
        (tryAcquireBotContractGate as jest.Mock).mockReturnValue(true);
        trader.onTick('100.03', 3, 3);
        await flushPromises();
        expect(trader.buyDigitBatchNow).not.toHaveBeenCalled();
    });

    it.each([{ profit: -0.5, stopLoss: 0.5, takeProfit: 10 }, { profit: 2, stopLoss: 30, takeProfit: 2 }])(
        'keeps risk stops active without the hook for profit $profit',
        async ({ profit, stopLoss, takeProfit }) => {
            const engine = new MatchesKingEngine({ ...config, useVirtualHook: false, stopLoss, takeProfit });
            const trader = mockTraderInstances[0];
            (engine as any).running = true;
            trader.onTick('100.01', 1, 1);
            await flushPromises();
            trader.onPosition({ contractId: 'contract-7', isOpen: false, profit });
            trader.onTick('100.02', 2, 2);
            expect(trader.buyDigitBatchNow).toHaveBeenCalledTimes(1);
            expect(trader.stop).toHaveBeenCalled();
        }
    );

    it('ignores the unused threshold only when the hook is explicitly disabled', () => {
        const direct = new MatchesKingEngine({ ...config, useVirtualHook: false, virtualLossThreshold: NaN });
        const legacy = new MatchesKingEngine({ ...config, virtualLossThreshold: NaN });
        expect((direct as any).isConfigValid()).toBe(true);
        expect((legacy as any).isConfigValid()).toBe(false);
    });
});
