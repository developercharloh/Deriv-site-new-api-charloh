import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MatchesSignalBoard } from '../matches-signal-board';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';

jest.mock('@/hooks/useApiBase', () => ({ useApiBase: jest.fn() }));
jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({ api_base: { api: null } }));

const fs: typeof import('fs') = require('fs');
const path: typeof import('path') = require('path');
const pnpmStore = path.resolve(process.cwd(), '../../node_modules/.pnpm');
const wsStorePackage = fs.readdirSync(pnpmStore).find((entry: string) =>
    entry.startsWith('ws@') && fs.existsSync(path.join(pnpmStore, entry, 'node_modules/ws')),
);
if (!wsStorePackage) throw new Error('The workspace ws package is required for the live feed test.');
const WebSocketClient = require(path.join(pnpmStore, wsStorePackage, 'node_modules/ws'));
const LIVE_PUBLIC_ENDPOINT = 'wss://api.derivws.com/trading/v1/options/ws/public';
const liveDescribe = process.env.MATCHES_LIVE_FEED === '1' ? describe : describe.skip;

liveDescribe('Matches board with live public candle feed (read-only)', () => {
    it('renders all eight market charts from live candle history and updates without authorization', async () => {
        const socket = new WebSocketClient(LIVE_PUBLIC_ENDPOINT);
        const listeners = new Set<(message: unknown) => void>();
        const pending = new Map<number, (message: unknown) => void>();
        const sentFrames: Array<Record<string, unknown>> = [];
        const liveUpdates = new Map<string, number>();
        let opened = false;
        const open = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Public candle feed connection timed out.')), 15_000);
            socket.once('open', () => {
                opened = true;
                clearTimeout(timer);
                resolve();
            });
            socket.once('error', (error: Error) => {
                clearTimeout(timer);
                reject(error);
            });
        });

        const api = {
            send: (payload: Record<string, unknown>) => {
                if (!opened) return Promise.reject(new Error('Public feed is not open.'));
                if (payload.forget !== undefined) {
                    sentFrames.push(payload);
                    socket.send(JSON.stringify(payload));
                    return Promise.resolve({});
                }
                const id = Number(payload.req_id);
                return new Promise(resolve => {
                    pending.set(id, resolve);
                    sentFrames.push(payload);
                    socket.send(JSON.stringify(payload));
                });
            },
            onMessage: () => ({
                subscribe: (callback: (message: unknown) => void) => {
                    listeners.add(callback);
                    return { unsubscribe: () => listeners.delete(callback) };
                },
            }),
        };

        socket.on('message', (raw: { toString(): string }) => {
            const message = JSON.parse(raw.toString());
            act(() => {
                listeners.forEach(listener => listener(message));
                if (message.msg_type === 'ohlc' && message.ohlc?.symbol) {
                    const symbol = message.ohlc.symbol;
                    liveUpdates.set(symbol, (liveUpdates.get(symbol) ?? 0) + 1);
                }
            });
            const resolve = pending.get(Number(message.req_id));
            if (resolve && (message.candles || message.error)) {
                pending.delete(Number(message.req_id));
                resolve(message);
            }
        });
        await open;
        (useApiBase as jest.Mock).mockReturnValue({ connectionStatus: 'opened' });
        (api_base as any).api = api;

        const view = render(
            <MatchesSignalBoard active onToggle={jest.fn()} maintenanceActive={false} strategy='macd' />,
        );
        try {
            await waitFor(() => expect(screen.getByText('Live on all 8 one-second indices')).toBeInTheDocument(), {
                timeout: 30_000,
            });

            const symbols = ['1HZ10V', '1HZ15V', '1HZ25V', '1HZ30V', '1HZ50V', '1HZ75V', '1HZ90V', '1HZ100V'];
            const requests = sentFrames.filter(frame => frame.ticks_history);
            expect(requests).toHaveLength(8);
            expect(requests.map(frame => frame.ticks_history).sort()).toEqual([...symbols].sort());
            expect(requests.every(frame =>
                frame.style === 'candles' && frame.granularity === 60 && frame.count === 120 &&
                frame.end === 'latest' && frame.subscribe === 1,
            )).toBe(true);
            const cards = [...view.container.querySelectorAll('article.match-market')];
            expect(cards).toHaveLength(8);
            expect(screen.getAllByRole('img', {
                name: /one-minute candlesticks and MACD 12\/26\/9/,
            })).toHaveLength(8);
            expect(screen.getAllByText('Live')).toHaveLength(8);

            // Verify that every real feed sends updates after its history and that
            // the corresponding chart is populated with rendered candlesticks.
            await waitFor(() => {
                expect(symbols.every(symbol => (liveUpdates.get(symbol) ?? 0) > 0)).toBe(true);
                cards.forEach(card => expect(card.querySelectorAll('.match-chart__body').length).toBeGreaterThan(0));
            }, { timeout: 15_000 });
            const updatesAtBaseline = new Map(liveUpdates);
            const chartMarkupAtBaseline = cards.map(card => card.querySelector('svg')!.innerHTML);
            await waitFor(() => {
                expect(symbols.every(symbol =>
                    (liveUpdates.get(symbol) ?? 0) > (updatesAtBaseline.get(symbol) ?? 0),
                )).toBe(true);
                cards.forEach((card, index) =>
                    expect(card.querySelector('svg')!.innerHTML).not.toBe(chartMarkupAtBaseline[index]),
                );
            }, { timeout: 15_000 });

            expect(screen.queryByText('TRADE NOW')).not.toBeInTheDocument();
            expect([...pending.keys()]).toHaveLength(0);
            const forbidden = sentFrames.filter(frame =>
                ['authorize', 'proposal', 'buy', 'sell'].some(key => key in frame),
            );
            expect(forbidden).toHaveLength(0);
        } finally {
            view.unmount();
            try { socket.close(); } catch { /* already closed */ }
        }
    }, 90_000);
});
