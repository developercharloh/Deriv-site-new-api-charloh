import {
    calculateMacdSeries,
    calculateTsiSeries,
    evaluateMacdMatchesConditions,
    evaluateMatchesConditions,
    MATCHES_ENTRY_SECONDS,
    MATCHES_MACD_FAST_PERIOD,
    MATCHES_MACD_SIGNAL_PERIOD,
    MATCHES_MACD_SLOW_PERIOD,
    MATCHES_TSI_FLAT_DELTA,
    MATCHES_TSI_FLAT_SAMPLES,
    MATCHES_TSI_MAX,
    MATCHES_TSI_MIN,
    secondsUntilCandleClose,
    type Candle,
    type MacdPoint,
} from '@/pages/ai-signals/matches-signal-strategy';

export const OVER_UNDER_INDICATOR_MODES = [
    'MACD_OVER_4',
    'MACD_OVER_5',
    'TSI_UNDER_6',
    'TSI_UNDER_5',
] as const;

export type OverUnderIndicatorMode = (typeof OVER_UNDER_INDICATOR_MODES)[number];
export type OverUnderIndicator = 'MACD' | 'TSI';
export type OverUnderSide = 'OVER' | 'UNDER';

export interface OverUnderIndicatorModeConfig {
    mode: OverUnderIndicatorMode;
    side: OverUnderSide;
    barrier: number;
    indicator: OverUnderIndicator;
}

export interface OverUnderIndicatorCondition {
    key: string;
    label: string;
    met: boolean;
}

export interface OverUnderIndicatorStatus extends OverUnderIndicatorModeConfig {
    indicatorValue: number | null;
    setupReady: boolean;
    entryWindow: boolean;
    feedFresh: boolean;
    tradeNow: boolean;
    conditions: OverUnderIndicatorCondition[];
}

export const OVER_UNDER_INDICATOR_SETUPS: Record<
    OverUnderIndicatorMode,
    OverUnderIndicatorModeConfig
> = {
    MACD_OVER_4: { mode: 'MACD_OVER_4', side: 'OVER', barrier: 4, indicator: 'MACD' },
    MACD_OVER_5: { mode: 'MACD_OVER_5', side: 'OVER', barrier: 5, indicator: 'MACD' },
    TSI_UNDER_6: { mode: 'TSI_UNDER_6', side: 'UNDER', barrier: 6, indicator: 'TSI' },
    TSI_UNDER_5: { mode: 'TSI_UNDER_5', side: 'UNDER', barrier: 5, indicator: 'TSI' },
};

export const getOverUnderIndicatorModeConfig = (
    mode: string | null | undefined,
): OverUnderIndicatorModeConfig =>
    OVER_UNDER_INDICATOR_SETUPS[
        OVER_UNDER_INDICATOR_MODES.includes(mode as OverUnderIndicatorMode)
            ? (mode as OverUnderIndicatorMode)
            : 'MACD_OVER_4'
    ];

const latestMacdPoints = (candles: Candle[]): { previous: MacdPoint | null; current: MacdPoint | null } => {
    const points = calculateMacdSeries(candles).filter((point): point is MacdPoint => point !== null);
    return {
        previous: points.at(-2) ?? null,
        current: points.at(-1) ?? null,
    };
};

export const getCurrentOverUnderTsi = (candles: Candle[]): number | null =>
    calculateTsiSeries(candles).at(-1) ?? null;

export function evaluateOverUnderIndicatorStatuses(options: {
    candles: Candle[];
    tsiSamples: number[];
    secondsToClose: number | null;
    feedFresh: boolean;
}): OverUnderIndicatorStatus[] {
    const { candles, tsiSamples, secondsToClose, feedFresh } = options;
    const candle = candles.at(-1) ?? null;
    const tsi = calculateTsiSeries(candles).at(-1) ?? null;
    const { previous, current } = latestMacdPoints(candles);

    const tsiConditions = evaluateMatchesConditions({
        candle,
        tsi,
        tsiSamples,
        secondsToClose,
        feedFresh,
    });
    const macdConditions = evaluateMacdMatchesConditions({
        previous,
        current,
        secondsToClose,
        feedFresh,
    });

    const tsiSetupReady = tsiConditions.tsiInRange &&
        tsiConditions.tsiFlat &&
        tsiConditions.greenCandle;
    const macdSetupReady = macdConditions.enteringFromAbove &&
        macdConditions.signalAway;

    return OVER_UNDER_INDICATOR_MODES.map(mode => {
        const config = OVER_UNDER_INDICATOR_SETUPS[mode];
        const isMacd = config.indicator === 'MACD';
        const conditions: OverUnderIndicatorCondition[] = isMacd
            ? [
                {
                    key: 'macd-direction',
                    label: `MACD ${MATCHES_MACD_FAST_PERIOD}/${MATCHES_MACD_SLOW_PERIOD}/${MATCHES_MACD_SIGNAL_PERIOD} descends from above while its positive histogram contracts`,
                    met: macdConditions.enteringFromAbove,
                },
                {
                    key: 'signal-distance',
                    label: 'Signal-line magnitude exceeds histogram height',
                    met: macdConditions.signalAway,
                },
                {
                    key: 'entry-window',
                    label: `Broker tick at 00:${String(MATCHES_ENTRY_SECONDS).padStart(2, '0')} before candle close`,
                    met: macdConditions.entryWindow,
                },
                { key: 'fresh-feed', label: 'Fresh live broker tick', met: macdConditions.feedFresh },
            ]
            : [
                {
                    key: 'tsi-range',
                    label: `TSI in ${MATCHES_TSI_MIN.toFixed(1)}–${MATCHES_TSI_MAX.toFixed(1)} range`,
                    met: tsiConditions.tsiInRange,
                },
                {
                    key: 'tsi-flat',
                    label: `TSI flat across ${MATCHES_TSI_FLAT_SAMPLES} updates (range ≤ ${MATCHES_TSI_FLAT_DELTA.toFixed(2)})`,
                    met: tsiConditions.tsiFlat,
                },
                { key: 'green-candle', label: 'Current one-minute candle is green', met: tsiConditions.greenCandle },
                {
                    key: 'entry-window',
                    label: `Broker tick at 00:${String(MATCHES_ENTRY_SECONDS).padStart(2, '0')} before candle close`,
                    met: tsiConditions.entryWindow,
                },
                { key: 'fresh-feed', label: 'Fresh live broker tick', met: tsiConditions.feedFresh },
            ];

        return {
            ...config,
            indicatorValue: isMacd ? current?.macdLine ?? null : tsi,
            setupReady: isMacd ? macdSetupReady : tsiSetupReady,
            entryWindow: isMacd ? macdConditions.entryWindow : tsiConditions.entryWindow,
            feedFresh: isMacd ? macdConditions.feedFresh : tsiConditions.feedFresh,
            tradeNow: isMacd ? macdConditions.tradeNow : tsiConditions.tradeNow,
            conditions,
        };
    });
}

export function evaluateOverUnderIndicatorStatusesAtEpoch(options: {
    candles: Candle[];
    tsiSamples: number[];
    brokerEpoch: number | null;
    feedFresh: boolean;
}): OverUnderIndicatorStatus[] {
    const lastCandle = options.candles.at(-1) ?? null;
    const secondsToClose = lastCandle && options.brokerEpoch !== null
        ? secondsUntilCandleClose(lastCandle.time, options.brokerEpoch)
        : null;

    return evaluateOverUnderIndicatorStatuses({
        candles: options.candles,
        tsiSamples: options.tsiSamples,
        secondsToClose,
        feedFresh: options.feedFresh,
    });
}
