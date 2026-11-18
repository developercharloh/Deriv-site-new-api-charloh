import React, { useEffect, useMemo, useState } from 'react';
import { DERIV_CONTINUOUS_VOLATILITIES, type DerivVolatility } from '@/utils/deriv-volatilities';
import { analyzeEvenOddBeastCandles, type EvenOddBeastAnalysis } from '@/utils/even-odd-beast-strategy';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import {
    MATCHES_CANDLE_SECONDS,
    MATCHES_HISTORY_COUNT,
    mergeCandle,
    normalizeCandle,
    type Candle,
} from './matches-signal-strategy';
import { subscribeToMatchesCandleFeed, type MatchesCandleApi } from './matches-candle-feed';
import './even-odd-beast-signal-board.scss';

const LIVE_TICK_MAX_AGE_MS = 2_500;
type FeedStatus = 'connecting' | 'warming' | 'live' | 'reconnecting' | 'error';

interface MarketFeed {
    candles: Candle[];
    pipSize: number | null;
    feedStatus: FeedStatus;
    serverEpoch: number | null;
    lastTickAt: number | null;
    error?: string;
}

export interface EvenOddBeastSignalSelection {
    symbol: DerivVolatility;
    side: 'EVEN' | 'ODD';
    analysis: EvenOddBeastAnalysis;
}

interface EvenOddBeastSignalBoardProps {
    active: boolean;
    onToggle: () => void;
    maintenanceActive: boolean;
    onSelectSignal: (selection: EvenOddBeastSignalSelection) => void;
}

export const canTradeEvenOddBeastSignal = (
    side: EvenOddBeastAnalysis['setupSignal'],
    feedFresh: boolean,
): side is 'EVEN' | 'ODD' => feedFresh && (side === 'EVEN' || side === 'ODD');

const makeInitialFeeds = (): Record<string, MarketFeed> => Object.fromEntries(
    DERIV_CONTINUOUS_VOLATILITIES.map(symbol => [symbol.code, {
        candles: [],
        pipSize: null,
        feedStatus: 'connecting' as FeedStatus,
        serverEpoch: null,
        lastTickAt: null,
    }]),
);

const updateFeed = (
    current: Record<string, MarketFeed>,
    code: string,
    update: (feed: MarketFeed) => MarketFeed,
): Record<string, MarketFeed> => {
    const feed = current[code];
    return feed ? { ...current, [code]: update(feed) } : current;
};

function MiniCandleChart({ candles, label }: { candles: Candle[]; label: string }) {
    const visible = candles.slice(-32);
    if (!visible.length) {
        return <div className='eob-board__chart eob-board__chart--empty'>Waiting for one-minute candle history…</div>;
    }

    const width = 320;
    const height = 94;
    const top = 7;
    const bottom = 80;
    const prices = visible.flatMap(candle => [candle.high, candle.low]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || Math.max(Math.abs(max) * 0.0001, 1);
    const step = width / visible.length;
    const bodyWidth = Math.max(2, Math.min(7, step * 0.58));
    const y = (price: number) => bottom - ((price - min) / range) * (bottom - top);

    return (
        <svg className='eob-board__chart' viewBox={`0 0 ${width} ${height}`} role='img' aria-label={`${label} one-minute candles`}>
            <line x1='0' x2={width} y1={bottom + 4} y2={bottom + 4} className='eob-board__chart-divider' />
            {visible.map((candle, index) => {
                const center = (index + 0.5) * step;
                const open = y(candle.open);
                const close = y(candle.close);
                const up = candle.close >= candle.open;
                return (
                    <g key={`${candle.time}-${index}`} className={up ? 'eob-board__candle--up' : 'eob-board__candle--down'}>
                        <line x1={center} x2={center} y1={y(candle.high)} y2={y(candle.low)} className='eob-board__wick' />
                        <rect
                            x={center - bodyWidth / 2}
                            y={Math.min(open, close)}
                            width={bodyWidth}
                            height={Math.max(1, Math.abs(close - open))}
                            className='eob-board__body'
                        />
                    </g>
                );
            })}
            <text x='4' y='91' className='eob-board__chart-label'>1-minute candles · latest 32</text>
        </svg>
    );
}

function setupStatus(analysis: EvenOddBeastAnalysis, feedFresh: boolean, active: boolean) {
    if (!active) return { label: 'Paused', ready: false };
    if (!feedFresh) return { label: 'Waiting for live data', ready: false };
    if (analysis.setupSignal === 'EVEN') return { label: 'EVEN setup ready', ready: true };
    if (analysis.setupSignal === 'ODD') return { label: 'ODD setup ready', ready: true };
    return { label: 'Waiting for setup', ready: false };
}

export function EvenOddBeastSignalBoard({
    active,
    onToggle,
    maintenanceActive,
    onSelectSignal,
}: EvenOddBeastSignalBoardProps) {
    const [feeds, setFeeds] = useState<Record<string, MarketFeed>>(makeInitialFeeds);
    const [clockNow, setClockNow] = useState(Date.now());
    const { connectionStatus } = useApiBase();
    const api = api_base.api as unknown as MatchesCandleApi | null;

    useEffect(() => {
        if (!active || maintenanceActive || connectionStatus !== 'opened' || !api) {
            const status: FeedStatus = maintenanceActive
                ? 'error'
                : connectionStatus === 'closed' ? 'reconnecting' : 'connecting';
            setFeeds(previous => Object.fromEntries(
                DERIV_CONTINUOUS_VOLATILITIES.map(symbol => [symbol.code, {
                    ...previous[symbol.code],
                    feedStatus: status,
                    serverEpoch: null,
                    lastTickAt: null,
                    error: maintenanceActive ? 'Deriv market data is under maintenance.' : undefined,
                }]),
            ));
            return;
        }

        setFeeds(previous => Object.fromEntries(
            DERIV_CONTINUOUS_VOLATILITIES.map(symbol => [symbol.code, {
                ...previous[symbol.code],
                feedStatus: 'connecting' as FeedStatus,
                serverEpoch: null,
                lastTickAt: null,
                error: undefined,
            }]),
        ));

        return subscribeToMatchesCandleFeed({
            api,
            symbols: DERIV_CONTINUOUS_VOLATILITIES,
            onHistory: (code, rawCandles, pipSize) => {
                const candles = rawCandles
                    .map(item => normalizeCandle(item))
                    .filter((item): item is Candle => item !== null)
                    .sort((a, b) => a.time - b.time)
                    .slice(-MATCHES_HISTORY_COUNT);
                setFeeds(previous => updateFeed(previous, code, feed => ({
                    ...feed,
                    candles,
                    pipSize: pipSize ?? null,
                    feedStatus: candles.length ? 'warming' : 'error',
                    error: candles.length ? undefined : 'No one-minute candles were returned.',
                })));
            },
            onCandle: (code, rawOhlc, serverTime) => {
                const candle = normalizeCandle(rawOhlc);
                const epoch = Number(rawOhlc.epoch ?? serverTime);
                if (!candle || !Number.isFinite(epoch)) return;
                setFeeds(previous => updateFeed(previous, code, feed => ({
                    ...feed,
                    candles: mergeCandle(feed.candles, candle),
                    feedStatus: 'live',
                    serverEpoch: epoch,
                    lastTickAt: Date.now(),
                    error: undefined,
                })));
            },
            onStatus: (code, status, message) => {
                setFeeds(previous => updateFeed(previous, code, feed => ({
                    ...feed,
                    feedStatus: status,
                    error: message,
                    lastTickAt: status === 'reconnecting' ? null : feed.lastTickAt,
                })));
            },
        });
    }, [active, api, connectionStatus, maintenanceActive]);

    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setClockNow(Date.now()), 500);
        return () => clearInterval(timer);
    }, [active]);

    const markets = useMemo(() => DERIV_CONTINUOUS_VOLATILITIES.map(symbol => {
        const feed = feeds[symbol.code];
        const feedFresh = active &&
            feed.feedStatus === 'live' &&
            feed.lastTickAt !== null &&
            clockNow - feed.lastTickAt <= LIVE_TICK_MAX_AGE_MS;
        const serverNow = feed.serverEpoch !== null && feed.lastTickAt !== null
            ? feed.serverEpoch + Math.max(0, (clockNow - feed.lastTickAt) / 1000)
            : null;
        const currentCandleTime = feed.candles[feed.candles.length - 1]?.time ?? 0;
        const expectedCandleTime = serverNow === null
            ? currentCandleTime
            : Math.floor(serverNow / MATCHES_CANDLE_SECONDS) * MATCHES_CANDLE_SECONDS;
        const analysis = analyzeEvenOddBeastCandles({
            candles: feed.candles,
            pipSize: feed.pipSize,
            expectedCandleTime,
        });
        return {
            symbol,
            feed,
            feedFresh,
            analysis,
            status: setupStatus(analysis, feedFresh, active),
        };
    }), [active, clockNow, feeds]);

    const liveCount = markets.filter(market => market.feedFresh).length;
    const connectionLabel = maintenanceActive
        ? 'Market data is under maintenance'
        : !active
            ? 'Scanner paused'
            : liveCount === markets.length
                ? `Live on all ${liveCount} continuous markets`
                : liveCount > 0
                    ? `Live on ${liveCount} of ${markets.length} continuous markets`
                    : connectionStatus === 'closed'
                        ? 'Reconnecting to the site Deriv connection'
                        : 'Waiting for one-minute candle updates';

    return (
        <section className='eob-board' aria-label='Even Odd Beast setup signals'>
            <div className='eob-board__heading'>
                <div>
                    <h2>Even / Odd Setups</h2>
                    <p>One-minute candles · MA9 · MACD 12/26/9 · Continuous Volatility Indices only</p>
                </div>
                <div className='eob-board__heading-actions'>
                    <span className='eob-board__interval'>1-MINUTE CANDLES</span>
                    <button
                        type='button'
                        className={`eob-board__toggle${active ? ' eob-board__toggle--active' : ''}`}
                        onClick={onToggle}
                        disabled={maintenanceActive}
                    >
                        {active ? 'Pause' : 'Resume'}
                    </button>
                </div>
            </div>

            <div className={`eob-board__connection${liveCount ? ' eob-board__connection--live' : ''}`} role='status'>
                <span className='eob-board__connection-dot' />
                <span>{connectionLabel}</span>
                <span className='eob-board__connection-count'>{liveCount}/{markets.length}</span>
            </div>

            <div className='eob-board__rule'>
                ODD: green candle above a rising MA9, with a positive and rising MACD histogram.
                EVEN: red candle below a falling MA9, with a negative and falling MACD histogram.
            </div>

            <div className='eob-board__grid'>
                {markets.map(({ symbol, feed, feedFresh, analysis, status }) => {
                    const canTrade = canTradeEvenOddBeastSignal(analysis.setupSignal, feedFresh);
                    const histogram = analysis.macdHistogram;
                    return (
                        <article key={symbol.code} className='eob-board__market'>
                            <div className='eob-board__market-header'>
                                <div>
                                    <strong>{symbol.short}</strong>
                                    <span>{symbol.label} · {symbol.code}</span>
                                </div>
                                <span className={`eob-board__status eob-board__status--${feed.feedStatus}`}>
                                    {feed.feedStatus === 'live' && feedFresh ? 'Live' : feed.feedStatus}
                                </span>
                            </div>

                            <MiniCandleChart candles={feed.candles} label={symbol.label} />

                            <div className={`eob-board__signal${status.ready ? ` eob-board__signal--${analysis.setupSignal.toLowerCase()}` : ''}`}>
                                <span className='eob-board__signal-dot' />
                                <strong>{status.label}</strong>
                            </div>

                            <div className='eob-board__conditions'>
                                <div><span>Candle</span><strong>{analysis.candleColor}</strong></div>
                                <div><span>Close vs MA9</span><strong>{analysis.priceVsMovingAverage}</strong></div>
                                <div><span>MA9 trend</span><strong>{analysis.movingAverageTrend}</strong></div>
                                <div>
                                    <span>MACD histogram</span>
                                    <strong>
                                        {histogram === null ? 'Waiting' : `${histogram > 0 ? '+' : ''}${histogram.toPrecision(4)} · ${analysis.macdTrend.toLowerCase()}`}
                                    </strong>
                                </div>
                            </div>

                            {feed.error && <p className='eob-board__error'>{feed.error}</p>}

                            <button
                                type='button'
                                className='eob-board__trade'
                                disabled={!canTrade || maintenanceActive}
                                onClick={() => {
                                    if (canTradeEvenOddBeastSignal(analysis.setupSignal, feedFresh)) {
                                        onSelectSignal({ symbol, side: analysis.setupSignal, analysis });
                                    }
                                }}
                            >
                                Trade with Even Odd Beast
                            </button>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
