const mockTraderInstances: any[] = [];

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: {}, is_authorized: true },
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
    accountId: 'VRTC_EDGING_PRO_TEST',
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
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: {
                request: (name: string, _options: unknown, callback: (lock: unknown | null) => Promise<void> | void) => {
                    void callback({ name });
                    return Promise.resolve();
                },
            },
        });
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

    it('submits one Over 5 and one Under 4 pair per qualifying stretch, then rearms after it clears', async () => {
        const engine = new EdgingProEngine({ ...config, useVirtualHook: false });
        expect(engine.start()).toBe(true);
        const trader = mockTraderInstances[0];

        trader.onTick('100.00', 4, 100, 'tick-100');
        trader.onTick('100.01', 5, 101, 'tick-101');
        await flushPromises();

        expect(trader.buyDigitPairNow).toHaveBeenCalledTimes(1);
        expect(trader.buyDigitPairNow.mock.calls[0][0]).toEqual([
            expect.objectContaining({
                side: 'over',
                config: expect.objectContaining({ contractType: 'DIGITOVER', barrier: '5' }),
            }),
            expect.objectContaining({
                side: 'under',
                config: expect.objectContaining({ contractType: 'DIGITUNDER', barrier: '4' }),
            }),
        ]);

        trader.onPosition({ contractId: 'over-contract', isOpen: false, profit: -0.5 } as any);
        trader.onPosition({ contractId: 'under-contract', isOpen: false, profit: -0.5 } as any);
        trader.onTick('100.01', 5, 101, 'tick-101-replayed-with-new-id');
        await flushPromises();

        expect(trader.buyDigitPairNow).toHaveBeenCalledTimes(1);

        trader.onTick('100.01', 5, 101, 'tick-101');
        await flushPromises();

        expect(trader.buyDigitPairNow).toHaveBeenCalledTimes(1);

        // New epochs may keep the condition qualified, but must not repeat the paid pair.
        trader.onTick('100.01', 5, 102, 'tick-102');
        trader.onTick('100.01', 5, 103, 'tick-103');
        await flushPromises();
        expect(trader.buyDigitPairNow).toHaveBeenCalledTimes(1);

        // The signal rearms only after Last X no longer qualifies.
        trader.onTick('100.02', 2, 104, 'tick-104');
        trader.onTick('100.01', 4, 105, 'tick-105');
        trader.onTick('100.01', 5, 106, 'tick-106');
        await flushPromises();
        expect(trader.buyDigitPairNow).toHaveBeenCalledTimes(2);
        trader.onPosition({ contractId: 'over-contract', isOpen: false, profit: -0.5 } as any);
        trader.onPosition({ contractId: 'under-contract', isOpen: false, profit: -0.5 } as any);
        engine.stop();
    });

    it('requires consecutive virtual pairs where both legs lose before buying a real pair', async () => {
        const engine = new EdgingProEngine({ ...config, virtualLossThreshold: 2 });
        const stats: any[] = [];
        const logs: string[] = [];
        engine.onStats = value => stats.push(value);
        engine.onLog = entry => logs.push(entry.message);
        expect(engine.start()).toBe(true);
        const trader = mockTraderInstances[0];
        const tick = (epoch: number, digit: number) =>
            trader.onTick(`100.${String(epoch).padStart(2, '0')}`, digit, epoch, `tick-${epoch}`);

        tick(100, 4);
        tick(101, 5);
        await flushPromises();
        tick(102, 3); // Under wins, Over loses; combined pair P/L is negative.
        expect(stats[stats.length - 1].consecutiveVirtualLosses).toBe(0);
        expect(logs).toEqual(expect.arrayContaining([
            expect.stringContaining('Mixed virtual pair on digit 3'),
            expect.stringContaining('net -$0.10'),
        ]));
        expect(trader.buyDigitPairNow).not.toHaveBeenCalled();

        tick(103, 4);
        tick(104, 5);
        await flushPromises();
        tick(105, 4); // Both legs lose.
        expect(stats[stats.length - 1].consecutiveVirtualLosses).toBe(1);

        tick(106, 4);
        await flushPromises();
        tick(107, 3); // A mixed result breaks the one-pair loss streak.
        expect(stats[stats.length - 1].consecutiveVirtualLosses).toBe(0);
        expect(trader.buyDigitPairNow).not.toHaveBeenCalled();

        tick(108, 4);
        tick(109, 5);
        await flushPromises();
        tick(110, 4);
        expect(stats[stats.length - 1].consecutiveVirtualLosses).toBe(1);

        tick(111, 4);
        await flushPromises();
        tick(112, 5);
        expect(stats[stats.length - 1].consecutiveVirtualLosses).toBe(2);
        expect(trader.buyDigitPairNow).not.toHaveBeenCalled();

        tick(113, 4);
        await flushPromises();
        expect(trader.buyDigitPairNow).toHaveBeenCalledTimes(1);
        expect(trader.buyDigitPairNow.mock.calls[0][0]).toHaveLength(2);
        expect(trader.buyDigitPairNow.mock.calls[0][0].map((leg: any) => leg.side)).toEqual([
            'over',
            'under',
        ]);

        trader.onPosition({ contractId: 'over-contract', isOpen: false, profit: -0.5 } as any);
        trader.onPosition({ contractId: 'under-contract', isOpen: false, profit: -0.5 } as any);
        engine.stop();
    });

    it('keeps the one-paid-pair limit after the Virtual Hook threshold while Last X stays MET', async () => {
        const engine = new EdgingProEngine({ ...config, virtualLossThreshold: 2 });
        expect(engine.start()).toBe(true);
        const trader = mockTraderInstances[0];
        const tick = (epoch: number, digit: number) =>
            trader.onTick(`100.${String(epoch).padStart(2, '0')}`, digit, epoch, `tick-${epoch}`);

        tick(100, 4);
        tick(101, 5);
        await flushPromises();
        tick(102, 4); // First both-leg virtual loss.
        tick(103, 5);
        await flushPromises();
        tick(104, 5); // Second both-leg virtual loss reaches the threshold.
        tick(105, 4); // The one paid Over 5 + Under 4 pair.
        await flushPromises();
        expect(trader.buyDigitPairNow).toHaveBeenCalledTimes(1);

        trader.onPosition({ contractId: 'over-contract', isOpen: false, profit: -0.5 } as any);
        trader.onPosition({ contractId: 'under-contract', isOpen: false, profit: -0.5 } as any);
        tick(106, 5);
        tick(107, 4);
        await flushPromises();

        expect(trader.buyDigitPairNow).toHaveBeenCalledTimes(1);
        expect(trader.quoteDigitPair).toHaveBeenCalledTimes(2);
        engine.stop();
    });

    it('uses an account-wide browser lock to reject a second fresh runner', async () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
        let lockHeld = false;
        const request = jest.fn(
            async (
                name: string,
                _options: { mode: 'exclusive'; ifAvailable?: boolean },
                callback: (lock: unknown | null) => Promise<void> | void
            ) => {
                await Promise.resolve();
                if (lockHeld) return callback(null);
                lockHeld = true;
                try {
                    return await callback({ name });
                } finally {
                    lockHeld = false;
                }
            }
        );
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: { request },
        });

        try {
            const accountId = 'VRTC_SHARED_LOCK_TEST';
            const first = new EdgingProEngine({ ...config, accountId });
            expect(first.start()).toBe(true);
            // Separate the active-engine globals and start before the first
            // browser-lock callback runs, as two nearly simultaneous tabs can.
            delete (globalThis as any).__DERIV_EDGING_PRO_ENGINE__;
            const second = new EdgingProEngine({ ...config, accountId });
            expect(second.start()).toBe(true);
            await flushPromises();
            expect(mockTraderInstances[0].start).toHaveBeenCalledTimes(1);
            expect(mockTraderInstances[1].start).not.toHaveBeenCalled();

            first.stop();
            await flushPromises();
            expect(lockHeld).toBe(false);

            expect(second.start()).toBe(true);
            await flushPromises();
            expect(mockTraderInstances[1].start).toHaveBeenCalledTimes(1);
            second.stop();
            await flushPromises();
        } finally {
            if (originalDescriptor) {
                Object.defineProperty(navigator, 'locks', originalDescriptor);
            } else {
                delete (navigator as any).locks;
            }
        }
    });

    it('fails closed when the account ID or a reliable browser lock is unavailable', () => {
        const withMissingAccount = new EdgingProEngine({ ...config, accountId: undefined });
        expect(withMissingAccount.start()).toBe(false);
        expect(mockTraderInstances[0].start).not.toHaveBeenCalled();

        const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
        try {
            delete (navigator as any).locks;
            const withoutBrowserLock = new EdgingProEngine(config);
            expect(withoutBrowserLock.start()).toBe(false);
            expect(mockTraderInstances[1].start).not.toHaveBeenCalled();
        } finally {
            if (originalDescriptor) {
                Object.defineProperty(navigator, 'locks', originalDescriptor);
            }
        }
    });

    it('does not fall back to the non-atomic lease when the browser lock request rejects', async () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
        try {
            Object.defineProperty(navigator, 'locks', {
                configurable: true,
                value: {
                    request: () => Promise.reject(new Error('lock request denied')),
                },
            });
            const engine = new EdgingProEngine(config);
            expect(engine.start()).toBe(true);
            await flushPromises();
            expect((engine as any).status).toBe('error');
            expect(mockTraderInstances[0].start).not.toHaveBeenCalled();
        } finally {
            if (originalDescriptor) {
                Object.defineProperty(navigator, 'locks', originalDescriptor);
            }
        }
    });

    it('prevents a second tab from starting Edging pro for the same account', async () => {
        const accountId = 'VRTC_TEST_ACCOUNT';
        const lockKey = `__DERIV_EDGING_PRO_ACTIVE_RUN__:${encodeURIComponent(accountId)}`;
        localStorage.setItem(
            lockKey,
            JSON.stringify({ ownerId: 'another-tab', expiresAt: Date.now() + 60_000 }),
        );

        const engine = new EdgingProEngine({ ...config, accountId });
        expect(engine.start()).toBe(true);
        await flushPromises();
        expect((engine as any).status).toBe('error');
        expect(mockTraderInstances[0].start).not.toHaveBeenCalled();

        localStorage.removeItem(lockKey);
    });
});