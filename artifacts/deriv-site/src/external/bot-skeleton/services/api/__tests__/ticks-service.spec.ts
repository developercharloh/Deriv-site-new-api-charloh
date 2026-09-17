jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: {
        api: null,
        is_running: true,
        pip_sizes: {},
        pushSubscription: jest.fn(),
        toggleRunButton: jest.fn(),
    },
}));

import TicksService from '../ticks_service';
import { api_base } from '../api-base';

describe('TicksService subscription recovery', () => {
    it('uses a non-subscribed history request for scans', async () => {
        const tickRequests: Record<string, unknown>[] = [];
        const api = {
            send: jest.fn((payload: Record<string, unknown>) => {
                tickRequests.push(payload);
                return Promise.resolve({
                    history: {
                        times: [1, 2],
                        prices: ['1.11', '1.22'],
                    },
                });
            }),
            onMessage: () => ({
                subscribe: () => ({ unsubscribe: jest.fn() }),
            }),
        };
        (api_base as any).api = api;
        (api_base as any).pip_sizes = { R_25: 2 };

        const service = new TicksService();
        await service.request({ symbol: 'R_25', subscribe: false });

        expect(tickRequests[0]).toMatchObject({
            ticks_history: 'R_25',
        });
        expect(tickRequests[0]).not.toHaveProperty('subscribe');
    });

    it('opens a live subscription when monitoring history previously scanned without one', async () => {
        const tickRequests: Record<string, unknown>[] = [];
        const api = {
            send: jest.fn((payload: Record<string, unknown>) => {
                tickRequests.push(payload);
                return Promise.resolve({
                    history: {
                        times: [1, 2],
                        prices: ['1.11', '1.22'],
                    },
                });
            }),
            onMessage: () => ({
                subscribe: () => ({ unsubscribe: jest.fn() }),
            }),
        };
        (api_base as any).api = api;
        (api_base as any).pip_sizes = { R_25: 2 };

        const service = new TicksService();
        await service.request({ symbol: 'R_25', subscribe: false });
        await service.monitor({ symbol: 'R_25', callback: jest.fn() });

        expect(tickRequests.map(request => request.subscribe)).toEqual([undefined, 1]);
    });

    it('clears a stale tick stream and retries once instead of looping', async () => {
        const tickRequests: Record<string, unknown>[] = [];
        const forgetAll = jest.fn(() => Promise.resolve({}));
        const api = {
            send: jest.fn((payload: Record<string, unknown>) => {
                if (payload.ticks_history) {
                    tickRequests.push(payload);
                    if (tickRequests.length === 1) {
                        return Promise.reject({
                            error: {
                                code: 'AlreadySubscribed',
                                message: 'You are already subscribed to R_25',
                            },
                        });
                    }
                    return Promise.resolve({
                        history: {
                            times: [1, 2],
                            prices: ['1.11', '1.22'],
                        },
                    });
                }
                return Promise.resolve({});
            }),
            forget: jest.fn(() => Promise.resolve({})),
            forgetAll,
            onMessage: () => ({
                subscribe: () => ({ unsubscribe: jest.fn() }),
            }),
        };
        (api_base as any).api = api;
        (api_base as any).pip_sizes = { R_25: 2 };

        const service = new TicksService();
        const ticks = await service.request({ symbol: 'R_25' });

        expect(ticks).toHaveLength(2);
        expect(tickRequests).toHaveLength(2);
        expect(forgetAll).toHaveBeenCalledWith('ticks');
        expect(api.send).toHaveBeenCalledTimes(2);
    });

    it('refreshes pip sizes after an early empty initialization', async () => {
        (api_base as any).pip_sizes = {};
        const service = new TicksService();

        await service.requestPipSizes();
        expect((service as any).pipSizes).toEqual({});

        (api_base as any).pip_sizes = {
            '1HZ15V': 3,
            R_50: 4,
        };

        await service.requestPipSizes();
        expect((service as any).pipSizes).toEqual({
            '1HZ15V': 3,
            R_50: 4,
        });
    });
});