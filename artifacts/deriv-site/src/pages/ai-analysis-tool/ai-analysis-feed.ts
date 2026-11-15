export type AnalysisFeedStatus = 'live' | 'error';

export type DerivAnalysisMessage = {
    msg_type?: string;
    req_id?: number;
    error?: { message?: string };
    history?: { prices?: Array<string | number> };
    pip_size?: number;
    tick?: { quote?: string | number };
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
    onTick: (price: number) => void;
    onStatus: (status: AnalysisFeedStatus, message?: string) => void;
};

let nextRequestId = Date.now() * 100;

const toMessage = (raw: unknown): DerivAnalysisMessage => {
    if (!raw || typeof raw !== 'object') return {};
    const envelope = raw as { data?: unknown };
    const message = envelope.data && typeof envelope.data === 'object' ? envelope.data : raw;
    return message as DerivAnalysisMessage;
};

const messageText = (message: DerivAnalysisMessage) =>
    message.error?.message || 'The site connection could not load market data.';

const pricesFromHistory = (message: DerivAnalysisMessage): number[] =>
    (message.history?.prices ?? [])
        .map(price => (typeof price === 'string' ? Number.parseFloat(price) : price))
        .filter((price): price is number => typeof price === 'number' && Number.isFinite(price));

export const subscribeToAnalysisFeed = ({
    api,
    symbol,
    count,
    onHistory,
    onTick,
    onStatus,
}: FeedOptions): (() => void) => {
    const historyRequestId = ++nextRequestId;
    const ticksRequestId = ++nextRequestId;
    let active = true;
    let historyReceived = false;
    let tickSubscriptionId: number | string | undefined;
    let messageSubscription: { unsubscribe: () => void } | undefined;

    const reportError = (message: DerivAnalysisMessage) => {
        if (active) onStatus('error', messageText(message));
    };

    const rememberTickSubscription = (message: DerivAnalysisMessage) => {
        if (message.subscription?.id !== undefined) {
            tickSubscriptionId = message.subscription.id;
            if (!active) forgetTickSubscription();
        }
    };

    const forgetTickSubscription = () => {
        if (tickSubscriptionId === undefined) return;
        const subscriptionId = tickSubscriptionId;
        tickSubscriptionId = undefined;
        try {
            const result = api.send({ forget: subscriptionId });
            if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
                void Promise.resolve(result).catch(() => undefined);
            }
        } catch {
            // The shared connection may already be closing.
        }
    };

    const handleHistory = (message: DerivAnalysisMessage) => {
        if (message.error) {
            reportError(message);
            return;
        }
        if (!message.history || historyReceived) return;

        historyReceived = true;
        onHistory(pricesFromHistory(message), message.pip_size ?? 2);
        if (active) onStatus('live');
    };

    const handleMessage = (raw: unknown) => {
        const message = toMessage(raw);

        if (message.req_id === historyRequestId || message.msg_type === 'history') {
            if (message.req_id === undefined || message.req_id === historyRequestId) {
                handleHistory(message);
            }
        }

        if (message.req_id === ticksRequestId || message.subscription?.id === tickSubscriptionId) {
            rememberTickSubscription(message);
            if (message.error) {
                reportError(message);
                return;
            }
            if (message.msg_type === 'tick') {
                const price = Number(message.tick?.quote);
                if (Number.isFinite(price) && active) {
                    onTick(price);
                    onStatus('live');
                }
            }
        }
    };

    try {
        messageSubscription = api.onMessage().subscribe(handleMessage);
    } catch (error) {
        onStatus(
            'error',
            error instanceof Error ? error.message : 'Could not listen to the site market-data connection.',
        );
        return () => undefined;
    }

    const sendRequest = (request: Record<string, unknown>, requestKind: 'history' | 'ticks') => {
        try {
            const result = api.send(request);
            if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
                void Promise.resolve(result)
                    .then(response => {
                        const message = toMessage(response);
                        if (message.error) {
                            reportError(message);
                            return;
                        }
                        if (requestKind === 'history') {
                            handleHistory(message);
                        } else {
                            rememberTickSubscription(message);
                        }
                    })
                    .catch(error => {
                        if (active) {
                            onStatus(
                                'error',
                                error instanceof Error
                                    ? error.message
                                    : 'The site connection could not load market data.',
                            );
                        }
                    });
            }
        } catch (error) {
            if (active) {
                onStatus(
                    'error',
                    error instanceof Error ? error.message : 'The site connection could not load market data.',
                );
            }
        }
    };

    sendRequest(
        {
            ticks_history: symbol,
            end: 'latest',
            count,
            style: 'ticks',
            subscribe: 0,
            req_id: historyRequestId,
        },
        'history',
    );
    sendRequest(
        {
            ticks: symbol,
            subscribe: 1,
            req_id: ticksRequestId,
        },
        'ticks',
    );

    return () => {
        active = false;
        messageSubscription?.unsubscribe();
        forgetTickSubscription();
    };
};
