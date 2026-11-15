export type DerivAnalysisMessage = {
    msg_type?: string;
    req_id?: number;
    error?: { message?: string };
    history?: { prices?: Array<string | number> };
    pip_size?: number | string;
    tick?: { quote?: string | number; pip_size?: number | string; symbol?: string };
    subscription?: { id?: string | number };
};

export interface AnalysisApiClient {
    send: (request: Record<string, unknown>) => unknown;
    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => { unsubscribe: () => void };
    };
}

type FeedOptions = {
    api: AnalysisApiClient;
    symbol: string;
    count: number;
    onHistory: (prices: number[], pipSize: number) => void;
    onTick: (price: number, pipSize?: number) => void;
    onStatus: (status: 'live' | 'error', message?: string) => void;
};

// Separate from the client's small sequential request IDs and valid as a 32-bit integer.
let nextRequestId = 1_000_000_000;

const parsePipSize = (value: unknown): number | undefined => {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
        return undefined;
    }
    const pipSize = Number(value);
    return Number.isInteger(pipSize) && pipSize >= 0 && pipSize <= 20 ? pipSize : undefined;
};

const toMessage = (raw: unknown): DerivAnalysisMessage => {
    if (!raw || typeof raw !== 'object') return {};
    const envelope = raw as { data?: unknown };
    return (envelope.data && typeof envelope.data === 'object' ? envelope.data : raw) as DerivAnalysisMessage;
};

/**
 * One history+ticks subscription, owned by this page. Never closes the shared
 * socket or uses forget_all, which would interrupt other site consumers.
 */
export const subscribeToAnalysisFeed = ({
    api, symbol, count, onHistory, onTick, onStatus,
}: FeedOptions): (() => void) => {
    const requestId = ++nextRequestId;
    let active = true;
    let historyReceived = false;
    let subscriptionId: string | number | undefined;
    let messageSubscription: { unsubscribe: () => void } | undefined;
    const forgottenIds = new Set<string | number>();

    const forget = (id: string | number) => {
        if (forgottenIds.has(id)) return;
        forgottenIds.add(id);
        try {
            void Promise.resolve(api.send({ forget: id })).catch(() => undefined);
        } catch {
            // A closed shared socket cannot receive a forget request.
        }
    };
    const fail = (message: string) => {
        if (active) onStatus('error', message);
    };
    const handle = (message: DerivAnalysisMessage) => {
        if (message.subscription?.id !== undefined) subscriptionId = message.subscription.id;
        if (!active) {
            // send() can resolve after unmount/market change, before we knew the ID.
            if (subscriptionId !== undefined) forget(subscriptionId);
            return;
        }
        if (message.error) {
            fail(message.error.message || 'The site connection could not load market data.');
            return;
        }
        if (message.history && !historyReceived) {
            const prices = (message.history.prices ?? [])
                .map(price => typeof price === 'string' ? Number(price) : price)
                .filter(Number.isFinite);
            if (!prices.length) {
                fail('No price history is available for this market. Select another market or retry.');
                return;
            }
            historyReceived = true;
            onHistory(prices, parsePipSize(message.pip_size) ?? 2);
            // History alone is not proof of a live tick listener.
        }
        if (message.msg_type === 'tick' && historyReceived && message.tick?.quote !== undefined) {
            if (message.tick.symbol && message.tick.symbol !== symbol) return;
            const price = Number(message.tick.quote);
            if (Number.isFinite(price)) {
                onTick(price, parsePipSize(message.tick.pip_size ?? message.pip_size));
                onStatus('live');
            }
        }
    };
    try {
        messageSubscription = api.onMessage().subscribe(raw => {
            const message = toMessage(raw);
            if (message.req_id === requestId ||
                (subscriptionId !== undefined && message.subscription?.id === subscriptionId)) {
                handle(message);
            }
        });
        const result = api.send({
            ticks_history: symbol,
            end: 'latest',
            count,
            style: 'ticks',
            subscribe: 1,
            req_id: requestId,
        });
        void Promise.resolve(result).then(response => {
            // The initial response also appears on onMessage; history is applied
            // once. Still inspect this promise so a late subscription is released.
            const message = toMessage(response);
            if (message.history || message.error || message.subscription) handle(message);
        }).catch(error => {
            const detail = error?.error?.message ?? error?.message;
            fail(typeof detail === 'string' ? detail : 'The site connection could not load market data.');
        });
    } catch (error) {
        fail(error instanceof Error ? error.message : 'Could not listen to the site market-data connection.');
    }
    return () => {
        active = false;
        messageSubscription?.unsubscribe();
        if (subscriptionId !== undefined) forget(subscriptionId);
    };
};
