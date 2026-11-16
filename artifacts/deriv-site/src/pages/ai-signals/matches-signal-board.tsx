import React, { useEffect, useMemo, useState } from 'react';
import { DERIV_CONTINUOUS_VOLATILITIES, type DerivVolatility } from '@/utils/deriv-volatilities';
import {
    calculateMacdSeries,
    calculateTsiSeries,
    calculateTsiSignalSeries,
    evaluateMacdMatchesConditions,
    evaluateMatchesConditions,
    formatCandleCountdown,
    MATCHES_CANDLE_SECONDS,
    MATCHES_DIGITS,
    MATCHES_MACD_DIGITS,
    MATCHES_HISTORY_COUNT,
    type MacdPoint,
    MATCHES_TSI_MAX,
    MATCHES_TSI_MIN,
    MATCHES_TSI_SIGNAL_PERIOD,
    mergeCandle,
    normalizeCandle,
    secondsUntilCandleClose,
    type Candle,
} from './matches-signal-strategy';
import './matches-signal-board.scss';

const DERIV_WS = 'wss://ws.derivws.com/websockets/v3?app_id=1';
const LIVE_TICK_MAX_AGE_MS = 2_500;
const HISTORY_TIMEOUT_MS = 18_000;

type FeedStatus = 'connecting' | 'warming' | 'live' | 'reconnecting' | 'error';

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
    strategy?: 'tsi' | 'macd';
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

function MiniCandleTsiChart({ candles, tsiSeries, tsiSignalSeries, label }: {
    candles: Candle[];
    tsiSeries: Array<number | null>;
    tsiSignalSeries: Array<number | null>;
    label: string;
}) {
    const visibleCandles = candles.slice(-36);
    const visibleTsi = tsiSeries.slice(-36);
    const visibleTsiSignal = tsiSignalSeries.slice(-36);
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
    const signalPoints = visibleTsiSignal
        .map((value, index) => value === null ? null : `${(index + 0.5) * step},${tsiY(value)}`)
        .filter((point): point is string => point !== null)
        .join(' ');

    if (!visibleCandles.length) {
        return <div className='match-chart match-chart--empty' aria-label={`${label} chart loading`}>
            Waiting for one-minute candle history…
        </div>;
    }

    return (
        <svg className='match-chart' viewBox={`0 0 ${width} 162`} role='img' aria-label={`${label} one-minute candlesticks and normalized TSI`}>
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
            {signalPoints && <polyline points={signalPoints} className='match-chart__tsi-signal' />}
            <text x='4' y='97' className='match-chart__label'>TSI / Signal</text>
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

export function MatchesSignalBoard({ active, onToggle, maintenanceActive, strategy = 'tsi' }: MatchesSignalBoardProps) {
    const [feeds, setFeeds] = useState<Record<string, MarketFeed>>(makeInitialFeeds);
    const [clockNow, setClockNow] = useState(Date.now());

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

        let stopped = false;
        let socket: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let historyTimer: ReturnType<typeof setTimeout> | null = null;
        let retryAttempt = 0;
        const requestToSymbol = new Map<number, DerivVolatility>();
        const subscriptionToSymbol = new Map<string, string>();
        const receivedHistory = new Set<string>();

        DERIV_CONTINUOUS_VOLATILITIES.forEach((symbol, index) => {
            requestToSymbol.set(4200 + index, symbol);
        });

        const openSocket = () => {
            if (stopped) return;
            setFeeds(previous => Object.fromEntries(
                DERIV_CONTINUOUS_VOLATILITIES.map(symbol => [symbol.code, {
                    ...previous[symbol.code],
                    feedStatus: retryAttempt > 0 ? 'reconnecting' : 'connecting',
                    error: undefined,
                    tsiSamples: [],
                    lastTickAt: null,
                    serverEpoch: null,
                }]),
            ));
            receivedHistory.clear();
            subscriptionToSymbol.clear();

            try {
                socket = new WebSocket(DERIV_WS);
            } catch {
                scheduleReconnect();
                return;
            }

            socket.onopen = () => {
                retryAttempt = 0;
                DERIV_CONTINUOUS_VOLATILITIES.forEach((symbol, index) => {
                    const requestId = 4200 + index;
                    setTimeout(() => {
                        if (stopped || socket?.readyState !== WebSocket.OPEN) return;
                        socket.send(JSON.stringify({
                            ticks_history: symbol.code,
                            count: MATCHES_HISTORY_COUNT,
                            end: 'latest',
                            style: 'candles',
                            granularity: MATCHES_CANDLE_SECONDS,
                            subscribe: 1,
                            req_id: requestId,
                        }));
                    }, index * 80);
                });
                historyTimer = setTimeout(() => {
                    if (stopped || receivedHistory.size === DERIV_CONTINUOUS_VOLATILITIES.length) return;
                    setFeeds(previous => Object.fromEntries(
                        DERIV_CONTINUOUS_VOLATILITIES.map(symbol => {
                            const feed = previous[symbol.code];
                            return [symbol.code, feed.candles.length
                                ? feed
                                : { ...feed, feedStatus: 'error' as FeedStatus, error: 'Candle history is unavailable; retrying.' }];
                        }),
                    ));
                    if (receivedHistory.size === 0) socket?.close();
                }, HISTORY_TIMEOUT_MS);
            };

            socket.onmessage = event => {
                let message: any;
                try { message = JSON.parse(event.data); } catch { return; }
                const requestId = Number(message.req_id);
                const requestSymbol = requestToSymbol.get(requestId);
                const subscriptionId = message.subscription?.id;
                if (requestSymbol && subscriptionId !== undefined) {
                    subscriptionToSymbol.set(String(subscriptionId), requestSymbol.code);
                }

                if (message.error) {
                    if (requestSymbol) {
                        setFeeds(previous => updateFeed(previous, requestSymbol.code, feed => ({
                            ...feed,
                            feedStatus: 'error',
                            error: message.error.message || 'Deriv rejected the candle request.',
                        })));
                    }
                    return;
                }

                const historyCandles = Array.isArray(message.candles)
                    ? message.candles
                    : Array.isArray(message.history?.candles) ? message.history.candles : null;
                if (historyCandles && requestSymbol) {
                    const candles = historyCandles
                        .map((item: unknown) => normalizeCandle(item))
                        .filter((item: Candle | null): item is Candle => item !== null)
                        .sort((a: Candle, b: Candle) => a.time - b.time)
                        .slice(-MATCHES_HISTORY_COUNT);
                    receivedHistory.add(requestSymbol.code);
                    setFeeds(previous => updateFeed(previous, requestSymbol.code, feed => ({
                        ...feed,
                        candles,
                        feedStatus: candles.length ? 'warming' : 'error',
                        error: candles.length ? undefined : 'No one-minute candles were returned.',
                    })));
                }

                if (message.msg_type !== 'ohlc' || !message.ohlc) return;
                const ohlc = message.ohlc;
                const code = String(ohlc.symbol ?? '') ||
                    (subscriptionId !== undefined ? subscriptionToSymbol.get(String(subscriptionId)) : '') ||
                    requestSymbol?.code;
                if (!code) return;

                const candle = normalizeCandle(ohlc);
                const tickEpoch = toEpoch(ohlc.epoch) ?? toEpoch(message.time);
                if (!candle || tickEpoch === null) return;

                setFeeds(previous => updateFeed(previous, code, feed => {
                    const candles = mergeCandle(feed.candles, candle);
                    const tsi = calculateTsiSeries(candles).at(-1) ?? null;
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
            };

            socket.onerror = () => socket?.close();
            socket.onclose = () => {
                if (historyTimer) clearTimeout(historyTimer);
                if (!stopped) scheduleReconnect();
            };
        };

        const scheduleReconnect = () => {
            if (stopped || reconnectTimer) return;
            retryAttempt++;
            const delay = Math.min(1_000 * (2 ** Math.min(retryAttempt, 4)), 15_000);
            setFeeds(previous => Object.fromEntries(
                DERIV_CONTINUOUS_VOLATILITIES.map(symbol => [symbol.code, {
                    ...previous[symbol.code],
                    feedStatus: 'reconnecting',
                    error: undefined,
                    tsiSamples: [],
                    lastTickAt: null,
                    serverEpoch: null,
                }]),
            ));
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                openSocket();
            }, delay);
        };

        openSocket();
        return () => {
            stopped = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (historyTimer) clearTimeout(historyTimer);
            if (socket) {
                socket.onopen = null;
                socket.onmessage = null;
                socket.onerror = null;
                socket.onclose = null;
                try { socket.close(); } catch { /* socket already closed */ }
            }
        };
    }, [active, maintenanceActive]);

    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setClockNow(Date.now()), 250);
        return () => clearInterval(timer);
    }, [active]);

    const marketCards = useMemo(() => DERIV_CONTINUOUS_VOLATILITIES.map(symbol => {
        const feed = feeds[symbol.code];
        const tsiSeries = calculateTsiSeries(feed.candles);
        const tsiSignalSeries = calculateTsiSignalSeries(feed.candles);
        const macdSeries = calculateMacdSeries(feed.candles);
        const validMacdPoints = macdSeries.filter((point): point is MacdPoint => point !== null);
        const macdPoint = validMacdPoints.at(-1) ?? null;
        const previousMacdPoint = validMacdPoints.at(-2) ?? null;
        const tsi = tsiSeries.at(-1) ?? null;
        const lastCandle = feed.candles.at(-1) ?? null;
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
            symbol, feed, tsiSeries, tsiSignalSeries, macdSeries, macdPoint, tsi, lastCandle,
            secondsToClose, tsiConditions, macdConditions, tradeNow, status,
        };
    }), [active, clockNow, feeds, maintenanceActive, strategy]);

    return (
        <section className='match-board' aria-label={strategy === 'tsi' ? 'Matches 0 to 4 signal scanner' : 'Matches 6 to 9 signal scanner'}>
            <div className='match-board__header'>
                <div>
                    <h2 className='match-board__title'>
                        {strategy === 'tsi' ? 'Matches 0–4 · 1-minute TSI strategy' : 'Matches 6–9 · 1-minute MACD strategy'}
                    </h2>
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
                {strategy === 'tsi'
                    ? 'Alert only when the live candle is green, normalized TSI is 0.80–0.90 and flat, and 00:02 remains.'
                    : 'Alert when MACD descends toward signal from above, signal-line magnitude exceeds histogram height, and 00:02 remains. Candle color is ignored.'}
                {' '}No trades are placed automatically.
            </div>

            <div className='match-board__grid'>
                {marketCards.map(({
                    symbol, feed, tsiSeries, tsiSignalSeries, macdSeries, macdPoint, tsi, lastCandle,
                    secondsToClose, tsiConditions, macdConditions, tradeNow, status,
                }) => (
                    <article className='match-market' key={symbol.code}>
                        <div className='match-market__header'>
                            <div>
                                <strong className='match-market__symbol'>{symbol.short}</strong>
                                <span className='match-market__label'>{symbol.label}</span>
                            </div>
            <span className={`match-market__status match-market__status--${status.toLowerCase().replace(/\s+/g, '-')}`}>
                                {status}
                            </span>
                        </div>

                        {strategy === 'tsi' ? (
                            <MiniCandleTsiChart
                                candles={feed.candles}
                                tsiSeries={tsiSeries}
                                tsiSignalSeries={tsiSignalSeries}
                                label={symbol.label}
                            />
                        ) : (
                            <MiniCandleMacdChart candles={feed.candles} macdSeries={macdSeries} label={symbol.label} />
                        )}

                        <div className='match-market__metrics'>
                            {strategy === 'tsi' ? (
                                <>
                                    <span className={tsiConditions.tsiInRange ? 'is-ready' : ''}>
                                        TSI {tsi === null ? '—' : tsi.toFixed(3)}
                                    </span>
                                    <span className={tsiConditions.tsiFlat ? 'is-ready' : ''}>{tsiConditions.tsiFlat ? 'Flat' : 'Not flat'}</span>
                                    <span className={tsiConditions.greenCandle ? 'is-ready' : ''}>{tsiConditions.greenCandle ? 'Green candle' : 'Not green'}</span>
                                    <span className={tsiConditions.entryWindow ? 'is-ready' : ''}>
                                        {formatCandleCountdown(secondsToClose)}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className={macdConditions.enteringFromAbove ? 'is-ready' : ''}>
                                        MACD {macdPoint === null ? '—' : macdPoint.macdLine.toFixed(4)}
                                    </span>
                                    <span className={macdConditions.enteringFromAbove ? 'is-ready' : ''}>
                                        {macdConditions.enteringFromAbove ? 'Entering from above' : 'Not entering'}
                                    </span>
                                    <span className={macdConditions.signalAway ? 'is-ready' : ''}>
                                        {macdConditions.signalAway ? 'Signal away' : 'Signal near'}
                                    </span>
                                    <span className={macdConditions.entryWindow ? 'is-ready' : ''}>
                                        {formatCandleCountdown(secondsToClose)}
                                    </span>
                                </>
                            )}
                        </div>

                        {tradeNow ? (
                            <div
                                className='match-market__alerts'
                                aria-label={`Trade now: ${symbol.label} Matches digits ${strategy === 'tsi' ? 'zero through four' : 'six through nine'}`}
                            >
                                {(strategy === 'tsi' ? MATCHES_DIGITS : MATCHES_MACD_DIGITS).map(digit => (
                                    <span className='match-market__alert' key={digit}>
                                        <strong>MATCHES {digit}</strong>
                                        <span>TRADE NOW</span>
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <div className='match-market__waiting'>
                                {feed.error || (active
                                    ? `Waiting for ${strategy === 'tsi' ? 'TSI' : 'MACD'} entry conditions and the 00:02 candle window.`
                                    : 'Resume the scanner to receive live candle data.')}
                            </div>
                        )}
                    </article>
                ))}
            </div>
        </section>
    );
}

export function MatchesSignalSection(props: MatchesSignalBoardProps) {
    const [strategy, setStrategy] = useState<'tsi' | 'macd'>('tsi');
    return (
        <>
            <div className='match-board__strategy-tabs' role='tablist' aria-label='Matches signal strategy'>
                <button
                    type='button'
                    role='tab'
                    aria-selected={strategy === 'tsi'}
                    className={strategy === 'tsi' ? 'match-board__strategy-tab match-board__strategy-tab--active' : 'match-board__strategy-tab'}
                    onClick={() => setStrategy('tsi')}
                >
                    Matches 0–4 · TSI
                </button>
                <button
                    type='button'
                    role='tab'
                    aria-selected={strategy === 'macd'}
                    className={strategy === 'macd' ? 'match-board__strategy-tab match-board__strategy-tab--active' : 'match-board__strategy-tab'}
                    onClick={() => setStrategy('macd')}
                >
                    Matches 6–9 · MACD
                </button>
            </div>
            <MatchesSignalBoard {...props} strategy={strategy} />
        </>
    );
}
