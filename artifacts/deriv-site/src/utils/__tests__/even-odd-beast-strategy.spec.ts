import { analyzeEvenOddBeastCandles } from '../even-odd-beast-strategy';

const candleStart = 1_700_000_040;

const buildCandles = (direction: 'up' | 'down', matchedParity: 'EVEN' | 'ODD') => {
    const fraction = matchedParity === 'EVEN' ? 0.12 : 0.13;
    const setupSide = direction === 'down' ? 'EVEN' : 'ODD';
    const candles = Array.from({ length: 50 }, (_, index) => {
        const trend = index * index * index * 10;
        const close = direction === 'up' ? 100_000 + trend + fraction : 2_000_000 - trend + fraction;
        return {
            time: candleStart - (49 - index) * 60,
            open: direction === 'up' ? close - 1 : close + 1,
            high: direction === 'up' ? close : close + 1,
            low: direction === 'up' ? close - 1 : close,
            close,
        };
    });

    const finalCandle = candles[candles.length - 1];
    let lastAnalysis: ReturnType<typeof analyzeEvenOddBeastCandles> | null = null;
    for (let offset = 0; offset < 9; offset += 1) {
        finalCandle.close =
            direction === 'up'
                ? 100_000 + 49 * 49 * 49 * 10 + fraction + offset
                : 2_000_000 - 49 * 49 * 49 * 10 + fraction - offset;
        finalCandle.open = direction === 'up' ? finalCandle.close - 1 : finalCandle.close + 1;
        finalCandle.high = direction === 'up' ? finalCandle.close : finalCandle.close + 1;
        finalCandle.low = direction === 'up' ? finalCandle.close - 1 : finalCandle.close;

        const analysis = analyzeEvenOddBeastCandles({
            candles,
            pipSize: 2,
            expectedCandleTime: candleStart,
        });
        lastAnalysis = analysis;
        if (
            analysis.matchedDigit !== null &&
            analysis.matchedDigit % 2 === (matchedParity === 'EVEN' ? 0 : 1) &&
            analysis.signal === setupSide
        ) {
            return { candles, analysis };
        }
    }

    throw new Error(
        `Could not create a matching ${matchedParity} ${direction} fixture: ${JSON.stringify(lastAnalysis)}`
    );
};

describe('Even Odd Beast candle analysis', () => {
    it('allows Even only when an even decimal match and bearish conditions align', () => {
        const { analysis } = buildCandles('down', 'EVEN');

        expect(analysis).toMatchObject({
            matchedDigit: expect.any(Number),
            candleColor: 'RED',
            priceVsMovingAverage: 'BELOW',
            movingAverageTrend: 'FALLING',
            macdTrend: 'FALLING',
            evenConditions: true,
            setupSignal: 'EVEN',
            signal: 'EVEN',
            reason: 'ready_even',
        });
        expect(analysis.matchedDigit! % 2).toBe(0);
    });

    it('allows Odd only when an odd decimal match and bullish conditions align', () => {
        const { analysis } = buildCandles('up', 'ODD');

        expect(analysis).toMatchObject({
            matchedDigit: expect.any(Number),
            candleColor: 'GREEN',
            priceVsMovingAverage: 'ABOVE',
            movingAverageTrend: 'RISING',
            macdTrend: 'RISING',
            oddConditions: true,
            setupSignal: 'ODD',
            signal: 'ODD',
            reason: 'ready_odd',
        });
        expect(analysis.matchedDigit! % 2).toBe(1);
    });

    it('selects the Odd contract for bullish conditions even when the matched digit is even', () => {
        const { analysis } = buildCandles('up', 'EVEN');

        expect(analysis.matchedDigit).not.toBeNull();
        expect(analysis.matchedDigit! % 2).toBe(0);
        expect(analysis.oddConditions).toBe(true);
        expect(analysis.signal).toBe('ODD');
        expect(analysis.reason).toBe('ready_odd');
    });

    it('selects the Even contract for bearish conditions even when the matched digit is odd', () => {
        const { analysis } = buildCandles('down', 'ODD');

        expect(analysis.matchedDigit).not.toBeNull();
        expect(analysis.matchedDigit! % 2).toBe(1);
        expect(analysis.evenConditions).toBe(true);
        expect(analysis.signal).toBe('EVEN');
        expect(analysis.reason).toBe('ready_even');
    });

    it('waits when the candle and moving-average decimal digits differ', () => {
        const { candles } = buildCandles('up', 'ODD');
        const finalCandle = candles[candles.length - 1];
        let analysis = analyzeEvenOddBeastCandles({
            candles,
            pipSize: 2,
            expectedCandleTime: candleStart,
        });

        for (let offset = 0; offset < 100 && analysis.reason !== 'decimal_digits_do_not_match'; offset += 1) {
            finalCandle.close += 0.01;
            finalCandle.open = finalCandle.close - 1;
            finalCandle.high = finalCandle.close;
            finalCandle.low = finalCandle.open;
            analysis = analyzeEvenOddBeastCandles({
                candles,
                pipSize: 2,
                expectedCandleTime: candleStart,
            });
        }

        expect(analysis.reason).toBe('decimal_digits_do_not_match');
        expect(analysis.signal).toBe('WAIT');
        expect(analysis.setupSignal).toBe('ODD');
    });

    it('fails closed for stale candles, missing precision, and insufficient history', () => {
        const { candles } = buildCandles('up', 'ODD');
        expect(
            analyzeEvenOddBeastCandles({
                candles,
                pipSize: 2,
                expectedCandleTime: candleStart + 60,
            }).reason
        ).toBe('stale_candle');
        expect(
            analyzeEvenOddBeastCandles({
                candles,
                pipSize: undefined,
                expectedCandleTime: candleStart,
            }).reason
        ).toBe('precision_unavailable');
        expect(
            analyzeEvenOddBeastCandles({
                candles: candles.slice(-10),
                pipSize: 2,
                expectedCandleTime: candleStart,
            }).reason
        ).toBe('waiting_for_candles');
    });
});
