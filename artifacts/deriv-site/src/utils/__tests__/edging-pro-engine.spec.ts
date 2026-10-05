jest.mock('@/external/bot-skeleton/utils/observer', () => ({
    observer: { emit: jest.fn() },
}));

import { EdgingProEngine, type EdgingProConfig } from '@/utils/edging-pro-engine';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';

const config: EdgingProConfig = {
    symbol: '1HZ50V',
    currency: 'USD',
    initialStake: 0.5,
    martingale: 2,
    takeProfit: 10,
    stopLoss: 30,
    lastX: 3,
    overPrediction: 5,
    underPrediction: 4,
    useVirtualHook: false,
    virtualLossThreshold: 2,
};

describe('EdgingProEngine Journal analysis', () => {
    beforeEach(() => jest.clearAllMocks());

    it('journals the last X consecutive digits and whether the 4–5 condition is met', () => {
        const engine = new EdgingProEngine(config);
        const logs: Array<{ message: string }> = [];
        const analyses: Array<{ status: string; digits: number[] }> = [];
        engine.onLog = log => logs.push(log);
        engine.onAnalysis = analysis => analyses.push(analysis);

        const internal = engine as any;
        internal.running = true;
        internal.paused = true;
        internal.handleTick(4);
        internal.handleTick(5);
        internal.handleTick(4);
        internal.handleTick(2);

        expect(analyses.map(item => item.status)).toEqual(['WAITING', 'WAITING', 'MET', 'NOT MET']);
        expect(analyses[2].digits).toEqual([4, 5, 4]);
        expect(logs.some(log => log.message.includes('Last 3 consecutive digits: 4 5 4 · 4–5 condition: MET'))).toBe(true);
        expect(logs.some(log => log.message.includes('Last 3 consecutive digits: 5 4 2 · 4–5 condition: NOT MET'))).toBe(true);
        expect(globalObserver.emit).toHaveBeenCalledWith(
            'bot.analysis.condition',
            expect.objectContaining({
                market: '1HZ50V',
                count: 3,
                compareValue: '4–5 inclusive',
                digits: [5, 4, 2],
                result: false,
                status: 'NOT MET',
            }),
        );
    });

    it('refreshes analysis on a newer epoch even if the broker reuses a tick id', () => {
        const engine = new EdgingProEngine(config);
        const analyses: Array<{ status: string; digits: number[] }> = [];
        engine.onAnalysis = analysis => analyses.push(analysis);

        const internal = engine as any;
        internal.running = true;
        internal.paused = true;
        internal.handleTick(0, '1024.10', 100, 'reused-tick-id');
        internal.handleTick(4, '1024.14', 101, 'reused-tick-id');
        internal.handleTick(4, '1024.14', 101, 'reused-tick-id');

        expect(analyses).toHaveLength(2);
        expect(analyses[1].digits).toEqual([0, 4]);
    });

    it('emits both virtual leg outcomes with shared spots, including zero-net pairs', () => {
        const engine = new EdgingProEngine(config);
        const settlements: any[] = [];
        engine.onVirtualSettlement = settlement => settlements.push(settlement);

        const internal = engine as any;
        const pair = (entryTickSerial: number, entrySpot: string, entryEpoch: number, payout = 1.5) => ({
            entryTickSerial,
            quotes: {
                over: { askPrice: 0.5, payout },
                under: { askPrice: 0.5, payout },
            },
            digits: [4, 5, 4],
            entrySpot,
            entryEpoch,
        });

        internal.pendingVirtualPair = pair(8, '1024.15', 100);
        internal.settleVirtualPair(6, '1024.16', 101);
        internal.pendingVirtualPair = pair(9, '1024.16', 101);
        internal.settleVirtualPair(4, '1024.17', 102);
        internal.pendingVirtualPair = pair(10, '1024.17', 102, 1);
        internal.settleVirtualPair(3, '1024.18', 103);

        expect(settlements).toEqual([
            expect.objectContaining({
                outcome: 'win',
                entryTickSerial: 8,
                market: '1HZ50V',
                contractType: 'DIGITOVER',
                prediction: 5,
                entryEpoch: 100,
                settlementEpoch: 101,
                entrySpot: '1024.15',
                exitSpot: '1024.16',
            }),
            expect.objectContaining({
                outcome: 'loss',
                entryTickSerial: 8,
                market: '1HZ50V',
                contractType: 'DIGITUNDER',
                prediction: 4,
                entryEpoch: 100,
                settlementEpoch: 101,
                entrySpot: '1024.15',
                exitSpot: '1024.16',
            }),
            expect.objectContaining({
                outcome: 'loss',
                entryTickSerial: 9,
                market: '1HZ50V',
                contractType: 'DIGITOVER',
                prediction: 5,
                entryEpoch: 101,
                settlementEpoch: 102,
                entrySpot: '1024.16',
                exitSpot: '1024.17',
            }),
            expect.objectContaining({
                outcome: 'loss',
                entryTickSerial: 9,
                market: '1HZ50V',
                contractType: 'DIGITUNDER',
                prediction: 4,
                entryEpoch: 101,
                settlementEpoch: 102,
                entrySpot: '1024.16',
                exitSpot: '1024.17',
            }),
            expect.objectContaining({
                outcome: 'loss',
                entryTickSerial: 10,
                contractType: 'DIGITOVER',
                prediction: 5,
                entrySpot: '1024.17',
                exitSpot: '1024.18',
            }),
            expect.objectContaining({
                outcome: 'win',
                entryTickSerial: 10,
                contractType: 'DIGITUNDER',
                prediction: 4,
                entrySpot: '1024.17',
                exitSpot: '1024.18',
            }),
        ]);
    });
});