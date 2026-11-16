import {
    calculateTsiSeries,
    calculateTsiSignalSeries,
    evaluateMatchesConditions,
    formatCandleCountdown,
    isTsiFlat,
    mergeCandle,
    normalizeCandle,
    secondsUntilCandleClose,
    type Candle,
} from '../matches-signal-strategy';

const candle = (time: number, open: number, close: number): Candle => ({
    time,
    open,
    high: Math.max(open, close) + 0.1,
    low: Math.min(open, close) - 0.1,
    close,
});

describe('Matches 0–4 candle strategy', () => {
    it('normalizes Deriv history and live OHLC message shapes', () => {
        expect(normalizeCandle({ epoch: 120, open: 1, high: 3, low: 1, close: 2 })?.time).toBe(120);
        expect(normalizeCandle({ open_time: 180, epoch: 181, open: 2, high: 3, low: 1, close: 2.5 })?.time).toBe(180);
        expect(normalizeCandle({ epoch: 120, open: 'bad', high: 3, low: 1, close: 2 })).toBeNull();
    });

    it('replaces the current candle and keeps candles ordered and bounded', () => {
        const original = [candle(120, 1, 1.2), candle(180, 1.2, 1.4)];
        const updated = mergeCandle(original, candle(180, 1.2, 1.5));
        expect(updated).toHaveLength(2);
        expect(updated[1].close).toBe(1.5);
        expect(mergeCandle(updated, candle(240, 1.5, 1.7), 2).map(item => item.time)).toEqual([180, 240]);
    });

    it('calculates normalized TSI and leaves warm-up values unavailable', () => {
        const candles = Array.from({ length: 70 }, (_, index) =>
            candle(index * 60, 100 + index, 101 + index));
        const values = calculateTsiSeries(candles, 5, 3);
        expect(values[0]).toBeNull();
        expect(values.at(-1)).toBeCloseTo(1, 6);
        expect(calculateTsiSignalSeries(candles, 5, 3, 2).at(-1)).toBeCloseTo(1, 6);
    });

    it('requires three live TSI samples within the configured flatness range', () => {
        expect(isTsiFlat([0.81, 0.82])).toBe(false);
        expect(isTsiFlat([0.81, 0.82, 0.83])).toBe(true);
        expect(isTsiFlat([0.8, 0.82, 0.83])).toBe(false);
    });

    it('counts down from candle start to the two-second entry window', () => {
        expect(secondsUntilCandleClose(120, 178.2)).toBe(2);
        expect(secondsUntilCandleClose(120, 179)).toBe(1);
        expect(secondsUntilCandleClose(120, 180)).toBe(0);
        expect(formatCandleCountdown(2)).toBe('00:02');
        expect(formatCandleCountdown(null)).toBe('--:--');
    });

    it('shows Trade Now only when every live entry condition is true', () => {
        const options = {
            candle: candle(120, 1, 1.2),
            tsi: 0.85,
            tsiSamples: [0.84, 0.85, 0.85],
            secondsToClose: 2,
            feedFresh: true,
        };
        expect(evaluateMatchesConditions(options).tradeNow).toBe(true);
        expect(evaluateMatchesConditions({ ...options, feedFresh: false }).tradeNow).toBe(false);
        expect(evaluateMatchesConditions({ ...options, secondsToClose: 3 }).tradeNow).toBe(false);
        expect(evaluateMatchesConditions({ ...options, candle: candle(120, 1.2, 1.1) }).tradeNow).toBe(false);
        expect(evaluateMatchesConditions({ ...options, tsi: 0.7 }).tradeNow).toBe(false);
        expect(evaluateMatchesConditions({ ...options, tsiSamples: [0.7, 0.85, 0.9] }).tradeNow).toBe(false);
    });
});
