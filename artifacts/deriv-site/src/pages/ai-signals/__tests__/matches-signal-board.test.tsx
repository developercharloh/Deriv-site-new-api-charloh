import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MatchesSignalBoard, MatchesSignalSection } from '../matches-signal-board';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';

jest.mock('@/hooks/useApiBase', () => ({ useApiBase: jest.fn() }));
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { api: null } }));

describe('Matches shared market board', () => {
    let listeners: Set<(message: unknown) => void>;
    let send: jest.Mock;
    const emit = (message: unknown) => listeners.forEach(listener => listener({ data: message }));
    const candles = Array.from({ length: 70 }, (_, index) => ({
        epoch: index * 60, open: 100 + index, high: 101.2 + index, low: 99.8 + index, close: 101 + index,
    }));

    beforeEach(() => {
        jest.useFakeTimers();
        listeners = new Set();
        send = jest.fn();
        (api_base as any).api = {
            send,
            onMessage: () => ({
                subscribe: (callback: (message: unknown) => void) => {
                    listeners.add(callback);
                    return { unsubscribe: () => listeners.delete(callback) };
                },
            }),
        };
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'opened' });
    });
    afterEach(() => jest.useRealTimers());

    it('shows both ranges on every market without range tabs, using eight shared subscriptions', async () => {
        const { container } = render(<MatchesSignalSection active onToggle={jest.fn()} maintenanceActive={false} />);
        expect(screen.getByRole('heading', { name: 'Matches' })).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        expect(screen.getAllByText('MATCHES 0–4 · TSI')).toHaveLength(8);
        expect(screen.getAllByText('MATCHES 6–9 · MACD')).toHaveLength(8);
        await act(async () => { jest.advanceTimersByTime(700); });
        const requests = send.mock.calls.map(([request]) => request).filter(request => request.ticks_history);
        expect(requests).toHaveLength(8);
        expect(new Set(requests.map(request => request.ticks_history)).size).toBe(8);
        expect(requests.every(request => request.style === 'candles' && request.granularity === 60 && request.subscribe === 1)).toBe(true);
        await act(async () => {
            requests.forEach((request, index) => {
                emit({ msg_type: 'candles', req_id: request.req_id, candles, subscription: { id: `sub-${index}` } });
                emit({
                    msg_type: 'ohlc',
                    ohlc: { symbol: request.ticks_history, open_time: 4200, epoch: 4258, open: 170, high: 171, low: 169, close: 170.5 },
                    subscription: { id: `sub-${index}` },
                });
            });
        });
        expect(screen.getByText('8/8 live')).toBeInTheDocument();
        expect(screen.getAllByRole('img')).toHaveLength(16);
        expect(screen.getAllByText('00:02')).toHaveLength(16);
        expect(screen.queryByText('TRADE NOW')).not.toBeInTheDocument();
        expect(within(container.querySelector('article')!).getByText('MATCHES 0–4 · TSI')).toBeInTheDocument();
        await act(async () => { jest.advanceTimersByTime(3_000); });
        expect(screen.queryByText('8/8 live')).not.toBeInTheDocument();
    });

    it('waits for the site connection, resubscribes on reconnect, and forgets only owned feeds on pause', async () => {
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'closed' });
        const { rerender } = render(<MatchesSignalSection active onToggle={jest.fn()} maintenanceActive={false} />);
        await act(async () => { jest.advanceTimersByTime(700); });
        expect(send).not.toHaveBeenCalled();
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'opened' });
        rerender(<MatchesSignalSection active onToggle={jest.fn()} maintenanceActive={false} />);
        await act(async () => { jest.advanceTimersByTime(700); });
        const request = send.mock.calls[0][0];
        await act(async () => {
            emit({ req_id: request.req_id, candles, subscription: { id: 'owned' } });
            emit({ candles, subscription: { id: 'someone-else' } });
        });
        rerender(<MatchesSignalSection active={false} onToggle={jest.fn()} maintenanceActive={false} />);
        expect(send).toHaveBeenCalledWith({ forget: 'owned' });
        expect(send).not.toHaveBeenCalledWith({ forget: 'someone-else' });
        expect(listeners.size).toBe(0);
    });
});
class MockWebSocket {
    static OPEN = 1;
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    sent: string[] = [];

    send(data: string) { this.sent.push(data); }
    open() {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.(new Event('open'));
    }
    message(data: unknown) {
        this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
    }
    close() {
        this.readyState = 3;
        this.onclose?.(new CloseEvent('close'));
    }
}

describe('MatchesSignalBoard', () => {
    const sockets: MockWebSocket[] = [];
    const originalWebSocket = globalThis.WebSocket;
    const apiRequests: Array<Record<string, any>> = [];
    let apiMessageHandler: ((message: unknown) => void) | null = null;

    beforeEach(() => {
        jest.useFakeTimers();
        sockets.length = 0;
        apiRequests.length = 0;
        apiMessageHandler = null;
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'opened' });
        (api_base as any).api = {
            send: jest.fn((request: Record<string, any>) => { apiRequests.push(request); }),
            onMessage: () => ({
                subscribe: (callback: (message: unknown) => void) => {
                    apiMessageHandler = callback;
                    return { unsubscribe: jest.fn() };
                },
            }),
        };
        Object.defineProperty(globalThis, 'WebSocket', {
            configurable: true,
            value: class extends MockWebSocket {
                constructor() {
                    super();
                    sockets.push(this);
                }
            },
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        (api_base as any).api = null;
        Object.defineProperty(globalThis, 'WebSocket', {
            configurable: true,
            value: originalWebSocket,
        });
    });

    it('subscribes to one-minute candles for every 1-second volatility market and renders live charts', async () => {
        render(<MatchesSignalBoard active onToggle={jest.fn()} maintenanceActive={false} />);
        await act(async () => {
            jest.advanceTimersByTime(700);
        });

        const requests = apiRequests;
        expect(requests).toHaveLength(8);
        expect(requests.every(request =>
            request.style === 'candles' &&
            request.granularity === 60 &&
            request.count === 120 &&
            request.subscribe === 1,
        )).toBe(true);

        const candles = Array.from({ length: 70 }, (_, index) => ({
            epoch: index * 60,
            open: 100 + index,
            high: 101.2 + index,
            low: 99.8 + index,
            close: 101 + index,
        }));
        const historyRequest = requests.find(request => request.ticks_history === '1HZ10V')!;
        await act(async () => {
            apiMessageHandler?.({ msg_type: 'history', req_id: historyRequest.req_id, candles, subscription: { id: 'sub-1' } });
        });
        expect(screen.getByRole('img', {
            name: 'Volatility 10 (1s) Index one-minute candlesticks and normalized TSI',
        })).toBeInTheDocument();

        await act(async () => {
            apiMessageHandler?.({
                msg_type: 'ohlc',
                ohlc: { symbol: '1HZ10V', open_time: 4200, epoch: 4258, open: 170, high: 171, low: 169, close: 170.5 },
                subscription: { id: 'sub-1' },
            });
        });
        expect(screen.getByText('Live')).toBeInTheDocument();
        expect(screen.getAllByText('00:02')).toHaveLength(2);
        expect(screen.queryByText('TRADE NOW')).not.toBeInTheDocument();
    });

    it('shows the MACD chart and ignores candle color in the MACD setup', async () => {
        render(<MatchesSignalBoard active onToggle={jest.fn()} maintenanceActive={false} strategy='macd' />);
        expect(screen.getByText(/Candle color is ignored/)).toBeInTheDocument();

        await act(async () => {
            jest.advanceTimersByTime(700);
        });
        const requests = apiRequests;
        expect(requests).toHaveLength(8);
        expect(requests.every(request =>
            request.style === 'candles' &&
            request.granularity === 60 &&
            request.subscribe === 1,
        )).toBe(true);

        const candles = Array.from({ length: 70 }, (_, index) => ({
            epoch: index * 60,
            open: 100 + index,
            high: 101.2 + index,
            low: 99.8 + index,
            close: 101 + index,
        }));
        const historyRequest = requests.find(request => request.ticks_history === '1HZ10V')!;
        await act(async () => {
            apiMessageHandler?.({ msg_type: 'history', req_id: historyRequest.req_id, candles, subscription: { id: 'sub-macd' } });
            apiMessageHandler?.({
                msg_type: 'ohlc',
                ohlc: { symbol: '1HZ10V', open_time: 4200, epoch: 4258, open: 170.5, high: 171, low: 169, close: 170 },
                subscription: { id: 'sub-macd' },
            });
        });
        expect(screen.getByRole('img', {
            name: 'Volatility 10 (1s) Index one-minute candlesticks and MACD 12/26/9',
        })).toBeInTheDocument();
        expect(screen.queryByText('TRADE NOW')).not.toBeInTheDocument();
    });

    it('replays bounded tick history and shows per-market historical digit counts', async () => {
        render(<MatchesSignalBoard active onToggle={jest.fn()} maintenanceActive={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Replay history' }));
        const socket = sockets[0];
        expect(socket).toBeDefined();

        await act(async () => {
            socket.open();
            jest.advanceTimersByTime(800);
        });
        const requests = socket.sent.map(request => JSON.parse(request));
        expect(requests).toHaveLength(8);
        expect(requests.every(request =>
            request.style === 'ticks' &&
            request.count === 5_000 &&
            request.end === 'latest' &&
            request.subscribe === undefined,
        )).toBe(true);

        await act(async () => {
            requests.forEach(request => socket.message({
                msg_type: 'history',
                req_id: request.req_id,
                pip_size: 2,
                history: {
                    times: Array.from({ length: 12 }, (_, index) => 1_700_000_000 + index),
                    prices: Array.from({ length: 12 }, (_, index) => (100 + index / 100).toFixed(2)),
                },
            }));
        });

        expect(await screen.findByText('Historical observations only—not a profit guarantee. Digit counts show the next tick after each setup trigger, not trade performance.')).toBeInTheDocument();
        expect(screen.getAllByText(/setup triggers/)).toHaveLength(8);
        expect(screen.getAllByLabelText(/next-tick digit counts/)).toHaveLength(8);
    });
});
