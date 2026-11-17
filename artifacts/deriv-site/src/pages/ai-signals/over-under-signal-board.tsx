import React, { useEffect, useMemo, useState } from 'react';
import { DERIV_VOLATILITIES, type DerivVolatility } from '@/utils/deriv-volatilities';
import { useApiBase } from '@/hooks/useApiBase';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    calculateTrendStrengthIndexSeries,
    formatCandleCountdown,
    MATCHES_CANDLE_SECONDS,
    MATCHES_HISTORY_COUNT,
    MATCHES_MACD_SIGNAL_PERIOD,
    MATCHES_MACD_SLOW_PERIOD,
    MATCHES_MACD_FAST_PERIOD,
    MATCHES_TSI_PERIOD,
    mergeCandle,
    normalizeCandle,
    secondsUntilCandleClose,
    type Candle,
} from './matches-signal-strategy';
import { subscribeToMatchesCandleFeed, type MatchesCandleApi } from './matches-candle-feed';
import {
    evaluateOverUnderIndicatorStatusesAtEpoch,
    type OverUnderIndicatorStatus,
} from '@/utils/over-under-indicator-strategy';
import './over-under-signal-board.scss';

const LIVE_TICK_MAX_AGE_MS = 2_500;

type FeedStatus = 'connecting' | 'warming' | 'live' | 'reconnecting' | 'error';

interface MarketFeed {
    candles: Candle[];
    tsiSamples: number[];
    feedStatus: FeedStatus;
    serverEpoch: number | null;
    lastTickAt: number | null;
    error?: string;
}

interface OverUnderSignalBoardProps {
    active: boolean;
    onToggle: () => void;
    maintenanceActive: boolean;
}

const makeInitialFeeds = (): Record<string, MarketFeed> => Object.fromEntries(
    DERIV_VOLATILITIES.map(symbol => [symbol.code, {
        candles: [],
        tsiSamples: [],
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
    const visible = candles.slice(-36);
    if (!visible.length) {
        return <div className='ou-board__chart ou-board__chart--empty'>Waiting for one-minute candle history…</div>;
    }

    const width = 320;
    const height = 104;
    const top = 8;
    const bottom = 91;
    const prices = visible.flatMap(candle => [candle.high, candle.low]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || Math.max(Math.abs(max) * 0.0001, 1);
    const step = width / visible.length;
    const bodyWidth = Math.max(2, Math.min(7, step * 0.58));
    const y = (price: number) => bottom - ((price - min) / range) * (bottom - top);

    return (
        <svg className='ou-board__chart' viewBox={`0 0 ${width} ${height}`} role='img' aria-label={`${label} one-minute candles`}>
            <line x1='0' x2={width} y1={bottom + 4} y2={bottom + 4} className='ou-board__chart-divider' />
            {visible.map((candle, index) => {
                const center = (index + 0.5) * step;
                const open = y(candle.open);
                const close = y(candle.close);
                const up = candle.close >= candle.open;
                return (
                    <g key={`${candle.time}-${index}`} className={up ? 'ou-board__candle--up' : 'ou-board__candle--down'}>
                        <line x1={center} x2={center} y1={y(candle.high)} y2={y(candle.low)} className='ou-board__wick' />
                        <rect
                            x={center - bodyWidth / 2}
                            y={Math.min(open, close)}
                            width={bodyWidth}
                            height={Math.max(1, Math.abs(close - open))}
                            className='ou-board__body'
                        />
                    </g>
                );
            })}
            <text x='4' y='101' className='ou-board__chart-label'>1-minute candles · latest 36</text>
        </svg>
    );
}

export function OverUnderSignalBoard({
    active,
    onToggle,
    maintenanceActive,
}: OverUnderSignalBoardProps) {
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
                DERIV_VOLATILITIES.map(symbol => [symbol.code, {
                    ...previous[symbol.code],
                    feedStatus: status,
                    tsiSamples: [],
                    serverEpoch: null,
                    lastTickAt: null,
                    error: maintenanceActive ? 'Deriv market data is under maintenance.' : undefined,
                }]),
            ));
            return;
        }

        setFeeds(previous => Object.fromEntries(
            DERIV_VOLATILITIES.map(symbol => [symbol.code, {
                ...previous[symbol.code],
                feedStatus: 'connecting' as FeedStatus,
                serverEpoch: null,
                lastTickAt: null,
                error: undefined,
            }]),
        ));

        return subscribeToMatchesCandleFeed({
            api,
            symbols: DERIV_VOLATILITIES,
            onHistory: (code, rawCandles) => {
                const candles = rawCandles
                    .map(item => normalizeCandle(item))
                    .filter((item): item is Candle => item !== null)
                    .sort((a, b) => a.time - b.time)
                    .slice(-MATCHES_HISTORY_COUNT);
                setFeeds(previous => updateFeed(previous, code, feed => ({
                    ...feed,
                    candles,
                    tsiSamples: [],
                    feedStatus: candles.length ? 'warming' : 'error',
                    error: candles.length ? undefined : 'No one-minute candles were returned.',
                })));
            },
            onCandle: (code, rawOhlc, serverTime) => {
                const candle = normalizeCandle(rawOhlc);
                const epoch = Number(rawOhlc.epoch ?? serverTime);
                if (!candle || !Number.isFinite(epoch)) return;
                setFeeds(previous => updateFeed(previous, code, feed => {
                    const candles = mergeCandle(feed.candles, candle);
                    const currentTsi = calculateTrendStrengthIndexSeries(candles).slice(-1)[0] ?? null;
                    return {
                        ...feed,
                        candles,
                        tsiSamples: currentTsi === null
                            ? feed.tsiSamples
                            : [...feed.tsiSamples, currentTsi].slice(-3),
                        feedStatus: 'live',
                        serverEpoch: epoch,
                        lastTickAt: Date.now(),
                        error: undefined,
                    };
                }));
            },
            onStatus: (code, status, message) => {
                setFeeds(previous => updateFeed(previous, code, feed => ({
                    ...feed,
                    feedStatus: status,
                    error: message,
                    tsiSamples: status === 'reconnecting' ? [] : feed.tsiSamples,
                    lastTickAt: status === 'reconnecting' ? null : feed.lastTickAt,
                })));
            },
        });
    }, [active, api, connectionStatus, maintenanceActive]);

    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setClockNow(Date.now()), 250);
        return () => clearInterval(timer);
    }, [active]);

    const cards = useMemo(() => DERIV_VOLATILITIES.map(symbol => {
        const feed = feeds[symbol.code];
        const feedFresh = active && feed.feedStatus === 'live' &&
            feed.lastTickAt !== null && clockNow - feed.lastTickAt <= LIVE_TICK_MAX_AGE_MS;
        const serverNow = feed.serverEpoch !== null && feed.lastTickAt !== null
            ? feed.serverEpoch + Math.max(0, (clockNow - feed.lastTickAt) / 1000)
            : null;
        const lastCandle = feed.candles[feed.candles.length - 1] ?? null;
        const secondsToClose = lastCandle && serverNow !== null
            ? secondsUntilCandleClose(lastCandle.time, serverNow)
            : null;
        const setups = evaluateOverUnderIndicatorStatusesAtEpoch({
            candles: feed.candles,
            tsiSamples: feed.tsiSamples,
            brokerEpoch: serverNow,
            feedFresh,
        });

        return { symbol, feed, feedFresh, lastCandle, secondsToClose, setups };
    }), [active, clockNow, feeds]);

    const liveCount = cards.filter(card => card.feedFresh).length;
    const connectionLabel = maintenanceActive
        ? 'Market data is under maintenance'
        : !active
            ? 'Scanner paused'
            : liveCount === cards.length
                ? `Live on all ${liveCount} markets`
                : liveCount > 0
                    ? `Live on ${liveCount} of ${cards.length} markets`
                    : connectionStatus === 'closed'
                        ? 'Reconnecting to the site Deriv connection'
                        : 'Waiting for one-minute candle updates';

    return (
        <section className='ou-board' aria-label='Over and Under live signals'>
            <div className='ou-board__heading'>
                <div>
                    <h2>Over / Under Signals</h2>
                    <p>MACD for Over 4/5 · Trend Strength Index 14 for Under 6/5</p>
                </div>
                <div className='ou-board__heading-actions'>
                    <span className='ou-board__interval'>1-MINUTE CANDLES</span>
                    <button
                        type='button'
                        className={`ou-board__toggle${active ? ' ou-board__toggle--active' : ''}`}
                        onClick={onToggle}
                        disabled={maintenanceActive}
                    >
                        {active ? 'Pause' : 'Resume'}
                    </button>
                </div>
            </div>
            <div className={`ou-board__connection${liveCount === cards.length && active ? ' ou-board__connection--live' : ''}`} role='status' aria-live='polite' data-testid='status-market-feed'>
                <span className='ou-board__connection-dot' />
                <span data-testid='text-market-feed-status'>{connectionLabel}</span>
                <span className='ou-board__connection-count' data-testid='text-live-market-count'>{liveCount}/{cards.length} live</span>
            </div>
            <p className='ou-board__rule'>
                Signals use the same indicator filters as Matches. Over 4/5 require MACD 12/26/9 descending from above
                with a contracting positive histogram; Under 6/5 require Trend Strength Index 14 at 0.8–0.9, three flat updates, and a green
                candle. Entry requires a fresh broker tick at 00:02 before close. This board does not place trades.
            </p>
            <div className='ou-board__grid'>
                {cards.map(({ symbol, feed, feedFresh, lastCandle, secondsToClose, setups }) => {
                    const status = !active ? 'Paused' :
                        maintenanceActive ? 'Unavailable' :
                            feedFresh ? 'Live' :
                                feed.feedStatus === 'error' ? 'Unavailable' :
                                    feed.feedStatus === 'reconnecting' ? 'Reconnecting' :
                                        feed.candles.length ? 'Waiting for live tick' : 'Loading candles';
                    return (
                        <article className='ou-board__market' key={symbol.code} data-testid={`card-market-${symbol.code}`}>
                            <header className='ou-board__market-header'>
                                <div>
                                    <strong>{symbol.short}</strong>
                                    <span>{symbol.label}</span>
                                </div>
                                    <span className={`ou-board__status ou-board__status--${status.toLowerCase().replace(/\s+/g, '-')}`} data-testid={`status-market-${symbol.code}`}>
                                    {status}
                                </span>
                            </header>

                            <MiniCandleChart candles={feed.candles} label={symbol.label} />

                            <div className='ou-board__timing'>
                                <span data-testid={`text-candle-countdown-${symbol.code}`}>
                                    {secondsToClose !== null
                                        ? `${formatCandleCountdown(secondsToClose)} to candle close`
                                        : 'Waiting for candle clock'}
                                </span>
                                <strong className={secondsToClose !== null && secondsToClose <= 2 ? 'ou-board__timing--entry' : ''} data-testid={`status-entry-timing-${symbol.code}`}>
                                    {secondsToClose !== null && secondsToClose <= 2 ? '00:02 ENTRY WINDOW' : 'Entry at 00:02'}
                                </strong>
                            </div>

                            <div className='ou-board__options'>
                                {setups.map((setup: OverUnderIndicatorStatus) => {
                                    const label = `${setup.side} ${setup.barrier}`;
                                    const isEntryNow = setup.tradeNow;
                                    return (
                                        <div
                                            className={`ou-board__option${setup.setupReady ? ' ou-board__option--selected' : ''}${isEntryNow ? ' ou-board__option--signal' : ''}`}
                                            key={setup.mode}
                                            data-testid={`data-signal-option-${symbol.code}-${setup.side.toLowerCase()}-${setup.barrier}`}
                                        >
                                            <strong>{label}</strong>
                                            <span>{setup.indicator === 'MACD'
                                                ? `${MATCHES_MACD_FAST_PERIOD}/${MATCHES_MACD_SLOW_PERIOD}/${MATCHES_MACD_SIGNAL_PERIOD}`
                                                : `Trend Strength Index ${MATCHES_TSI_PERIOD} · one line`}</span>
                                            <small>{setup.indicatorValue === null
                                                ? 'Warming up indicator history'
                                                : `${setup.indicator === 'MACD' ? 'MACD' : 'Trend Strength Index'} ${setup.indicatorValue.toFixed(setup.indicator === 'MACD' ? 5 : 3)}`}</small>
                                            <div className='ou-board__conditions'>
                                                {setup.conditions.map(condition => (
                                                    <span
                                                        key={condition.key}
                                                        className={condition.met ? 'ou-board__condition ou-board__condition--met' : 'ou-board__condition'}
                                                    >
                                                        <i aria-hidden='true'>{condition.met ? '✓' : '·'}</i>
                                                        {condition.label}
                                                    </span>
                                                ))}
                                            </div>
                                            <em>{isEntryNow ? 'ENTRY SIGNAL NOW' : setup.setupReady
                                                ? setup.entryWindow ? 'SETUP READY · CHECKING FEED' : 'SETUP READY · WAITING FOR 00:02'
                                                : 'WAITING FOR INDICATOR CONDITIONS'}</em>
                                        </div>
                                    );
                                })}
                            </div>

                            <p className='ou-board__waiting' data-testid={`text-signal-status-${symbol.code}`} aria-live='polite'>
                                {!active
                                    ? 'Scanner paused.'
                                    : maintenanceActive
                                        ? feed.error ?? 'Deriv market data is under maintenance.'
                                        : !feedFresh
                                            ? feed.error ?? 'Waiting for a fresh broker tick.'
                                            : secondsToClose === null
                                                ? 'Waiting for the broker candle clock.'
                                                : `Indicators are evaluated from live one-minute candles. ${secondsToClose} seconds remain.`}
                            </p>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
