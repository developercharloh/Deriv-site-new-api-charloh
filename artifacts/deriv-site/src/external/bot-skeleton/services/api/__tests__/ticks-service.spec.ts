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
});