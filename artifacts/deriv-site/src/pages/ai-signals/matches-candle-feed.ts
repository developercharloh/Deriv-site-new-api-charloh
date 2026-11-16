import {
    MATCHES_CANDLE_SECONDS,
    MATCHES_HISTORY_COUNT,
} from './matches-signal-strategy';

export interface MatchesCandleApi {
    send: (request: Record<string, unknown>) => unknown;
    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => { unsubscribe: () => void };
    };
}

export interface MatchesFeedSymbol {
    code: string;
}

export type MatchesFeedStatus = 'connecting' | 'reconnecting' | 'error';

interface DerivCandleMessage {
    msg_type?: string;
    req_id?: number | string;
    time?: number | string;
    error?: { message?: string };
    history?: { candles?: unknown[] };
    candles?: unknown[];
    ohlc?: Record<string, unknown>;
    subscription?: { id?: number | string };
}

interface SubscribeToMatchesCandleFeedOptions {
    api: MatchesCandleApi;
    symbols: MatchesFeedSymbol[];
    onHistory: (symbol: string, candles: unknown[]) => void;
    onCandle: (symbol: string, ohlc: Record<string, unknown>, serverTime?: unknown) => void;
    onStatus: (symbol: string, status: MatchesFeedStatus, message?: string) => void;
}

const HISTORY_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;
let nextRequestId = 1_600_000_000;

const parseMessage = (raw: unknown): DerivCandleMessage => {
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) as DerivCandleMessage; } catch { return {}; }
    }
    if (!raw || typeof raw !== 'object') return {};
    const envelope = raw as { data?: unknown };
    const data = envelope.data;
    if (typeof data === 'string') {
        try { return JSON.parse(data) as DerivCandleMessage; } catch { return {}; }
    }
    return (data && typeof data === 'object' ? data : raw) as DerivCandleMessage;
};

/**
 * Shares the site's existing Deriv connection. It owns only its candle
 * subscriptions and never closes the socket or forgets other site feeds.
 */
export function subscribeToMatchesCandleFeed({
    api,
    symbols,
    onHistory,
    onCandle,
    onStatus,
}: SubscribeToMatchesCandleFeedOptions): () => void {
    let active = true;
    const requestToSymbol = new Map<number, string>();
    const currentRequestBySymbol = new Map<string, number>();
    const subscriptionToSymbol = new Map<string, string>();
    const subscriptionBySymbol = new Map<string, string | number>();
    const historyReceived = new Set<string>();
    const retriesBySymbol = new Map<string, number>();
    const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const historyTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const startTimers = new Set<ReturnType<typeof setTimeout>>();
    const forgottenSubscriptions = new Set<string | number>();

    const forget = (id: string | number) => {
        if (forgottenSubscriptions.has(id)) return;
        forgottenSubscriptions.add(id);
        try {
            void Promise.resolve(api.send({ forget: id })).catch(() => undefined);
        } catch {
            // The shared socket may be closing; its owner handles reconnection.
        }
    };

    const clearHistoryTimer = (symbol: string) => {
        const timer = historyTimers.get(symbol);
        if (timer) clearTimeout(timer);
        historyTimers.delete(symbol);
    };

    const scheduleRetry = (symbol: string, message: string) => {
        if (!active || retryTimers.has(symbol)) return;
        const attempts = retriesBySymbol.get(symbol) ?? 0;
        if (attempts >= MAX_RETRIES) {
            onStatus(symbol, 'error', message);
            return;
        }

        retriesBySymbol.set(symbol, attempts + 1);
        onStatus(symbol, 'reconnecting', message);
        clearHistoryTimer(symbol);
        currentRequestBySymbol.delete(symbol);
        const subscriptionId = subscriptionBySymbol.get(symbol);
        if (subscriptionId !== undefined) {
            subscriptionBySymbol.delete(symbol);
            subscriptionToSymbol.delete(String(subscriptionId));
            forget(subscriptionId);
        }

        const delay = Math.min(1_000 * (2 ** attempts), 4_000);
        const timer = setTimeout(() => {
            retryTimers.delete(symbol);
            requestSymbol(symbol);
        }, delay);
        retryTimers.set(symbol, timer);
    };

    function handleMessage(message: DerivCandleMessage) {
        const requestId = Number(message.req_id);
        const requestedSymbol = Number.isFinite(requestId) ? requestToSymbol.get(requestId) : undefined;
        const subscriptionId = message.subscription?.id;
        if (requestedSymbol && subscriptionId !== undefined) {
            subscriptionToSymbol.set(String(subscriptionId), requestedSymbol);
            subscriptionBySymbol.set(requestedSymbol, subscriptionId);
        }

        const ohlcSymbol = typeof message.ohlc?.symbol === 'string' ? message.ohlc.symbol : undefined;
        const subscribedSymbol = subscriptionId !== undefined
            ? subscriptionToSymbol.get(String(subscriptionId))
            : undefined;
        const symbol = requestedSymbol ?? ohlcSymbol ?? subscribedSymbol;

        if (!active) {
            if (subscriptionId !== undefined) forget(subscriptionId);
            return;
        }
        if (requestedSymbol && currentRequestBySymbol.get(requestedSymbol) !== requestId) {
            if (subscriptionId !== undefined) forget(subscriptionId);
            return;
        }
        if (!symbol) return;

        if (message.error) {
            scheduleRetry(symbol, message.error.message || 'The site connection rejected candle history.');
            return;
        }

        const candles = Array.isArray(message.candles)
            ? message.candles
            : Array.isArray(message.history?.candles) ? message.history.candles : null;
        if (candles && !historyReceived.has(symbol)) {
            if (!candles.length) {
                scheduleRetry(symbol, 'No candle history was returned; retrying.');
                return;
            }
            historyReceived.add(symbol);
            retriesBySymbol.delete(symbol);
            clearHistoryTimer(symbol);
            onHistory(symbol, candles);
        }

        if (message.msg_type === 'ohlc' && message.ohlc && historyReceived.has(symbol)) {
            onCandle(symbol, message.ohlc, message.time);
        }
    }

    function requestSymbol(symbol: string) {
        if (!active) return;
        const requestId = ++nextRequestId;
        requestToSymbol.set(requestId, symbol);
        currentRequestBySymbol.set(symbol, requestId);
        historyReceived.delete(symbol);
        onStatus(symbol, 'connecting');

        const historyTimer = setTimeout(() => {
            if (currentRequestBySymbol.get(symbol) === requestId && !historyReceived.has(symbol)) {
                scheduleRetry(symbol, 'Candle history timed out; retrying.');
            }
        }, HISTORY_TIMEOUT_MS);
        historyTimers.set(symbol, historyTimer);

        try {
            const result = api.send({
                ticks_history: symbol,
                count: MATCHES_HISTORY_COUNT,
                end: 'latest',
                style: 'candles',
                granularity: MATCHES_CANDLE_SECONDS,
                subscribe: 1,
                req_id: requestId,
            });
            void Promise.resolve(result).then(response => {
                const message = parseMessage(response);
                if (message.error || message.candles || message.history || message.ohlc || message.subscription) {
                    handleMessage(message);
                }
            }).catch(error => {
                const detail = error?.error?.message ?? error?.message;
                scheduleRetry(symbol, typeof detail === 'string' ? detail : 'Could not load candle history; retrying.');
            });
        } catch (error) {
            scheduleRetry(symbol, error instanceof Error ? error.message : 'Could not request candle history.');
        }
    }

    let messageSubscription: { unsubscribe: () => void } | undefined;
    try {
        messageSubscription = api.onMessage().subscribe(raw => handleMessage(parseMessage(raw)));
    } catch {
        symbols.forEach(symbol => onStatus(symbol.code, 'error', 'Could not listen to the site market-data connection.'));
        return () => undefined;
    }

    symbols.forEach((symbol, index) => {
        onStatus(symbol.code, 'connecting');
        const timer = setTimeout(() => {
            startTimers.delete(timer);
            requestSymbol(symbol.code);
        }, index * 80);
        startTimers.add(timer);
    });

    return () => {
        active = false;
        messageSubscription?.unsubscribe();
        startTimers.forEach(clearTimeout);
        retryTimers.forEach(clearTimeout);
        historyTimers.forEach(clearTimeout);
        retryTimers.clear();
        historyTimers.clear();
        subscriptionBySymbol.forEach(forget);
        subscriptionBySymbol.clear();
        subscriptionToSymbol.clear();
        currentRequestBySymbol.clear();
    };
}
