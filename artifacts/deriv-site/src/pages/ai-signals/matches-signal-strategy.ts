export const MATCHES_CANDLE_SECONDS = 60;
export const MATCHES_HISTORY_COUNT = 120;
export const MATCHES_REPLAY_TICK_COUNT = 5_000;
export const MATCHES_TSI_LONG_PERIOD = 25;
export const MATCHES_TSI_SHORT_PERIOD = 13;
export const MATCHES_TSI_SIGNAL_PERIOD = 7;
export const MATCHES_TSI_MIN = 0.8;
export const MATCHES_TSI_MAX = 0.9;
export const MATCHES_TSI_FLAT_DELTA = 0.02;
export const MATCHES_TSI_FLAT_SAMPLES = 3;
export const MATCHES_ENTRY_SECONDS = 2;
export const MATCHES_DIGITS = [0, 1, 2, 3, 4] as const;
export const MATCHES_MACD_FAST_PERIOD = 12;
export const MATCHES_MACD_SLOW_PERIOD = 26;
export const MATCHES_MACD_SIGNAL_PERIOD = 9;
export const MATCHES_MACD_DIGITS = [6, 7, 8, 9] as const;

export interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

export interface MatchesStrategyConditions {
    tsiInRange: boolean;
    tsiFlat: boolean;
    greenCandle: boolean;
    entryWindow: boolean;
    feedFresh: boolean;
    tradeNow: boolean;
}

export interface MacdPoint {
    macdLine: number;
    signalLine: number;
    histogram: number;
}

export interface MatchesMacdConditions {
    enteringFromAbove: boolean;
    signalAway: boolean;
    entryWindow: boolean;
    feedFresh: boolean;
    tradeNow: boolean;
}

export interface MatchesReplayTick {
    epoch: number;
    quote: number | string;
}

export interface MatchesReplayResult {
    tickCount: number;
    candleCount: number;
    fromEpoch: number | null;
    toEpoch: number | null;
    triggerCount: number;
    nextTickDigits: number[];
}

const finiteNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

export function normalizeCandle(raw: any, granularity = MATCHES_CANDLE_SECONDS): Candle | null {
    if (!raw || typeof raw !== 'object') return null;
    const rawTime = finiteNumber(raw.open_time ?? raw.epoch);
    const open = finiteNumber(raw.open);
    const high = finiteNumber(raw.high);
    const low = finiteNumber(raw.low);
    const close = finiteNumber(raw.close);
    if (rawTime === null || open === null || high === null || low === null || close === null) return null;

    const time = raw.open_time !== undefined && raw.open_time !== null && raw.open_time !== ''
        ? rawTime
        : Math.floor(rawTime / granularity) * granularity;
    return { time, open, high, low, close };
}

export function mergeCandle(candles: Candle[], incoming: Candle, limit = MATCHES_HISTORY_COUNT): Candle[] {
    const next = new Map(candles.map(candle => [candle.time, candle]));
    next.set(incoming.time, incoming);
    return [...next.values()]
        .sort((a, b) => a.time - b.time)
        .slice(-limit);
}

function ema(values: number[], period: number): number[] {
    if (!values.length) return [];
    const alpha = 2 / (period + 1);
    const result = [values[0]];
    for (let index = 1; index < values.length; index++) {
        result.push(values[index] * alpha + result[index - 1] * (1 - alpha));
    }
    return result;
}

/**
 * Returns TSI normalized from its conventional -100..100 scale to -1..1.
 * The output stays aligned with the candle array; warm-up positions are null.
 */
export function calculateTsiSeries(
    candles: Candle[],
    longPeriod = MATCHES_TSI_LONG_PERIOD,
    shortPeriod = MATCHES_TSI_SHORT_PERIOD,
): Array<number | null> {
    const result: Array<number | null> = Array(candles.length).fill(null);
    if (candles.length < longPeriod + shortPeriod + 2) return result;

    const closes = candles.map(candle => candle.close);
    const momentum = closes.slice(1).map((close, index) => close - closes[index]);
    const absoluteMomentum = momentum.map(value => Math.abs(value));
    const smoothMomentum = ema(ema(momentum, longPeriod), shortPeriod);
    const smoothAbsoluteMomentum = ema(ema(absoluteMomentum, longPeriod), shortPeriod);
    const warmup = longPeriod + shortPeriod - 2;

    for (let index = warmup; index < smoothMomentum.length; index++) {
        const denominator = smoothAbsoluteMomentum[index];
        if (denominator > 0) result[index + 1] = smoothMomentum[index] / denominator;
    }
    return result;
}

export function calculateTsiSignalSeries(
    candles: Candle[],
    longPeriod = MATCHES_TSI_LONG_PERIOD,
    shortPeriod = MATCHES_TSI_SHORT_PERIOD,
    signalPeriod = MATCHES_TSI_SIGNAL_PERIOD,
): Array<number | null> {
    const tsi = calculateTsiSeries(candles, longPeriod, shortPeriod);
    const valid = tsi.flatMap((value, index) => value === null ? [] : [{ value, index }]);
    if (!valid.length) return tsi.map(() => null);
    const smoothed = ema(valid.map(item => item.value), signalPeriod);
    const result: Array<number | null> = tsi.map(() => null);
    valid.forEach((item, index) => { result[item.index] = smoothed[index]; });
    return result;
}

/**
 * Returns standard MACD (12/26/9 by default), aligned with the candle array.
 * Warm-up positions are null so the UI does not present startup values as signals.
 */
export function calculateMacdSeries(
    candles: Candle[],
    fastPeriod = MATCHES_MACD_FAST_PERIOD,
    slowPeriod = MATCHES_MACD_SLOW_PERIOD,
    signalPeriod = MATCHES_MACD_SIGNAL_PERIOD,
): Array<MacdPoint | null> {
    const result: Array<MacdPoint | null> = Array(candles.length).fill(null);
    if (candles.length < slowPeriod + signalPeriod - 1) return result;

    const closes = candles.map(candle => candle.close);
    const fast = ema(closes, fastPeriod);
    const slow = ema(closes, slowPeriod);
    const macdLine = fast.map((value, index) => value - slow[index]);
    const signalLine = ema(macdLine, signalPeriod);
    const warmup = slowPeriod + signalPeriod - 2;

    for (let index = warmup; index < candles.length; index++) {
        result[index] = {
            macdLine: macdLine[index],
            signalLine: signalLine[index],
            histogram: macdLine[index] - signalLine[index],
        };
    }
    return result;
}

/**
 * Interprets the screenshot's "entering the histogram from above" as a
 * descending MACD line that remains above the signal while the positive
 * histogram contracts. "Signal line away" means its distance from zero is
 * greater than the current histogram bar's height.
 */
export function evaluateMacdMatchesConditions(options: {
    previous: MacdPoint | null;
    current: MacdPoint | null;
    secondsToClose: number | null;
    feedFresh: boolean;
}): MatchesMacdConditions {
    const previous = options.previous;
    const current = options.current;
    const enteringFromAbove = previous !== null && current !== null &&
        previous.macdLine > previous.signalLine &&
        current.macdLine > current.signalLine &&
        current.macdLine < previous.macdLine &&
        current.histogram > 0 &&
        current.histogram < previous.histogram;
    const signalAway = current !== null &&
        Math.abs(current.signalLine) > Math.abs(current.histogram);
    const entryWindow = options.secondsToClose === MATCHES_ENTRY_SECONDS;
    const feedFresh = options.feedFresh;

    return {
        enteringFromAbove,
        signalAway,
        entryWindow,
        feedFresh,
        tradeNow: enteringFromAbove && signalAway && entryWindow && feedFresh,
    };
}

export function isTsiFlat(samples: number[], maxDelta = MATCHES_TSI_FLAT_DELTA): boolean {
    const recent = samples.filter(Number.isFinite).slice(-MATCHES_TSI_FLAT_SAMPLES);
    if (recent.length < MATCHES_TSI_FLAT_SAMPLES) return false;
    return Math.max(...recent) - Math.min(...recent) <= maxDelta;
}

export function secondsUntilCandleClose(
    candleOpenTime: number,
    nowEpoch: number,
    granularity = MATCHES_CANDLE_SECONDS,
): number {
    const remaining = candleOpenTime + granularity - nowEpoch;
    return remaining > 0 ? Math.ceil(remaining) : 0;
}

export function evaluateMatchesConditions(options: {
    candle: Candle | null;
    tsi: number | null;
    tsiSamples: number[];
    secondsToClose: number | null;
    feedFresh: boolean;
}): MatchesStrategyConditions {
    const tsiInRange = options.tsi !== null &&
        options.tsi >= MATCHES_TSI_MIN &&
        options.tsi <= MATCHES_TSI_MAX;
    const tsiFlat = isTsiFlat(options.tsiSamples);
    const greenCandle = options.candle !== null && options.candle.close > options.candle.open;
    const entryWindow = options.secondsToClose === MATCHES_ENTRY_SECONDS;
    const feedFresh = options.feedFresh;

    return {
        tsiInRange,
        tsiFlat,
        greenCandle,
        entryWindow,
        feedFresh,
        tradeNow: tsiInRange && tsiFlat && greenCandle && entryWindow && feedFresh,
    };
}

export function replayMatchesTicks(
    rawTicks: MatchesReplayTick[],
    pipSize: number,
): MatchesReplayResult {
    const ticks = rawTicks
        .flatMap(tick => {
            const epoch = finiteNumber(tick.epoch);
            const quote = finiteNumber(tick.quote);
            return epoch === null || quote === null ? [] : [{ epoch, quote, rawQuote: tick.quote }];
        })
        .sort((a, b) => a.epoch - b.epoch);
    const candles: Candle[] = [];
    const tsiSamples: number[] = [];
    const nextTickDigits = Array(10).fill(0) as number[];
    const precision = Number.isInteger(pipSize) && pipSize >= 0 && pipSize <= 10 ? pipSize : null;
    let triggerCount = 0;
    let awaitingNextTick = false;
    let lastTriggeredCandle: number | null = null;

    ticks.forEach(tick => {
        if (awaitingNextTick) {
            const quoteText = typeof tick.rawQuote === 'string' ? tick.rawQuote : tick.quote.toString();
            const inferredPrecision = quoteText.includes('.') ? quoteText.split('.')[1].length : 0;
            const digitPrecision = precision ?? Math.min(inferredPrecision, 10);
            const digitText = tick.quote.toFixed(digitPrecision);
            const digit = Number(digitText[digitText.length - 1]);
            if (Number.isInteger(digit) && digit >= 0 && digit <= 9) nextTickDigits[digit]++;
            awaitingNextTick = false;
        }

        const candleTime = Math.floor(tick.epoch / MATCHES_CANDLE_SECONDS) * MATCHES_CANDLE_SECONDS;
        const currentCandle = candles[candles.length - 1];
        if (!currentCandle || currentCandle.time !== candleTime) {
            candles.push({
                time: candleTime,
                open: tick.quote,
                high: tick.quote,
                low: tick.quote,
                close: tick.quote,
            });
        } else {
            currentCandle.high = Math.max(currentCandle.high, tick.quote);
            currentCandle.low = Math.min(currentCandle.low, tick.quote);
            currentCandle.close = tick.quote;
        }

        const tsiSeries = calculateTsiSeries(candles);
        const tsi = tsiSeries[tsiSeries.length - 1] ?? null;
        if (tsi !== null) tsiSamples.push(tsi);
        const candle = candles[candles.length - 1] ?? null;
        const conditions = evaluateMatchesConditions({
            candle,
            tsi,
            tsiSamples: tsiSamples.slice(-MATCHES_TSI_FLAT_SAMPLES),
            secondsToClose: candle ? secondsUntilCandleClose(candle.time, tick.epoch) : null,
            feedFresh: true,
        });

        if (
            conditions.tradeNow &&
            candle !== null &&
            lastTriggeredCandle !== candle.time
        ) {
            triggerCount++;
            lastTriggeredCandle = candle.time;
            awaitingNextTick = true;
        }
    });

    return {
        tickCount: ticks.length,
        candleCount: candles.length,
        fromEpoch: ticks[0]?.epoch ?? null,
        toEpoch: ticks[ticks.length - 1]?.epoch ?? null,
        triggerCount,
        nextTickDigits,
    };
}

export function formatCandleCountdown(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds)) return '--:--';
    const safeSeconds = Math.max(0, Math.floor(seconds));
    return `00:${String(safeSeconds).padStart(2, '0')}`;
}
