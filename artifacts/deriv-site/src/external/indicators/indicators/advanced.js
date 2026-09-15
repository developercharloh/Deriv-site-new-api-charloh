import { takeField } from '../utils/math';
import { bollingerBands } from './bollinger-bands';
import { macdArray } from './macd';
import { relativeStrengthIndex } from './relative-strength-index';

const finite = value => (Number.isFinite(Number(value)) ? Number(value) : null);
const periodOf = (value, fallback) => {
    const period = Math.floor(Number(value));
    return Number.isFinite(period) && period >= 2 ? period : fallback;
};

const valuesOf = (data, field = 'close') =>
    Array.isArray(data)
        ? data
              .map(item => (typeof item === 'number' ? item : item?.[field] ?? item?.close ?? item?.value))
              .map(finite)
              .filter(value => value !== null)
        : [];

const candlesOf = data =>
    Array.isArray(data)
        ? data
              .map(item => {
                  if (typeof item === 'number') {
                      return { open: item, high: item, low: item, close: item };
                  }
                  const close = finite(item?.close ?? item?.value);
                  const open = finite(item?.open) ?? close;
                  const high = finite(item?.high) ?? Math.max(open ?? close, close);
                  const low = finite(item?.low) ?? Math.min(open ?? close, close);
                  return close === null ? null : { open, high, low, close };
              })
              .filter(Boolean)
        : [];

const round = (value, pipSize = 6) => (Number.isFinite(value) ? +value.toFixed(pipSize) : null);

export const macdSnapshot = (data, config = {}) => {
    const input = Array.isArray(data) ? data : [];
    const fastEmaPeriod = periodOf(config.fastEmaPeriod, 12);
    const slowEmaPeriod = Math.max(periodOf(config.slowEmaPeriod, 26), fastEmaPeriod + 1);
    const signalEmaPeriod = periodOf(config.signalEmaPeriod, 9);
    if (input.length < slowEmaPeriod + signalEmaPeriod - 1) return null;
    const result = macdArray(input, {
        ...config,
        fastEmaPeriod,
        slowEmaPeriod,
        signalEmaPeriod,
        pipSize: config.pipSize ?? 6,
    });
    if (!result.length) return null;
    const [histogram, macd, signal] = result[result.length - 1];
    return { histogram, macd, signal };
};

export const macdCross = (data, config = {}, direction = 'bullish') => {
    const input = Array.isArray(data) ? data : [];
    const fastEmaPeriod = periodOf(config.fastEmaPeriod, 12);
    const slowEmaPeriod = Math.max(periodOf(config.slowEmaPeriod, 26), fastEmaPeriod + 1);
    const signalEmaPeriod = periodOf(config.signalEmaPeriod, 9);
    if (input.length < slowEmaPeriod + signalEmaPeriod) return false;
    const results = macdArray(input, {
        ...config,
        fastEmaPeriod,
        slowEmaPeriod,
        signalEmaPeriod,
        pipSize: config.pipSize ?? 6,
    });
    if (results.length < 2) return false;
    const previous = results[results.length - 2];
    const current = results[results.length - 1];
    const previousDiff = previous[1] - previous[2];
    const currentDiff = current[1] - current[2];
    return direction === 'bearish' ? previousDiff >= 0 && currentDiff < 0 : previousDiff <= 0 && currentDiff > 0;
};

export const rsiSnapshot = (data, config = {}) => {
    const periods = periodOf(config.periods, 14);
    const input = Array.isArray(data) ? data : [];
    if (input.length <= periods) return null;
    try {
        return finite(relativeStrengthIndex(input, { ...config, periods }));
    } catch {
        return null;
    }
};

export const rsiCross = (data, config = {}, level = 50, direction = 'above') => {
    const input = Array.isArray(data) ? data : [];
    const periods = periodOf(config.periods, 14);
    if (input.length < periods + 2) return false;
    const previous = rsiSnapshot(input.slice(0, -1), { ...config, periods });
    const current = rsiSnapshot(input, { ...config, periods });
    if (previous === null || current === null) return false;
    return direction === 'below' ? previous >= level && current < level : previous <= level && current > level;
};

export const bollingerSnapshot = (data, config = {}) => {
    const periods = periodOf(config.periods, 20);
    const input = Array.isArray(data) ? data : [];
    if (input.length < periods) return null;
    const [middle, upper, lower] = bollingerBands(input, {
        ...config,
        periods,
        stdDevUp: Number(config.stdDevUp) || 2,
        stdDevDown: Number(config.stdDevDown) || 2,
        pipSize: config.pipSize ?? 6,
    });
    const values = valuesOf(input, config.field);
    const price = values[values.length - 1];
    const width = middle === 0 ? null : (upper - lower) / Math.abs(middle);
    const percentB = upper === lower ? null : (price - lower) / (upper - lower);
    return {
        middle,
        upper,
        lower,
        width: round(width, 8),
        percentB: round(percentB, 8),
    };
};

const trueRange = (current, previous) =>
    Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));

const directionalValues = candles => {
    const ranges = [];
    const plus = [];
    const minus = [];
    for (let index = 1; index < candles.length; index += 1) {
        const current = candles[index];
        const previous = candles[index - 1];
        ranges.push(trueRange(current, previous));
        const upMove = current.high - previous.high;
        const downMove = previous.low - current.low;
        plus.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    return { ranges, plus, minus };
};

const average = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

export const atrSnapshot = (data, config = {}) => {
    const periods = periodOf(config.periods, 14);
    const candles = candlesOf(data);
    if (candles.length < periods + 1) return null;
    const { ranges } = directionalValues(candles);
    return round(average(ranges.slice(-periods)), config.pipSize ?? 6);
};

export const adxSnapshot = (data, config = {}) => {
    const periods = periodOf(config.periods, 14);
    const candles = candlesOf(data);
    if (candles.length < periods * 2 + 1) return null;
    const { ranges, plus, minus } = directionalValues(candles);
    const dx = [];
    let lastPlusDi = null;
    let lastMinusDi = null;
    for (let index = periods - 1; index < ranges.length; index += 1) {
        const range = ranges.slice(index - periods + 1, index + 1).reduce((sum, value) => sum + value, 0);
        if (!range) continue;
        const plusDi = (100 * plus.slice(index - periods + 1, index + 1).reduce((sum, value) => sum + value, 0)) / range;
        const minusDi =
            (100 * minus.slice(index - periods + 1, index + 1).reduce((sum, value) => sum + value, 0)) / range;
        const denominator = plusDi + minusDi;
        if (denominator) dx.push((100 * Math.abs(plusDi - minusDi)) / denominator);
        lastPlusDi = plusDi;
        lastMinusDi = minusDi;
    }
    if (dx.length < periods || lastPlusDi === null || lastMinusDi === null) return null;
    return {
        adx: round(average(dx.slice(-periods)), config.pipSize ?? 6),
        plusDi: round(lastPlusDi, config.pipSize ?? 6),
        minusDi: round(lastMinusDi, config.pipSize ?? 6),
    };
};

export const stochasticSnapshot = (data, config = {}) => {
    const periods = periodOf(config.periods, 14);
    const signalPeriods = periodOf(config.signalPeriods, 3);
    const candles = candlesOf(data);
    if (candles.length < periods + signalPeriods - 1) return null;
    const kValues = [];
    for (let index = periods - 1; index < candles.length; index += 1) {
        const window = candles.slice(index - periods + 1, index + 1);
        const high = Math.max(...window.map(candle => candle.high));
        const low = Math.min(...window.map(candle => candle.low));
        const range = high - low;
        kValues.push(range === 0 ? 50 : (100 * (candles[index].close - low)) / range);
    }
    return {
        k: round(kValues[kValues.length - 1], config.pipSize ?? 6),
        d: round(average(kValues.slice(-signalPeriods)), config.pipSize ?? 6),
    };
};

export const aroonSnapshot = (data, config = {}) => {
    const periods = periodOf(config.periods, 25);
    const candles = candlesOf(data);
    if (candles.length < periods) return null;
    const window = candles.slice(-periods);
    const highest = Math.max(...window.map(candle => candle.high));
    const lowest = Math.min(...window.map(candle => candle.low));
    const highIndex = window.map(candle => candle.high).lastIndexOf(highest);
    const lowIndex = window.map(candle => candle.low).lastIndexOf(lowest);
    const up = (100 * (periods - (periods - 1 - highIndex))) / periods;
    const down = (100 * (periods - (periods - 1 - lowIndex))) / periods;
    return { up: round(up, config.pipSize ?? 6), down: round(down, config.pipSize ?? 6), oscillator: round(up - down, 6) };
};

export const ichimokuSnapshot = (data, config = {}) => {
    const conversionPeriods = periodOf(config.conversionPeriods, 9);
    const basePeriods = periodOf(config.basePeriods, 26);
    const spanPeriods = periodOf(config.spanPeriods, 52);
    const candles = candlesOf(data);
    if (candles.length < spanPeriods) return null;
    const midpoint = window => {
        const high = Math.max(...window.map(candle => candle.high));
        const low = Math.min(...window.map(candle => candle.low));
        return (high + low) / 2;
    };
    const conversion = midpoint(candles.slice(-conversionPeriods));
    const base = midpoint(candles.slice(-basePeriods));
    const spanA = (conversion + base) / 2;
    const spanB = midpoint(candles.slice(-spanPeriods));
    const close = candles[candles.length - 1].close;
    return {
        conversion: round(conversion, config.pipSize ?? 6),
        base: round(base, config.pipSize ?? 6),
        spanA: round(spanA, config.pipSize ?? 6),
        spanB: round(spanB, config.pipSize ?? 6),
        cloudTop: round(Math.max(spanA, spanB), config.pipSize ?? 6),
        cloudBottom: round(Math.min(spanA, spanB), config.pipSize ?? 6),
        close: round(close, config.pipSize ?? 6),
    };
};

export const isIndicatorReady = (data, periods = 14, minimumExtra = 0) =>
    Array.isArray(data) && data.length >= periodOf(periods, 14) + minimumExtra;

export const modelConfidence = (bullishScore, bearishScore) => {
    const bull = Math.max(0, Number(bullishScore) || 0);
    const bear = Math.max(0, Number(bearishScore) || 0);
    const total = bull + bear;
    return total ? round((Math.abs(bull - bear) / total) * 100, 4) : 0;
};

export const modelSignal = (bullishScore, bearishScore, minimumEdge = 10) => {
    const bull = Number(bullishScore) || 0;
    const bear = Number(bearishScore) || 0;
    const edge = Number(minimumEdge) || 0;
    if (Math.abs(bull - bear) < edge) return 'WAIT';
    return bull > bear ? 'CALL' : 'PUT';
};