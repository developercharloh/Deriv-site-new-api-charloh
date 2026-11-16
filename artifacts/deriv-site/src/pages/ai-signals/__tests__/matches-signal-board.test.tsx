import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MatchesSignalBoard } from '../matches-signal-board';

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

    beforeEach(() => {
        jest.useFakeTimers();
        sockets.length = 0;
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
        Object.defineProperty(globalThis, 'WebSocket', {
            configurable: true,
            value: originalWebSocket,
        });
    });

    it('subscribes to one-minute candles for every 1-second volatility market and renders live charts', async () => {
        render(<MatchesSignalBoard active onToggle={jest.fn()} maintenanceActive={false} />);
        const socket = sockets[0];
        expect(socket).toBeDefined();

        await act(async () => {
            socket.open();
            jest.advanceTimersByTime(700);
        });

        const requests = socket.sent.map(request => JSON.parse(request));
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
        await act(async () => {
            socket.message({ msg_type: 'history', req_id: 4200, candles, subscription: { id: 'sub-1' } });
        });
        expect(screen.getByRole('img', {
            name: 'Volatility 10 (1s) Index one-minute candlesticks and normalized TSI',
        })).toBeInTheDocument();

        await act(async () => {
            socket.message({
                msg_type: 'ohlc',
                ohlc: { symbol: '1HZ10V', open_time: 4200, epoch: 4258, open: 170, high: 171, low: 169, close: 170.5 },
                subscription: { id: 'sub-1' },
            });
        });
        expect(screen.getByText('Live')).toBeInTheDocument();
        expect(screen.getByText('00:02')).toBeInTheDocument();
        expect(screen.queryByText('TRADE NOW')).not.toBeInTheDocument();
    });
});
