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
});