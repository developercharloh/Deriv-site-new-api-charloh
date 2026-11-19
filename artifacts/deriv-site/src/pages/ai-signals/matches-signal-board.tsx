import React, { useEffect, useMemo, useState } from 'react';
import { DERIV_CONTINUOUS_VOLATILITIES, type DerivVolatility } from '@/utils/deriv-volatilities';
import { useApiBase } from '@/hooks/useApiBase';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    calculateMacdSeries,
    calculateTrendStrengthIndexSeries,
    advanceMatchesPaperSignals,
    canEnterMatchesSignal,
    evaluateMacdMatchesConditions,
    evaluateMatchesConditions,
    formatCandleCountdown,
    MATCHES_DIGITS,
    MATCHES_MACD_DIGITS,
    MATCHES_HISTORY_COUNT,
    MATCHES_TSI_PERIOD,
    type MacdPoint,
    type MatchesPaperSignal,
    MATCHES_TSI_MAX,
    MATCHES_TSI_MIN,
    mergeCandle,
    normalizeCandle,
    secondsUntilCandleClose,
    type Candle,
    MATCHES_REPLAY_TICK_COUNT,
    replayMatchesTicks,
    type MatchesReplayResult,
    type MatchesSignalSetup,
} from './matches-signal-strategy';
import { subscribeToMatchesCandleFeed, type MatchesCandleApi } from './matches-candle-feed';
import './matches-signal-board.scss';

const DERIV_WS = 'wss://ws.derivws.com/websockets/v3?app_id=1';
const LIVE_TICK_MAX_AGE_MS = 2_500;
const REPLAY_TIMEOUT_MS = 30_000;
const REPLAY_REQUEST_ID_START = 5_200;

type FeedStatus = 'connecting' | 'warming' | 'live' | 'reconnecting' | 'error';
type ReplayState = 'idle' | 'loading' | 'complete' | 'error';

interface MatchesReplayMarket extends MatchesReplayResult {
    code: string;
    label: string;
}

interface MarketFeed {
    candles: Candle[];
    tsiSamples: number[];
    feedStatus: FeedStatus;
    serverEpoch: number | null;
    lastTickAt: number | null;
    error?: string;
}

interface MatchesSignalBoardProps {
    active: boolean;
    onToggle: () => void;
    maintenanceActive: boolean;
    strategy?: 'tsi' | 'macd' | 'both';
    onSelectSignal?: (selection: MatchesKingSignalSelection) => void;
}

export interface MatchesKingSignalSelection {
    symbol: DerivVolatility;
    setup: MatchesSignalSetup;
}

const makeInitialFeeds = (): Record<string, MarketFeed> => Object.fromEntries(
    DERIV_CONTINUOUS_VOLATILITIES.map(symbol => [symbol.code, {
        candles: [],
        tsiSamples: [],
        feedStatus: 'connecting' as FeedStatus,
        serverEpoch: null,
        lastTickAt: null,
    }]),
);

const toEpoch = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const epoch = Number(value);
    return Number.isFinite(epoch) ? epoch : null;
};

const updateFeed = (
    current: Record<string, MarketFeed>,
    code: string,
    update: (feed: MarketFeed) => MarketFeed,
): Record<string, MarketFeed> => {
    const feed = current[code];
    if (!feed) return current;
    return { ...current, [code]: update(feed) };
};

function requestMatchesReplayHistory(): Promise<MatchesReplayMarket[]> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(DERIV_WS);
        const requestToSymbol = new Map<number, DerivVolatility>();
        const results = new Map<string, MatchesReplayMarket>();
        let settled = false;
        const timeout = setTimeout(() => finish(new Error('Historical replay timed out. Please try again.')), REPLAY_TIMEOUT_MS);

        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try { socket.close(); } catch { /* socket already closed */ }
            if (error) reject(error);
            else resolve(DERIV_CONTINUOUS_VOLATILITIES.map(symbol => results.get(symbol.code)!));
        };

        DERIV_CONTINUOUS_VOLATILITIES.forEach((symbol, index) => {
            requestToSymbol.set(REPLAY_REQUEST_ID_START + index, symbol);
        });

        socket.onopen = () => {
            DERIV_CONTINUOUS_VOLATILITIES.forEach((symbol, index) => {
                setTimeout(() => {
                    if (settled || socket.readyState !== WebSocket.OPEN) return;
                    socket.send(JSON.stringify({
                        ticks_history: symbol.code,
                        count: MATCHES_REPLAY_TICK_COUNT,
                        end: 'latest',
                        style: 'ticks',
                        req_id: REPLAY_REQUEST_ID_START + index,
                    }));
                }, index * 100);
            });
        };

        socket.onmessage = event => {
            let message: any;
            try { message = JSON.parse(event.data); } catch { return; }
            const symbol = requestToSymbol.get(Number(message.req_id));
            if (!symbol) return;
            if (message.error) {
                finish(new Error(`${symbol.short} history request failed: ${message.error.message || 'Deriv returned an error.'}`));
                return;
            }

            const history = message.history;
            if (!history || !Array.isArray(history.times) || !Array.isArray(history.prices)) {
                finish(new Error(`${symbol.short} returned an invalid tick history response.`));
                return;
            }

            const ticks = history.times.flatMap((epoch: unknown, index: number) =>
                history.prices[index] === undefined
                    ? []
                    : [{ epoch: Number(epoch), quote: history.prices[index] }],
            );
            const replay = replayMatchesTicks(ticks, Number(message.pip_size ?? history.pip_size));
            if (replay.tickCount === 0) {
                finish(new Error(`${symbol.short} returned no usable historical ticks.`));
                return;
            }
            results.set(symbol.code, { ...replay, code: symbol.code, label: symbol.label });
            if (results.size === DERIV_CONTINUOUS_VOLATILITIES.length) finish();
        };

        socket.onerror = () => finish(new Error('Could not connect to Deriv for historical replay.'));
        socket.onclose = () => {
            if (!settled) finish(new Error('Deriv closed the historical replay connection before all markets returned.'));
        };
    });
}

function MiniCandleTsiChart({ candles, tsiSeries, label }: {
    candles: Candle[];
    tsiSeries: Array<number | null>;
    label: string;
}) {
    const visibleCandles = candles.slice(-36);
    const visibleTsi = tsiSeries.slice(-36);
    const width = 320;
    const priceTop = 8;
    const priceBottom = 82;
    const tsiTop = 101;
    const tsiBottom = 153;
    const values = visibleCandles.flatMap(candle => [candle.high, candle.low]);
    const minPrice = Math.min(...values);
    const maxPrice = Math.max(...values);
    const priceRange = maxPrice - minPrice || Math.max(Math.abs(maxPrice) * 0.0001, 1);
    const step = width / Math.max(visibleCandles.length, 1);
    const bodyWidth = Math.max(2, Math.min(7, step * 0.58));
    const priceY = (value: number) => priceBottom - ((value - minPrice) / priceRange) * (priceBottom - priceTop);
    const tsiY = (value: number) => tsiBottom - ((Math.max(-1, Math.min(1, value)) + 1) / 2) * (tsiBottom - tsiTop);
    const bandTop = tsiY(MATCHES_TSI_MAX);
    const bandBottom = tsiY(MATCHES_TSI_MIN);
    const linePoints = visibleTsi
        .map((value, index) => value === null ? null : `${(index + 0.5) * step},${tsiY(value)}`)
        .filter((point): point is string => point !== null)
        .join(' ');
    if (!visibleCandles.length) {
        return <div className='match-chart match-chart--empty' aria-label={`${label} chart loading`}>
            Waiting for one-minute candle history…
        </div>;
    }

    return (
        <svg className='match-chart' viewBox={`0 0 ${width} 162`} role='img' aria-label={`${label} one-minute candlesticks and Trend Strength Index`}>
            <rect x='0' y={bandTop} width={width} height={bandBottom - bandTop} className='match-chart__tsi-band' />
            <line x1='0' x2={width} y1={priceBottom + 5} y2={priceBottom + 5} className='match-chart__divider' />
            <line x1='0' x2={width} y1={bandTop} y2={bandTop} className='match-chart__tsi-guide' />
            <line x1='0' x2={width} y1={bandBottom} y2={bandBottom} className='match-chart__tsi-guide' />
            {visibleCandles.map((candle, index) => {
                const centerX = (index + 0.5) * step;
                const openY = priceY(candle.open);
                const closeY = priceY(candle.close);
                const green = candle.close > candle.open;
                return (
                    <g key={`${candle.time}-${index}`} className={green ? 'match-chart__candle--green' : 'match-chart__candle--red'}>
                        <line x1={centerX} x2={centerX} y1={priceY(candle.high)} y2={priceY(candle.low)} className='match-chart__wick' />
                        <rect
                            x={centerX - bodyWidth / 2}
                            y={Math.min(openY, closeY)}
                            width={bodyWidth}
                            height={Math.max(1, Math.abs(closeY - openY))}
                            className='match-chart__body'
                        />
                    </g>
                );
            })}
            {linePoints && <polyline points={linePoints} className='match-chart__tsi-line' />}
            <text x='4' y='97' className='match-chart__label'>Trend Strength Index {MATCHES_TSI_PERIOD}</text>
            <text x={width - 25} y={bandTop - 2} className='match-chart__axis-label'>0.9</text>
            <text x={width - 25} y={bandBottom + 9} className='match-chart__axis-label'>0.8</text>
        </svg>
    );
}

function MiniCandleMacdChart({ candles, macdSeries, label }: {
    candles: Candle[];
    macdSeries: Array<MacdPoint | null>;
    label: string;
}) {
    const visibleCandles = candles.slice(-36);
    const visibleMacd = macdSeries.slice(-36);
    const width = 320;
    const priceTop = 8;
    const priceBottom = 82;
    const macdTop = 101;
    const macdBottom = 153;
    const prices = visibleCandles.flatMap(candle => [candle.high, candle.low]);
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const priceRange = priceMax - priceMin || Math.max(Math.abs(priceMax) * 0.0001, 1);
    const step = width / Math.max(visibleCandles.length, 1);
    const bodyWidth = Math.max(2, Math.min(7, step * 0.58));
    const priceY = (value: number) => priceBottom - ((value - priceMin) / priceRange) * (priceBottom - priceTop);
    const indicatorPoints = visibleMacd.filter((point): point is MacdPoint => point !== null);
    const indicatorValues = indicatorPoints.flatMap(point => [point.macdLine, point.signalLine, point.histogram, 0]);
    const macdMin = indicatorValues.length ? Math.min(...indicatorValues) : -1;
    const macdMax = indicatorValues.length ? Math.max(...indicatorValues) : 1;
    const macdRange = macdMax - macdMin || Math.max(Math.abs(macdMax) * 0.0001, 1);
    const macdY = (value: number) => macdBottom - ((value - macdMin) / macdRange) * (macdBottom - macdTop);
    const zeroY = macdY(0);
    const linePoints = visibleMacd
        .map((point, index) => point === null ? null : `${(index + 0.5) * step},${macdY(point.macdLine)}`)
        .filter((point): point is string => point !== null)
        .join(' ');
    const signalPoints = visibleMacd
        .map((point, index) => point === null ? null : `${(index + 0.5) * step},${macdY(point.signalLine)}`)
        .filter((point): point is string => point !== null)
        .join(' ');

    if (!visibleCandles.length || !indicatorPoints.length) {
        return <div className='match-chart match-chart--empty' aria-label={`${label} MACD chart loading`}>
            {visibleCandles.length ? 'Warming up MACD history…' : 'Waiting for one-minute candle history…'}
        </div>;
    }

    return (
        <svg className='match-chart' viewBox={`0 0 ${width} 162`} role='img' aria-label={`${label} one-minute candlesticks and MACD 12/26/9`}>
            <line x1='0' x2={width} y1={priceBottom + 5} y2={priceBottom + 5} className='match-chart__divider' />
            {visibleCandles.map((candle, index) => {
                const centerX = (index + 0.5) * step;
                const openY = priceY(candle.open);
                const closeY = priceY(candle.close);
                const green = candle.close > candle.open;
                return (
                    <g key={`${candle.time}-${index}`} className={green ? 'match-chart__candle--green' : 'match-chart__candle--red'}>
                        <line x1={centerX} x2={centerX} y1={priceY(candle.high)} y2={priceY(candle.low)} className='match-chart__wick' />
                        <rect
                            x={centerX - bodyWidth / 2}
                            y={Math.min(openY, closeY)}
                            width={bodyWidth}
                            height={Math.max(1, Math.abs(closeY - openY))}
                            className='match-chart__body'
                        />
                    </g>
                );
            })}
            <line x1='0' x2={width} y1={zeroY} y2={zeroY} className='match-chart__macd-zero' />
            {visibleMacd.map((point, index) => {
                if (!point) return null;
                const centerX = (index + 0.5) * step;
                const barY = macdY(point.histogram);
                return (
                    <rect
                        key={`hist-${index}`}
                        x={centerX - Math.max(1, bodyWidth / 3)}
                        y={Math.min(zeroY, barY)}
                        width={Math.max(2, bodyWidth * 0.66)}
                        height={Math.max(1, Math.abs(zeroY - barY))}
                        className={point.histogram >= 0 ? 'match-chart__macd-hist--positive' : 'match-chart__macd-hist--negative'}
                    />
                );
            })}
            {linePoints && <polyline points={linePoints} className='match-chart__macd-line' />}
            {signalPoints && <polyline points={signalPoints} className='match-chart__macd-signal' />}
            <text x='4' y='97' className='match-chart__label'>MACD / Signal / Histogram</text>
        </svg>
    );
}

export function MatchesSignalBoard({
    active,
    onToggle,
    maintenanceActive,
    strategy = 'both',
    onSelectSignal,
}: MatchesSignalBoardProps) {
    const [feeds, setFeeds] = useState<Record<string, MarketFeed>>(makeInitialFeeds);
    const [clockNow, setClockNow] = useState(Date.now());
    const { connectionStatus } = useApiBase();
    const api = api_base.api as unknown as MatchesCandleApi | null;
    const [replayState, setReplayState] = useState<ReplayState>('idle');
    const [replayResults, setReplayResults] = useState<MatchesReplayMarket[]>([]);
    const [replayError, setReplayError] = useState('');
    const [paperSignals, setPaperSignals] = useState<MatchesPaperSignal[]>([]);

    const runHistoricalReplay = async () => {
        setReplayState('loading');
        setReplayError('');
        setReplayResults([]);
        try {
            setReplayResults(await requestMatchesReplayHistory());
            setReplayState('complete');
        } catch (error) {
            setReplayError(error instanceof Error ? error.message : 'Historical replay failed.');
            setReplayState('error');
        }
    };

    useEffect(() => {
        if (!active || maintenanceActive) {
            setFeeds(previous => Object.fromEntries(
                DERIV_CONTINUOUS_VOLATILITIES.map(symbol => [symbol.code, {
                    ...previous[symbol.code],
                    feedStatus: maintenanceActive ? 'error' : 'connecting',
                    error: maintenanceActive ? 'Deriv market data is under maintenance.' : undefined,
                    tsiSamples: [],
                }]),
            ));
            return;
        }

        if (connectionStatus !== 'opened' || !api) {
            const isReconnecting = connectionStatus === 'closed';
            setFeeds(previous => Object.fromEntries(
                DERIV_CONTINUOUS_VOLATILITIES.map(symbol => [symbol.code, {
                    ...previous[symbol.code],
                    feedStatus: isReconnecting ? 'reconnecting' : 'connecting',
                    error: isReconnecting ? 'Waiting for the site’s Deriv connection to recover.' : undefined,
                    tsiSamples: [],
                    lastTickAt: null,
                    serverEpoch: null,
                }]),
            ));
            return;
        }

        setFeeds(previous => Object.fromEntries(
            DERIV_CONTINUOUS_VOLATILITIES.map(symbol => [symbol.code, {
                ...previous[symbol.code],
                feedStatus: 'connecting',
                error: undefined,
                tsiSamples: [],
                lastTickAt: null,
                serverEpoch: null,
            }]),
        ));

        return subscribeToMatchesCandleFeed({
            api,
            symbols: DERIV_CONTINUOUS_VOLATILITIES,
            onHistory: (code, rawCandles) => {
                const candles = rawCandles
                    .map(item => normalizeCandle(item))
                    .filter((item): item is Candle => item !== null)
                    .sort((a, b) => a.time - b.time)
                    .slice(-MATCHES_HISTORY_COUNT);
                setFeeds(previous => updateFeed(previous, code, feed => ({
                    ...feed,
                    candles,
                    feedStatus: candles.length ? 'warming' : 'error',
                    error: candles.length ? undefined : 'No one-minute candles were returned.',
                })));
            },
            onCandle: (code, rawOhlc, serverTime) => {
                const candle = normalizeCandle(rawOhlc);
                const tickEpoch = toEpoch(rawOhlc.epoch) ?? toEpoch(serverTime);
                if (!candle || tickEpoch === null) return;
                setFeeds(previous => updateFeed(previous, code, feed => {
                    const candles = mergeCandle(feed.candles, candle);
                    const tsi = calculateTrendStrengthIndexSeries(candles).slice(-1)[0] ?? null;
                    const tsiSamples = tsi === null
                        ? feed.tsiSamples
                        : [...feed.tsiSamples, tsi].slice(-3);
                    return {
                        ...feed,
                        candles,
                        tsiSamples,
                        feedStatus: 'live',
                        serverEpoch: tickEpoch,
                        lastTickAt: Date.now(),
                        error: undefined,
                    };
                }));
            },
            onStatus: (code, feedStatus, message) => {
                setFeeds(previous => updateFeed(previous, code, feed => ({
                    ...feed,
                    feedStatus,
                    error: message,
                    lastTickAt: feedStatus === 'reconnecting' ? null : feed.lastTickAt,
                })));
            },
        });
    }, [active, api, connectionStatus, maintenanceActive]);

    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setClockNow(Date.now()), 250);
        return () => clearInterval(timer);
    }, [active]);

    const marketCards = useMemo(() => DERIV_CONTINUOUS_VOLATILITIES.map(symbol => {
        const feed = feeds[symbol.code];
        const tsiSeries = calculateTrendStrengthIndexSeries(feed.candles);
        const macdSeries = calculateMacdSeries(feed.candles);
        const validMacdPoints = macdSeries.filter((point): point is MacdPoint => point !== null);
        const macdPoint = validMacdPoints[validMacdPoints.length - 1] ?? null;
        const previousMacdPoint = validMacdPoints[validMacdPoints.length - 2] ?? null;
        const tsi = tsiSeries[tsiSeries.length - 1] ?? null;
        const lastCandle = feed.candles[feed.candles.length - 1] ?? null;
        const feedFresh = active && feed.feedStatus === 'live' &&
            feed.lastTickAt !== null && clockNow - feed.lastTickAt <= LIVE_TICK_MAX_AGE_MS;
        const serverNow = feed.serverEpoch !== null && feed.lastTickAt !== null
            ? feed.serverEpoch + Math.max(0, (clockNow - feed.lastTickAt) / 1000)
            : null;
        const secondsToClose = lastCandle && serverNow !== null
            ? secondsUntilCandleClose(lastCandle.time, serverNow)
            : null;
        const tsiConditions = evaluateMatchesConditions({
            candle: lastCandle,
            tsi,
            tsiSamples: feed.tsiSamples,
            secondsToClose,
            feedFresh,
        });
        const macdConditions = evaluateMacdMatchesConditions({
            previous: previousMacdPoint,
            current: macdPoint,
            secondsToClose,
            feedFresh,
        });
        const tradeNow = strategy === 'tsi' ? tsiConditions.tradeNow : macdConditions.tradeNow;
        const status = !active ? 'Paused' :
            maintenanceActive ? 'Maintenance' :
                feedFresh ? 'Live' :
                    feed.feedStatus === 'error' ? 'Unavailable' :
                        feed.feedStatus === 'reconnecting' ? 'Reconnecting' :
                            feed.candles.length ? 'Waiting for live tick' : 'Loading candles';

        return {
            symbol, feed, feedFresh, tsiSeries, macdSeries, macdPoint, tsi, lastCandle,
            secondsToClose, tsiConditions, macdConditions, tradeNow, status,
        };
    }), [active, clockNow, feeds, maintenanceActive, strategy]);
    const liveMarketCount = marketCards.filter(card => card.status === 'Live').length;
    const enabledModes = strategy === 'both' ? ['tsi', 'macd'] as const : [strategy];
    const qualifiedMarketCards = marketCards
        .map(card => ({
            ...card,
            qualifiedModes: enabledModes.filter(mode =>
                canEnterMatchesSignal(mode, card.tsiConditions, card.macdConditions)
            ),
        }))
        .filter(card => card.qualifiedModes.length > 0);
    useEffect(() => {
        setPaperSignals(previous => marketCards.reduce((signals, card) => {
            const rawPipSize = api_base.pip_sizes?.[card.symbol.code];
            const parsedPipSize = Number(rawPipSize);
            return advanceMatchesPaperSignals(signals, {
                marketCode: card.symbol.code,
                marketLabel: card.symbol.label,
                candle: card.lastCandle,
                tsi: card.tsi,
                alertEpoch: card.feed.serverEpoch,
                qualifying: strategy !== 'macd' && card.tsiConditions.tradeNow,
                nextTickQuote: card.feed.serverEpoch === null ? null : card.lastCandle?.close ?? null,
                pipSize: Number.isInteger(parsedPipSize) ? parsedPipSize : null,
            });
        }, previous));
    }, [marketCards, strategy]);

    const connectionMessage = !active
        ? 'Scanner paused'
        : maintenanceActive
            ? 'Market data is under maintenance'
            : liveMarketCount === marketCards.length
                ? `Live on all ${liveMarketCount} one-second indices`
                : liveMarketCount > 0
                    ? `Live on ${liveMarketCount} of ${marketCards.length} indices`
                    : connectionStatus === 'closed'
                        ? 'Reconnecting to the site Deriv connection'
                        : connectionStatus === 'opened'
                            ? 'Site connected · waiting for candle updates'
                            : 'Connecting to the site Deriv connection';

    return (
        <section className='match-board' aria-label='Matches signal scanner'>
            <div className='match-board__header'>
                <div>
                    <h2 className='match-board__title'>Matches</h2>
                    <p className='match-board__subtitle'>
                        {active
                            ? `Watching ${DERIV_CONTINUOUS_VOLATILITIES.length} one-second Volatility indices`
                            : 'Scanner paused'}
                    </p>
                </div>
                <button
                    type='button'
                    className={`match-board__toggle${active ? ' match-board__toggle--active' : ''}`}
                    disabled={maintenanceActive}
                    onClick={onToggle}
                >
                    {active ? 'Pause' : 'Resume'}
                </button>
            </div>

            <div className='match-board__rule'>
                {strategy === 'both'
                    ? 'Both setups scan together on every market. TSI: Matches 0–4. MACD: Matches 6–9. Enter Now appears when a setup and fresh live feed are ready.'
                    : strategy === 'tsi'
                    ? 'Enter Now appears when the live candle is green, normalized TSI is 0.80–0.90 and flat. 00:02 is a timing reference only.'
                    : 'Enter Now appears when MACD descends toward signal from above and signal-line magnitude exceeds histogram height. 00:02 is a timing reference only.'}
                {' '}Only setups passing every required check with fresh live data are shown. Qualification does not guarantee profit.
                {' '}After you save and run #19, it starts selecting entries from incoming live ticks.
            </div>

            <div
                className={`match-board__connection${liveMarketCount === marketCards.length ? ' match-board__connection--live' : ''}${connectionStatus === 'closed' ? ' match-board__connection--reconnecting' : ''}`}
                role='status'
                aria-live='polite'
            >
                <span className='match-board__connection-dot' />
                <span>{connectionMessage}</span>
                <span className='match-board__connection-count'>{liveMarketCount}/{marketCards.length} live</span>
            </div>

            <section className='match-replay' aria-label='Historical Matches setup replay'>
                <div className='match-replay__header'>
                    <div>
                        <h3>Historical setup replay</h3>
                        <p>Rebuilds one-minute candles from the latest {MATCHES_REPLAY_TICK_COUNT.toLocaleString()} ticks per market.</p>
                    </div>
                    <button
                        type='button'
                        className='match-replay__button'
                        onClick={runHistoricalReplay}
                        disabled={replayState === 'loading' || maintenanceActive}
                    >
                        {replayState === 'loading' ? 'Replaying…' : 'Replay history'}
                    </button>
                </div>
                <p className='match-replay__disclaimer'>
                    Historical observations only—not a profit guarantee. Digit counts show the next tick after each setup trigger, not trade performance.
                </p>
                {replayState === 'loading' && (
                    <p className='match-replay__status' role='status'>Loading bounded tick history for all eight markets…</p>
                )}
                {replayState === 'error' && (
                    <p className='match-replay__status match-replay__status--error' role='alert'>{replayError}</p>
                )}
                {replayState === 'complete' && (
                    <div className='match-replay__grid' aria-live='polite'>
                        {replayResults.map(result => {
                            const nextTickCount = result.nextTickDigits.reduce((sum, count) => sum + count, 0);
                            return (
                                <article className='match-replay__market' key={result.code}>
                                    <strong>{result.label}</strong>
                                    <span>{result.triggerCount} setup {result.triggerCount === 1 ? 'trigger' : 'triggers'}</span>
                                    <span>{nextTickCount} next-tick {nextTickCount === 1 ? 'digit' : 'digits'} recorded</span>
                                    <span>{result.tickCount.toLocaleString()} ticks · {result.candleCount} candles analyzed</span>
                                    {result.fromEpoch !== null && result.toEpoch !== null && (
                                        <small>
                                            {new Date(result.fromEpoch * 1000).toLocaleString()} – {new Date(result.toEpoch * 1000).toLocaleString()}
                                        </small>
                                    )}
                                    <div className='match-replay__digits' aria-label={`${result.label} next-tick digit counts`}>
                                        {result.nextTickDigits.map((count, digit) => (
                                            <span key={digit} title={`Digit ${digit}: ${count}`}>
                                                <b>{digit}</b>{count}
                                            </span>
                                        ))}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>

            <section className='match-paper' aria-label='Recent paper signal history'>
                <div className='match-paper__header'>
                    <div>
                        <h3>Recent Matches 0–4 signals</h3>
                        <p>Each alert is checked against the next live tick only.</p>
                    </div>
                    <span className='match-paper__badge'>PAPER RESULTS · NO TRADES</span>
                </div>
                {paperSignals.length === 0 ? (
                    <p className='match-paper__empty'>No qualifying Matches 0–4 alerts yet.</p>
                ) : (
                    <div className='match-paper__list' aria-live='polite'>
                        {[...paperSignals].reverse().map(signal => (
                            <article className='match-paper__row' key={signal.id}>
                                <div className='match-paper__market'>
                                    <strong>{signal.marketLabel}</strong>
                                    <span>MATCH {signal.targetDigit}</span>
                                </div>
                                <div className='match-paper__details'>
                                    <span>Candle {new Date(signal.candle.time * 1000).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                    })}</span>
                                    <span>TSI {signal.tsi.toFixed(3)}</span>
                                </div>
                                <span className={`match-paper__result match-paper__result--${signal.result}`}>
                                    {signal.result === 'pending'
                                        ? 'Waiting for next tick'
                                        : signal.result === 'unavailable'
                                            ? 'Result unavailable'
                                            : `Paper ${signal.result} · next digit ${signal.nextTickDigit}`}
                                </span>
                            </article>
                        ))}
                    </div>
                )}
            </section>

            <div className='match-board__grid'>
                {qualifiedMarketCards.map(({
                    symbol, feed, feedFresh, tsiSeries, macdSeries, macdPoint, tsi, lastCandle,
                    secondsToClose, tsiConditions, macdConditions, status, qualifiedModes,
                }) => (
                    <article className='match-market' key={symbol.code}>
                        <div className='match-market__header'>
                            <div>
                                <strong className='match-market__symbol'>{symbol.short}</strong>
                                <span className='match-market__label'>{symbol.label}</span>
                                <span className='match-market__range'>
                                    {qualifiedModes.map(mode => mode === 'tsi' ? 'MATCHES 0–4' : 'MATCHES 6–9').join(' + ')}
                                </span>
                            </div>
            <span className={`match-market__status match-market__status--${status.toLowerCase().replace(/\s+/g, '-')}`}>
                                {status}
                            </span>
                        </div>

                        {qualifiedModes.map(mode => {
                            const range = mode === 'tsi' ? '0–4' : '6–9';
                            const ready = canEnterMatchesSignal(mode, tsiConditions, macdConditions);
                            const strategyChecks = mode === 'tsi'
                                ? [
                                    { label: 'TSI in target range', met: tsiConditions.tsiInRange },
                                    { label: 'TSI flat across live updates', met: tsiConditions.tsiFlat },
                                    { label: 'Green candle', met: tsiConditions.greenCandle },
                                ]
                                : [
                                    { label: 'MACD descends from above', met: macdConditions.enteringFromAbove },
                                    { label: 'Signal line separated from histogram', met: macdConditions.signalAway },
                                ];
                            return <div className='match-market__setup' key={mode}>
                        <div className='match-market__setup-status match-market__setup-status--alert'>
                            <strong>MATCHES {range} · {mode.toUpperCase()}</strong>
                            <span>QUALIFIED SETUP · ALL {strategyChecks.length}/{strategyChecks.length} CHECKS PASS</span>
                        </div>
                        {mode === 'tsi' ? (
                            <MiniCandleTsiChart
                                candles={feed.candles}
                                tsiSeries={tsiSeries}
                                label={symbol.label}
                            />
                        ) : (
                            <MiniCandleMacdChart candles={feed.candles} macdSeries={macdSeries} label={symbol.label} />
                        )}

                        <div className='match-market__metrics'>
                            {strategyChecks.map(check => (
                                <span className='is-ready' key={check.label}>
                                    <i aria-hidden='true'>✓</i> {check.label}
                                </span>
                            ))}
                            <span className='is-ready'>
                                <i aria-hidden='true'>✓</i> Fresh live feed
                            </span>
                            <span className={secondsToClose === 2 ? 'is-ready' : ''} aria-label={`Candle-close timing reference, not a signal gate: ${formatCandleCountdown(secondsToClose)}`}>
                                {formatCandleCountdown(secondsToClose)}
                            </span>
                        </div>

                        {ready ? (
                            <div
                                className='match-market__alerts'
                                aria-label={`Ready setup: ${symbol.label} Matches digits ${mode === 'tsi' ? 'zero through four' : 'six through nine'}`}
                            >
                                <strong className='match-market__alerts-heading'>
                                    MATCHES {range} SETUP
                                </strong>
                                {(mode === 'tsi' ? MATCHES_DIGITS : MATCHES_MACD_DIGITS).map(digit => (
                                    <span className='match-market__alert' key={digit}>
                                        <strong>MATCH {digit}</strong>
                                        <span>READY</span>
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <div className='match-market__waiting'>
                                {feed.error || (active
                                    ? `Waiting for ${mode.toUpperCase()} setup conditions and a fresh live feed.`
                                    : 'Resume the scanner to receive live candle data.')}
                            </div>
                        )}
                        {ready && onSelectSignal && (
                            <button
                                type='button'
                                className='match-market__enter'
                                data-testid={`button-enter-matches-king-${symbol.code}-${mode}`}
                                onClick={() => onSelectSignal({ symbol, setup: mode })}
                            >
                                Enter Now · Matches King
                            </button>
                        )}
                            </div>;
                        })}
                    </article>
                ))}
                {qualifiedMarketCards.length === 0 && (
                    <p className='match-market__waiting' role='status'>
                        {active ? 'No qualified setups right now. Incomplete setups are hidden.' : 'Scanner paused. Resume to look for qualified setups.'}
                    </p>
                )}
            </div>
        </section>
    );
}

export function MatchesSignalSection(props: MatchesSignalBoardProps) {
    return <MatchesSignalBoard {...props} strategy='both' />;
}
