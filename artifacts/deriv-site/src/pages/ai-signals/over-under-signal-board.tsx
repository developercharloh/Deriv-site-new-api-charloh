import React, { useEffect, useMemo, useState } from 'react';
import { DERIV_VOLATILITIES, type DerivVolatility } from '@/utils/deriv-volatilities';
import { useApiBase } from '@/hooks/useApiBase';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    formatCandleCountdown,
    MATCHES_CANDLE_SECONDS,
    MATCHES_HISTORY_COUNT,
    mergeCandle,
    normalizeCandle,
    secondsUntilCandleClose,
    type Candle,
} from './matches-signal-strategy';
import { subscribeToMatchesCandleFeed, type MatchesCandleApi } from './matches-candle-feed';
import {
    OVER_UNDER_SIGNAL_BARRIERS,
    type OverUnderSignalOption,
    type OverUnderSignalSide,
} from './over-under-signals';
import './over-under-signal-board.scss';

const LIVE_TICK_MAX_AGE_MS = 2_500;

type FeedStatus = 'connecting' | 'warming' | 'live' | 'reconnecting' | 'error';

interface MarketFeed {
    candles: Candle[];
    feedStatus: FeedStatus;
    serverEpoch: number | null;
    lastTickAt: number | null;
    error?: string;
}

export interface OverUnderMarketSignal {
    symbol: DerivVolatility;
    direction: string;
    isSignal: boolean;
    signalStrength: number;
    winProbability: number;
    options: OverUnderSignalOption[];
    watchdogStatus?: 'warming' | 'holding' | 'weakening' | 'reversed';
    watchdogWinPct?: number;
    resultAvailable: boolean;
}

interface OverUnderSignalBoardProps {
    active: boolean;
    maintenanceActive: boolean;
    signals: OverUnderMarketSignal[];
    onSelectSignal?: (symbolCode: string) => void;
}

const makeInitialFeeds = (): Record<string, MarketFeed> => Object.fromEntries(
    DERIV_VOLATILITIES.map(symbol => [symbol.code, {
        candles: [],
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

function orderedOptions(options: OverUnderSignalOption[]) {
    return (Object.entries(OVER_UNDER_SIGNAL_BARRIERS) as [OverUnderSignalSide, readonly number[]][])
        .flatMap(([side, barriers]) => barriers.map(barrier => ({
            side,
            barrier,
            option: options.find(option => option.side === side && option.barrier === barrier) ?? null,
        })));
}

export function OverUnderSignalBoard({
    active,
    maintenanceActive,
    signals,
    onSelectSignal,
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
        const timer = setInterval(() => setClockNow(Date.now()), 250);
        return () => clearInterval(timer);
    }, [active]);

    const signalByCode = useMemo(
        () => new Map(signals.map(signal => [signal.symbol.code, signal])),
        [signals],
    );
    const cards = useMemo(() => DERIV_VOLATILITIES.map(symbol => {
        const feed = feeds[symbol.code];
        const signal = signalByCode.get(symbol.code);
        const feedFresh = active && feed.feedStatus === 'live' &&
            feed.lastTickAt !== null && clockNow - feed.lastTickAt <= LIVE_TICK_MAX_AGE_MS;
        const serverNow = feed.serverEpoch !== null && feed.lastTickAt !== null
            ? feed.serverEpoch + Math.max(0, (clockNow - feed.lastTickAt) / 1000)
            : null;
        const lastCandle = feed.candles[feed.candles.length - 1] ?? null;
        const secondsToClose = lastCandle && serverNow !== null
            ? secondsUntilCandleClose(lastCandle.time, serverNow)
            : null;
        const liveReady = Boolean(
            signal?.isSignal &&
            feedFresh &&
            signal.watchdogStatus === 'holding',
        );

        return { symbol, feed, signal, feedFresh, lastCandle, secondsToClose, liveReady };
    }), [active, clockNow, feeds, signalByCode]);

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
                    <p>Over 4 · Over 5 · Under 6 · Under 5</p>
                </div>
                <span className='ou-board__interval'>1-MINUTE CANDLES</span>
            </div>
            <div className={`ou-board__connection${liveCount === cards.length && active ? ' ou-board__connection--live' : ''}`} role='status' aria-live='polite' data-testid='status-market-feed'>
                <span className='ou-board__connection-dot' />
                <span data-testid='text-market-feed-status'>{connectionLabel}</span>
                <span className='ou-board__connection-count' data-testid='text-live-market-count'>{liveCount}/{cards.length} live</span>
            </div>
            <p className='ou-board__rule'>
                Each market shows all four AI-scored barriers. The highlighted setup is the current consensus choice.
                Entries wait for the broker tick at 00:02 before the one-minute candle closes. No trades are placed automatically.
            </p>
            <div className='ou-board__grid'>
                {cards.map(({ symbol, feed, signal, feedFresh, lastCandle, secondsToClose, liveReady }) => {
                    const options = orderedOptions(signal?.options ?? []);
                    const status = !active ? 'Paused' :
                        maintenanceActive ? 'Unavailable' :
                            feedFresh ? 'Live' :
                                feed.feedStatus === 'error' ? 'Unavailable' :
                                    feed.feedStatus === 'reconnecting' ? 'Reconnecting' :
                                        feed.candles.length ? 'Waiting for live tick' : 'Loading candles';
                    const selected = signal?.direction ?? '';

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
                                {options.map(({ option, side, barrier }) => {
                                    if (!option) {
                                        const label = `${side} ${barrier}`;
                                        return (
                                            <div className='ou-board__option ou-board__option--loading' key={label} data-testid={`data-signal-option-${symbol.code}-${side.toLowerCase()}-${barrier}`}>
                                                <strong>{label}</strong>
                                                <span>{feed.candles.length ? 'Waiting for AI scan' : 'Loading scan data'}</span>
                                            </div>
                                        );
                                    }
                                    const label = `${option.side} ${option.barrier}`;
                                    const isSelected = selected === label;
                                    return (
                                        <div
                                            className={`ou-board__option${isSelected ? ' ou-board__option--selected' : ''}${isSelected && signal?.isSignal ? ' ou-board__option--signal' : ''}`}
                                            key={label}
                                            data-testid={`data-signal-option-${symbol.code}-${option.side.toLowerCase()}-${option.barrier}`}
                                        >
                                            <strong>{label}</strong>
                                            <span>{(option.probability * 100).toFixed(1)}% observed</span>
                                            <small>{option.edge >= 0 ? '+' : ''}{(option.edge * 100).toFixed(1)}pp vs baseline</small>
                                            {isSelected && (
                                                <em>
                                                    {signal?.isSignal
                                                        ? liveReady ? 'LIVE SIGNAL' : 'WAITING FOR LIVE CHECK'
                                                        : 'CURRENT BEST'}
                                                </em>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <p className='ou-board__waiting' data-testid={`text-signal-status-${symbol.code}`} aria-live='polite'>
                                {signal?.isSignal
                                    ? liveReady
                                        ? 'Signal is confirmed on fresh live ticks. The Premium bot waits for the candle-close entry window.'
                                        : `Waiting for fresh live confirmation${signal.watchdogWinPct === undefined ? '…' : ` · ${(signal.watchdogWinPct * 100).toFixed(0)}% recent hold`}.`
                                    : signal?.resultAvailable
                                        ? 'Waiting for the consensus filters to qualify one of these setups.'
                                        : feed.error ?? 'AI scan results will appear when market history is ready.'}
                            </p>

                            {signal?.isSignal && onSelectSignal && (
                                <button
                                    className='ou-board__select'
                                    type='button'
                                    data-testid={`button-review-signal-${symbol.code}`}
                                    aria-label={`${liveReady ? 'Review' : 'Live check for'} ${symbol.label} ${signal.direction} signal`}
                                    disabled={!liveReady}
                                    onClick={() => onSelectSignal(symbol.code)}
                                    title={liveReady ? 'Open the qualified signal details' : 'Wait for the live tick check'}
                                >
                                    {liveReady ? 'Review signal' : 'Live check…'}
                                </button>
                            )}
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
