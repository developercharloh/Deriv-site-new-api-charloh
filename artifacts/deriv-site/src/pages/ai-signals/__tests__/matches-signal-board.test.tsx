import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { MatchesSignalSection } from '../matches-signal-board';
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
