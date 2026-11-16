import { subscribeToMatchesCandleFeed, type MatchesCandleApi } from '../matches-candle-feed';

describe('Shared Matches candle feed', () => {
    let receive: (message: unknown) => void;
    let send: jest.Mock;
    let api: MatchesCandleApi;
    let history: jest.Mock;
    let live: jest.Mock;
    let status: jest.Mock;
    const candles = [{ epoch: 120, open: 1, high: 3, low: 1, close: 2 }];
    const start = () => subscribeToMatchesCandleFeed({
        api, symbols: [{ code: '1HZ10V' }, { code: '1HZ25V' }],
        onHistory: history, onCandle: live, onStatus: status,
    });
    beforeEach(() => {
        jest.useFakeTimers();
        send = jest.fn();
        history = jest.fn(); live = jest.fn(); status = jest.fn();
        api = { send, onMessage: () => ({ subscribe: callback => {
            receive = callback; return { unsubscribe: jest.fn() };
        } }) };
    });
    afterEach(() => jest.useRealTimers());

    it('handles the initial response promise and stream once and ignores unrelated feeds', async () => {
        send.mockImplementation(request => request.ticks_history
            ? Promise.resolve({ req_id: request.req_id, candles, subscription: { id: request.ticks_history } })
            : undefined);
        const stop = start();
        jest.advanceTimersByTime(100);
        await Promise.resolve();
        expect(history).toHaveBeenCalledTimes(2);
        const request = send.mock.calls[0][0];
        receive({ data: { req_id: request.req_id, candles, subscription: { id: '1HZ10V' } } });
        expect(history).toHaveBeenCalledTimes(2);
        receive({ data: { msg_type: 'ohlc', ohlc: { symbol: '1HZ10V' }, subscription: { id: 'unrelated' } } });
        expect(live).not.toHaveBeenCalled();
        receive({ data: { msg_type: 'ohlc', ohlc: { symbol: '1HZ10V' }, subscription: { id: '1HZ10V' } } });
        expect(live).toHaveBeenCalledTimes(1);
        stop();
        expect(send).toHaveBeenCalledWith({ forget: '1HZ10V' });
        expect(send).toHaveBeenCalledWith({ forget: '1HZ25V' });
        expect(send).not.toHaveBeenCalledWith({ forget: 'unrelated' });
    });

    it('recovers one rejected market without restarting a healthy market', () => {
        const stop = start();
        jest.advanceTimersByTime(100);
        const requests = send.mock.calls.map(([request]) => request);
        receive({ req_id: requests[0].req_id, candles, subscription: { id: 'good' } });
        receive({ req_id: requests[1].req_id, error: { message: 'Rate limit' } });
        jest.advanceTimersByTime(1_000);
        expect(send.mock.calls.filter(([request]) => request.ticks_history === '1HZ10V')).toHaveLength(1);
        expect(send.mock.calls.filter(([request]) => request.ticks_history === '1HZ25V')).toHaveLength(2);
        stop();
    });

    it('restores a stalled live feed and ignores late messages from the old request', () => {
        const stop = start();
        jest.advanceTimersByTime(100);
        const request = send.mock.calls[0][0];
        receive({ req_id: request.req_id, candles, subscription: { id: 'old' } });
        jest.advanceTimersByTime(16_000);
        expect(send).toHaveBeenCalledWith({ forget: 'old' });
        expect(send.mock.calls.filter(([payload]) => payload.ticks_history === '1HZ10V').length).toBeGreaterThan(1);
        receive({ req_id: request.req_id, candles, subscription: { id: 'late' } });
        expect(history).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith({ forget: 'late' });
        stop();
    });
});
