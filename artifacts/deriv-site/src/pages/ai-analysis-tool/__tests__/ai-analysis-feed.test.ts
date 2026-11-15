import { AnalysisApiClient, DerivAnalysisMessage, subscribeToAnalysisFeed } from '../ai-analysis-feed';

const createApi = () => {
    let listener: ((message: unknown) => void) | undefined;
    const unsubscribe = jest.fn(() => { listener = undefined; });
    const send = jest.fn((_request: Record<string, unknown>): unknown => undefined);
    const api: AnalysisApiClient = {
        onMessage: () => ({
            subscribe: callback => {
                listener = callback;
                return { unsubscribe };
            },
        }),
        send,
    };
    const onHistory = jest.fn();
    const onTick = jest.fn();
    const onStatus = jest.fn();
    const start = (symbol = '1HZ25V') => subscribeToAnalysisFeed({
        api, symbol, count: 500, onHistory, onTick, onStatus,
    });
    const emit = (message: DerivAnalysisMessage, own = true) =>
        listener?.({ data: { ...(own ? { req_id: send.mock.calls[0][0].req_id } : {}), ...message } });
    return { api, send, unsubscribe, emit, start, onHistory, onTick, onStatus };
};

describe('the shared Analysis feed', () => {
    it('loads history before streaming through one site API subscription', () => {
        const f = createApi();
        const cleanup = f.start();
        expect(f.send).toHaveBeenCalledWith(expect.objectContaining({
            ticks_history: '1HZ25V', end: 'latest', count: 500, style: 'ticks', subscribe: 1,
        }));
        f.emit({ msg_type: 'history', history: { prices: ['100.123', 100.244, 'invalid'] }, pip_size: 3 });
        expect(f.onHistory).toHaveBeenCalledWith([100.123, 100.244], 3);
        expect(f.onStatus).not.toHaveBeenCalledWith('live');
        f.emit({ msg_type: 'tick', tick: { quote: '100.377', pip_size: '3' }, subscription: { id: 'own' } });
        expect(f.onTick).toHaveBeenCalledWith(100.377, 3);
        expect(f.onStatus).toHaveBeenLastCalledWith('live');
        cleanup();
    });

    it('ignores unrelated history, ticks and errors on the shared connection', () => {
        const f = createApi();
        const cleanup = f.start();
        f.emit({ msg_type: 'history', history: { prices: [123] } }, false);
        f.emit({ msg_type: 'tick', tick: { quote: 22 }, subscription: { id: 'someone-else' } }, false);
        f.emit({ error: { message: 'Unrelated purchase error' } }, false);
        expect(f.onHistory).not.toHaveBeenCalled();
        expect(f.onTick).not.toHaveBeenCalled();
        expect(f.onStatus).not.toHaveBeenCalled();
        cleanup();
        expect(f.send).toHaveBeenCalledTimes(1);
    });

    it('reports correlated API errors and empty history', () => {
        const f = createApi();
        const cleanup = f.start();
        f.emit({ error: { message: 'Market unavailable' } });
        expect(f.onStatus).toHaveBeenCalledWith('error', 'Market unavailable');
        f.emit({ msg_type: 'history', history: { prices: [] } });
        expect(f.onStatus).toHaveBeenLastCalledWith('error', expect.stringContaining('No price history'));
        cleanup();
    });

    it('reports rejected sends', async () => {
        const f = createApi();
        f.send.mockReturnValueOnce(Promise.reject({ error: { message: 'Connection failed' } }));
        const cleanup = f.start();
        await Promise.resolve();
        await Promise.resolve();
        expect(f.onStatus).toHaveBeenCalledWith('error', 'Connection failed');
        cleanup();
    });

    it('releases only its subscription on exit and supports ticks identified by subscription ID', () => {
        const f = createApi();
        const cleanup = f.start();
        f.emit({ msg_type: 'history', history: { prices: [123.45] }, subscription: { id: 'own' } });
        f.emit({ msg_type: 'tick', tick: { quote: 123.46 }, subscription: { id: 'own' } }, false);
        expect(f.onTick).toHaveBeenCalledWith(123.46, undefined);
        cleanup();
        cleanup();
        expect(f.unsubscribe).toHaveBeenCalled();
        expect(f.send.mock.calls.filter(([request]) => 'forget' in request)).toEqual([[{ forget: 'own' }]]);
        expect(f.api).not.toHaveProperty('disconnect');
    });

    it('releases a subscription acknowledged only after cleanup, without changing old page state', async () => {
        const f = createApi();
        let resolve!: (response: unknown) => void;
        f.send.mockReturnValueOnce(new Promise(done => { resolve = done; }));
        const cleanup = f.start();
        cleanup();
        resolve({ msg_type: 'history', history: { prices: [123] }, subscription: { id: 'late' } });
        await Promise.resolve();
        expect(f.send).toHaveBeenLastCalledWith({ forget: 'late' });
        expect(f.onHistory).not.toHaveBeenCalled();
        expect(f.onStatus).not.toHaveBeenCalled();
    });

    it('applies the initial history only once when the promise and stream both deliver it', async () => {
        const f = createApi();
        const message = { msg_type: 'history', history: { prices: [123] }, subscription: { id: 'own' } };
        f.send.mockReturnValueOnce(Promise.resolve(message));
        const cleanup = f.start();
        f.emit(message);
        f.emit({ msg_type: 'tick', tick: { quote: 124 }, subscription: { id: 'own' } });
        await Promise.resolve();
        expect(f.onHistory).toHaveBeenCalledTimes(1);
        expect(f.onTick).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it('uses new request IDs on market change or replacement connection', () => {
        const first = createApi();
        const second = createApi();
        const cleanupFirst = first.start();
        cleanupFirst();
        const cleanupSecond = second.start('JD10');
        expect(first.send.mock.calls[0][0].req_id).not.toBe(second.send.mock.calls[0][0].req_id);
        second.emit({ msg_type: 'history', history: { prices: [5] } });
        second.emit({ msg_type: 'tick', tick: { quote: 6 } });
        expect(second.onTick).toHaveBeenCalledWith(6, undefined);
        expect(first.onTick).not.toHaveBeenCalled();
        cleanupSecond();
    });
});
