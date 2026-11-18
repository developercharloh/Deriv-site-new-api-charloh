import { macdSnapshot } from '@/external/indicators';

export type EvenOddBeastSide = 'EVEN' | 'ODD';

export type EvenOddBeastAnalysis = {
    candleTime: number | null;
    candleDigit: number | null;
    movingAverageDigit: number | null;
    matchedDigit: number | null;
    candleOpen: number | null;
    candleClose: number | null;
    candleColor: 'GREEN' | 'RED' | 'NEUTRAL' | 'WAITING';
    movingAverage: number | null;
    priceVsMovingAverage: 'ABOVE' | 'BELOW' | 'AT' | 'WAITING';
    movingAverageTrend: 'RISING' | 'FALLING' | 'FLAT' | 'WAITING';
    macdHistogram: number | null;
    macdTrend: 'RISING' | 'FALLING' | 'FLAT' | 'WAITING';
    evenConditions: boolean;
    oddConditions: boolean;
    signal: EvenOddBeastSide | 'WAIT';
    reason:
        | 'waiting_for_candles'
        | 'stale_candle'
        | 'precision_unavailable'
        | 'decimal_digits_do_not_match'
        | 'conditions_match_opposite_side'
        | 'indicator_conditions_not_met'
        | 'ready_even'
        | 'ready_odd';
};

const emptyAnalysis = (reason: EvenOddBeastAnalysis['reason']): EvenOddBeastAnalysis => ({
    candleTime: null,
    candleDigit: null,
    movingAverageDigit: null,
    matchedDigit: null,
    candleOpen: null,
    candleClose: null,
    candleColor: 'WAITING',
    movingAverage: null,
    priceVsMovingAverage: 'WAITING',
    movingAverageTrend: 'WAITING',
    macdHistogram: null,
    macdTrend: 'WAITING',
    evenConditions: false,
    oddConditions: false,
    signal: 'WAIT',
    reason,
});

const finite = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const candleTimeOf = (candle: any) => finite(candle?.open_time ?? candle?.time ?? candle?.epoch);

const secondDecimalDigit = (value: number, precision: number) => {
    if (!Number.isInteger(precision) || precision < 2 || precision > 10) return null;
    const decimals = Math.abs(value).toFixed(precision).split('.')[1];
    return decimals?.length >= 2 ? Number(decimals[1]) : null;
};

const averageLast = (candles: Array<{ close: number }>, count: number) => {
    const values = candles.slice(-count).map(candle => candle.close);
    return values.length === count ? values.reduce((sum, value) => sum + value, 0) / count : null;
};

export const analyzeEvenOddBeastCandles = ({
    candles,
    pipSize,
    expectedCandleTime,
}: {
    candles: unknown;
    pipSize: unknown;
    expectedCandleTime: number;
}): EvenOddBeastAnalysis => {
    const source = Array.isArray(candles) ? candles : [];
    const normalized = source
        .map((candle: any) => ({
            time: candleTimeOf(candle),
            open: finite(candle?.open),
            high: finite(candle?.high),
            low: finite(candle?.low),
            close: finite(candle?.close),
        }))
        .filter(
            candle =>
                candle.time !== null &&
                candle.open !== null &&
                candle.high !== null &&
                candle.low !== null &&
                candle.close !== null
        )
        .sort((left, right) => Number(left.time) - Number(right.time)) as Array<{
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
    }>;

    const current = normalized[normalized.length - 1];
    if (!current) return emptyAnalysis('waiting_for_candles');
    if (current.time !== expectedCandleTime) {
        return { ...emptyAnalysis('stale_candle'), candleTime: current.time };
    }

    const precision = Number(pipSize);
    if (!Number.isInteger(precision) || precision < 2 || precision > 10) {
        return { ...emptyAnalysis('precision_unavailable'), candleTime: current.time };
    }

    const slowPeriod = 26;
    const signalPeriod = 9;
    const minimumCandles = slowPeriod + signalPeriod;
    if (normalized.length < minimumCandles) {
        return { ...emptyAnalysis('waiting_for_candles'), candleTime: current.time };
    }

    const closes = normalized.map(candle => candle.close);
    const movingAverage = averageLast(normalized, 9);
    const previousMovingAverage = averageLast(normalized.slice(0, -1), 9);
    const currentMacd = macdSnapshot(closes, {
        fastEmaPeriod: 12,
        slowEmaPeriod: slowPeriod,
        signalEmaPeriod: signalPeriod,
        pipSize: 12,
    });
    const previousMacd = macdSnapshot(closes.slice(0, -1), {
        fastEmaPeriod: 12,
        slowEmaPeriod: slowPeriod,
        signalEmaPeriod: signalPeriod,
        pipSize: 12,
    });
    if (
        movingAverage === null ||
        previousMovingAverage === null ||
        !currentMacd ||
        !previousMacd ||
        !Number.isFinite(currentMacd.histogram) ||
        !Number.isFinite(previousMacd.histogram)
    ) {
        return { ...emptyAnalysis('waiting_for_candles'), candleTime: current.time };
    }

    const candleDigit = secondDecimalDigit(current.close, precision);
    const movingAverageDigit = secondDecimalDigit(movingAverage, precision);
    if (candleDigit === null || movingAverageDigit === null) {
        return { ...emptyAnalysis('precision_unavailable'), candleTime: current.time };
    }

    const candleColor =
        current.close > current.open ? 'GREEN' : current.close < current.open ? 'RED' : 'NEUTRAL';
    const movingAverageTrend =
        movingAverage > previousMovingAverage
            ? 'RISING'
            : movingAverage < previousMovingAverage
              ? 'FALLING'
              : 'FLAT';
    const macdHistogram = currentMacd.histogram;
    const previousHistogram = previousMacd.histogram;
    const macdTrend =
        macdHistogram > previousHistogram
            ? 'RISING'
            : macdHistogram < previousHistogram
              ? 'FALLING'
              : 'FLAT';

    const oddConditions =
        candleColor === 'GREEN' &&
        current.close > movingAverage &&
        movingAverageTrend === 'RISING' &&
        macdHistogram > 0 &&
        macdTrend === 'RISING';
    const evenConditions =
        candleColor === 'RED' &&
        current.close < movingAverage &&
        movingAverageTrend === 'FALLING' &&
        macdHistogram < 0 &&
        macdTrend === 'FALLING';

    const base = {
        candleTime: current.time,
        candleDigit,
        movingAverageDigit,
        matchedDigit: candleDigit === movingAverageDigit ? candleDigit : null,
        candleOpen: current.open,
        candleClose: current.close,
        candleColor,
        movingAverage,
        priceVsMovingAverage:
            current.close > movingAverage ? 'ABOVE' : current.close < movingAverage ? 'BELOW' : 'AT',
        movingAverageTrend,
        macdHistogram,
        macdTrend,
        evenConditions,
        oddConditions,
    } satisfies Omit<EvenOddBeastAnalysis, 'signal' | 'reason'>;

    if (candleDigit !== movingAverageDigit) {
        return { ...base, signal: 'WAIT', reason: 'decimal_digits_do_not_match' };
    }

    const matchedDigit = candleDigit;
    const selectedConditions = matchedDigit % 2 === 0 ? evenConditions : oddConditions;
    const oppositeConditions = matchedDigit % 2 === 0 ? oddConditions : evenConditions;
    if (selectedConditions) {
        return matchedDigit % 2 === 0
            ? { ...base, signal: 'EVEN', reason: 'ready_even' }
            : { ...base, signal: 'ODD', reason: 'ready_odd' };
    }
    if (oppositeConditions) {
        return { ...base, signal: 'WAIT', reason: 'conditions_match_opposite_side' };
    }
    return { ...base, signal: 'WAIT', reason: 'indicator_conditions_not_met' };
};
