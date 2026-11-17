import {
    calculateMacdSeries,
    calculateTsiSeries,
    evaluateMacdMatchesConditions,
    evaluateMatchesConditions,
    type Candle,
} from '../matches-signal-strategy';
import {
    evaluateOverUnderIndicatorStatuses,
    getOverUnderIndicatorModeConfig,
    OVER_UNDER_INDICATOR_MODES,
} from '@/utils/over-under-indicator-strategy';

const makeCandles = (): Candle[] => Array.from({ length: 120 }, (_, index) => {
    const close = 100 + index * 0.015 + Math.sin(index / 4) * 0.12;
    return {
        time: index * 60,
        open: close - 0.01,
        high: close + 0.04,
        low: close - 0.04,
        close,
    };
});

describe('Over/Under indicator strategy', () => {
    it('keeps exactly one setup for each approved side and barrier', () => {
        expect(OVER_UNDER_INDICATOR_MODES.map(mode => {
            const setup = getOverUnderIndicatorModeConfig(mode);
            return `${setup.indicator} ${setup.side} ${setup.barrier}`;
        })).toEqual([
            'MACD OVER 4',
            'MACD OVER 5',
            'TSI UNDER 6',
            'TSI UNDER 5',
        ]);
    });

    it('uses the same MACD and TSI gates as Matches, including entry time and freshness', () => {
        const candles = makeCandles();
        const tsi = calculateTsiSeries(candles).at(-1) ?? null;
        const tsiSamples = tsi === null ? [] : [tsi - 0.005, tsi, tsi + 0.004];
        const macdPoints = calculateMacdSeries(candles).filter(point => point !== null);
        const previousMacd = macdPoints.at(-2) ?? null;
        const currentMacd = macdPoints.at(-1) ?? null;
        const options = {
            candles,
            tsiSamples,
            secondsToClose: 2,
            feedFresh: true,
        };
        const statuses = evaluateOverUnderIndicatorStatuses(options);
        const matchesTsi = evaluateMatchesConditions({
            candle: candles.at(-1) ?? null,
            tsi,
            tsiSamples,
            secondsToClose: options.secondsToClose,
            feedFresh: options.feedFresh,
        });
        const matchesMacd = evaluateMacdMatchesConditions({
            previous: previousMacd,
            current: currentMacd,
            secondsToClose: options.secondsToClose,
            feedFresh: options.feedFresh,
        });

        expect(statuses.find(status => status.mode === 'TSI_UNDER_6')?.tradeNow).toBe(matchesTsi.tradeNow);
        expect(statuses.find(status => status.mode === 'TSI_UNDER_5')?.tradeNow).toBe(matchesTsi.tradeNow);
        expect(statuses.find(status => status.mode === 'MACD_OVER_4')?.tradeNow).toBe(matchesMacd.tradeNow);
        expect(statuses.find(status => status.mode === 'MACD_OVER_5')?.tradeNow).toBe(matchesMacd.tradeNow);
    });

    it('requires a fresh feed and the exact 00:02 entry tick', () => {
        const candles = makeCandles();
        const tsi = calculateTsiSeries(candles).at(-1) ?? 0;
        const statuses = evaluateOverUnderIndicatorStatuses({
            candles,
            tsiSamples: [tsi, tsi, tsi],
            secondsToClose: 3,
            feedFresh: false,
        });

        expect(statuses.every(status => !status.tradeNow)).toBe(true);
        expect(statuses.every(status => status.conditions.find(condition => condition.key === 'entry-window')?.met === false))
            .toBe(true);
        expect(statuses.every(status => status.conditions.find(condition => condition.key === 'fresh-feed')?.met === false))
            .toBe(true);
    });
});
