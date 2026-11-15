import {
    AnalysisApiClient,
    DerivAnalysisMessage,
    subscribeToAnalysisFeed,
} from '../ai-analysis-feed';

const createApi = () => {
    let listener: ((message: unknown) => void) | undefined;
    const requests: Record<string, unknown>[] = [];
    const unsubscribe = jest.fn(() => {
        listener = undefined;
    });
    const api: AnalysisApiClient = {
        onMessage: () => ({
            subscribe: callback => {
                listener = callback;
                return { unsubscribe };
            },
        }),
        send: request => {
            requests.push(request);
            return undefined;
        },
    };

    return {
        api,
        requests,
        unsubscribe,
        emit: (message: DerivAnalysisMessage) => listener?.({ data: message }),
    };
};

describe('subscribeToAnalysisFeed', () => {
    it('loads history and streams ticks through the shared site API', () => {
        const fake = createApi();
        const onHistory = jest.fn();
        const onTick = jest.fn();
        const onStatus = jest.fn();
        const cleanup = subscribeToAnalysisFeed({
            api: fake.api,
            symbol: '1HZ25V',
            count: 500,
            onHistory,
            onTick,
            onStatus,
        });
        const historyRequest = fake.requests.find(request => 'ticks_history' in request);
        const ticksRequest = fake.requests.find(request => 'ticks' in request);

        expect(historyRequest).toMatchObject({
            ticks_history: '1HZ25V',
            count: 500,
            style: 'ticks',
        });
        expect(ticksRequest).toMatchObject({ ticks: '1HZ25V', subscribe: 1 });

        fake.emit({
            msg_type: 'history',
            req_id: historyRequest?.req_id as number,
            history: { prices: ['100.12', 100.24, 'invalid'] },
            pip_size: 2,
        });
        fake.emit({
            msg_type: 'tick',
            req_id: ticksRequest?.req_id as number,
            tick: { quote: '100.37' },
            subscription: { id: 'analysis-ticks' },
        });

        expect(onHistory).toHaveBeenCalledWith([100.12, 100.24], 2);
        expect(onTick).toHaveBeenCalledWith(100.37);
        expect(onStatus).toHaveBeenLastCalledWith('live');
        cleanup();
    });

    it('reports a correlated API error instead of remaining in connecting state', () => {
        const fake = createApi();
        const onStatus = jest.fn();
        const cleanup = subscribeToAnalysisFeed({
            api: fake.api,
            symbol: '1HZ25V',
            count: 200,
            onHistory: jest.fn(),
            onTick: jest.fn(),
            onStatus,
        });
        const historyRequest = fake.requests.find(request => 'ticks_history' in request);

        fake.emit({
            req_id: historyRequest?.req_id as number,
            error: { message: 'Market history is unavailable.' },
        });

        expect(onStatus).toHaveBeenCalledWith('error', 'Market history is unavailable.');
        cleanup();
    });

    it('can attach to a replacement site connection after reconnecting', () => {
        const first = createApi();
        const second = createApi();
        const onTick = jest.fn();
        const makeOptions = (api: AnalysisApiClient) => ({
            api,
            symbol: 'JD10',
            count: 200,
            onHistory: jest.fn(),
            onTick,
            onStatus: jest.fn(),
        });
        const cleanupFirst = subscribeToAnalysisFeed(makeOptions(first.api));
        cleanupFirst();
        const cleanupSecond = subscribeToAnalysisFeed(makeOptions(second.api));
        const ticksRequest = second.requests.find(request => 'ticks' in request);

        second.emit({
            msg_type: 'tick',
            req_id: ticksRequest?.req_id as number,
            tick: { quote: 123.45 },
            subscription: { id: 22 },
        });

        expect(first.unsubscribe).toHaveBeenCalledTimes(1);
        expect(onTick).toHaveBeenCalledWith(123.45);
        cleanupSecond();
    });

    it('unsubscribes its listener and forgets only its own tick subscription', () => {
        const fake = createApi();
        const onTick = jest.fn();
        const cleanup = subscribeToAnalysisFeed({
            api: fake.api,
            symbol: '1HZ25V',
            count: 200,
            onHistory: jest.fn(),
            onTick,
            onStatus: jest.fn(),
        });
        const ticksRequest = fake.requests.find(request => 'ticks' in request);

        fake.emit({
            msg_type: 'tick',
            req_id: ticksRequest?.req_id as number,
            tick: { quote: 99.01 },
            subscription: { id: 'analysis-only' },
        });
        cleanup();

        expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
        expect(fake.requests).toContainEqual({ forget: 'analysis-only' });
        fake.emit({
            msg_type: 'tick',
            subscription: { id: 'analysis-only' },
            tick: { quote: 99.02 },
        });
        expect(onTick).toHaveBeenCalledTimes(1);
    });
});
