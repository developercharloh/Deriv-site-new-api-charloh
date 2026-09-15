import {
    adxSnapshot,
    aroonSnapshot,
    atrSnapshot,
    bollingerSnapshot,
    ichimokuSnapshot,
    macdSnapshot,
    modelConfidence,
    modelSignal,
    stochasticSnapshot,
} from '../index';

const candles = values =>
    values.map((close, index) => ({
        open: close - 0.2,
        high: close + 0.5 + index * 0.01,
        low: close - 0.5,
        close,
    }));

describe('advanced indicator calculations', () => {
    it('calculates Aroon trend values from the most recent window', () => {
        const result = aroonSnapshot(candles([1, 2, 3, 4, 5]), { periods: 5 });

        expect(result.up).toBe(100);
        expect(result.down).toBe(20);
        expect(result.oscillator).toBe(80);
    });

    it('returns Ichimoku cloud components when enough candle history exists', () => {
        const flatCandles = Array.from({ length: 12 }, () => ({ open: 10, high: 11, low: 9, close: 10 }));
        const result = ichimokuSnapshot(flatCandles, {
            conversionPeriods: 3,
            basePeriods: 5,
            spanPeriods: 10,
        });

        expect(result).toMatchObject({
            conversion: 10,
            base: 10,
            spanA: 10,
            spanB: 10,
            cloudTop: 10,
            cloudBottom: 10,
        });
    });

    it('calculates ATR and Stochastic without dividing by a zero range', () => {
        const data = candles([10, 10, 10, 10, 11, 12, 13]);
        const atr = atrSnapshot(data, { periods: 3 });
        const stochastic = stochasticSnapshot(data, { periods: 3, signalPeriods: 2 });

        expect(atr).toBeGreaterThan(0);
        expect(stochastic.k).toBeGreaterThanOrEqual(0);
        expect(stochastic.k).toBeLessThanOrEqual(100);
        expect(stochastic.d).toBeGreaterThanOrEqual(0);
        expect(stochastic.d).toBeLessThanOrEqual(100);
    });

    it('calculates ADX and Bollinger derived values after warm-up', () => {
        const result = adxSnapshot(candles(Array.from({ length: 40 }, (_, index) => index + 1)), { periods: 5 });
        const bands = bollingerSnapshot(Array.from({ length: 25 }, (_, index) => index + 1), { periods: 10 });

        expect(result).not.toBeNull();
        expect(result.adx).toBeGreaterThanOrEqual(0);
        expect(bands.percentB).toBeGreaterThanOrEqual(0);
        expect(bands.width).toBeGreaterThan(0);
    });

    it('returns MACD snapshots only after enough input history', () => {
        expect(macdSnapshot([1, 2, 3], { fastEmaPeriod: 2, slowEmaPeriod: 3, signalEmaPeriod: 2 })).toBeNull();
        expect(
            macdSnapshot(Array.from({ length: 20 }, (_, index) => index + 1), {
                fastEmaPeriod: 2,
                slowEmaPeriod: 5,
                signalEmaPeriod: 2,
            })
        ).toEqual(expect.objectContaining({ histogram: expect.any(Number), macd: expect.any(Number), signal: expect.any(Number) }));
    });

    it('turns directional scores into a conservative model signal', () => {
        expect(modelConfidence(80, 20)).toBe(60);
        expect(modelSignal(80, 20, 10)).toBe('CALL');
        expect(modelSignal(52, 48, 10)).toBe('WAIT');
        expect(modelSignal(20, 80, 10)).toBe('PUT');
    });
});