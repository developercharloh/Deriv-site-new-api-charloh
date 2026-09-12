type MessageHandler = (message: unknown) => void;
type SentPayload = Record<string, any>;

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: null, is_authorized: true },
}));

import { BinaryMatrixEngine } from '@/utils/binary-matrix-engine';
import { api_base as mockApiBase } from '@/external/bot-skeleton/services/api/api-base';

describe('BinaryMatrixEngine live purchase path', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mockApiBase.is_authorized = true;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('buys EVEN after four qualifying odd digits', () => {
        const sent: SentPayload[] = [];
        let handler: MessageHandler | null = null;
        const api = {
            send: jest.fn((payload: SentPayload) => sent.push(payload)),
            onMessage: () => ({
                subscribe: (next: MessageHandler) => {
                    handler = next;
                    return { unsubscribe: () => { if (handler === next) handler = null; } };
                },
            }),
        };
        mockApiBase.api = api;

        const engine = new BinaryMatrixEngine({
            symbol: 'R_25',
            currency: 'USD',
            initialStake: 0.5,
            martingale: 2,
            takeProfit: 10,
            stopLoss: 50,
            reanalyzeAfterWins: 3,
        });
        const logs: string[] = [];
        engine.onLog = log => logs.push(log.message);
        engine.start();
        jest.advanceTimersByTime(300);

        const emit = (message: Record<string, any>) => {
            if (!handler) throw new Error('The engine message subscription is not active.');
            handler({ data: message });
        };
        const latest = (predicate: (payload: SentPayload) => boolean) => {
            const payload = [...sent].reverse().find(predicate);
            if (!payload) throw new Error('Expected a matching engine request.');
            return payload;
        };

        const tickRequest = latest(payload => payload.ticks_history === 'R_25');
        emit({
            msg_type: 'history',
            req_id: tickRequest.req_id,
            subscription: { id: 'matrix-ticks' },
            history: { prices: [] },
            pip_size: 2,
        });

        const proposalRequest = latest(payload => payload.proposal === 1);
        emit({
            msg_type: 'proposal',
            req_id: proposalRequest.req_id,
            subscription: { id: 'matrix-proposal' },
            proposal: {
                id: 'matrix-even-proposal',
                ask_price: '0.50',
                payout: '0.95',
                spot: '1.11',
                longcode: 'Even contract',
            },
        });

        [1.11, 1.33, 1.55, 1.77].forEach(quote => {
            emit({
                msg_type: 'tick',
                subscription: { id: 'matrix-ticks' },
                tick: { quote, pip_size: 2 },
            });
        });

        const buy = latest(payload => payload.buy === 'matrix-even-proposal');
        expect(buy).toMatchObject({
            price: 0.5,
        });
        expect(logs.some(message => message.includes('Last 4 digits are all odd → EVEN'))).toBe(true);
        expect(logs.some(message => message.includes('Bought #'))).toBe(false);

        emit({
            msg_type: 'buy',
            req_id: buy.req_id,
            buy: {
                contract_id: 24680,
                buy_price: '0.50',
                payout: '0.95',
                longcode: 'Even contract',
            },
        });
        expect(logs.some(message => message.includes('Bought #24680'))).toBe(true);

        engine.stop();
        mockApiBase.api = null;
    });
});