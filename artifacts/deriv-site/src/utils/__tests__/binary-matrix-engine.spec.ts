type MessageHandler = (message: unknown) => void;
type SentPayload = Record<string, any>;

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: null, is_authorized: true },
}));

import { BinaryMatrixEngine } from '@/utils/binary-matrix-engine';
import { api_base as mockApiBase } from '@/external/bot-skeleton/services/api/api-base';
import { observer } from '@/external/bot-skeleton/utils/observer';

describe('BinaryMatrixEngine live purchase path', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mockApiBase.is_authorized = true;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('publishes one analysis event for every incoming tick, including partial windows', () => {
        const engine = new BinaryMatrixEngine({
            symbol: 'R_25',
            currency: 'USD',
            initialStake: 0.5,
            martingale: 2,
            takeProfit: 10,
            stopLoss: 50,
            reanalyzeAfterWins: 3,
        }) as any;
        const emit = jest.spyOn(observer, 'emit');
        engine.running = true;
        engine.paused = true;

        engine.trader.onTick('1.1', 1);
        engine.trader.onTick('1.3', 3);
        engine.trader.onTick('1.5', 5);
        engine.trader.onTick('1.7', 7);

        const analyses = emit.mock.calls
            .filter(([event]) => event === 'bot.analysis.condition')
            .map(([, payload]) => payload);

        expect(analyses).toHaveLength(4);
        expect(analyses.map(payload => payload.result)).toEqual([false, false, false, true]);
        expect(analyses[0]).toMatchObject({
            market: 'R_25',
            condition: 'ALL_ODD',
            count: 4,
            digits: [1],
        });
        expect(analyses[1]).toMatchObject({ digits: [1, 3] });
        expect(analyses[2]).toMatchObject({ digits: [1, 3, 5] });
        expect(analyses[3]).toMatchObject({ digits: [1, 3, 5, 7] });

        emit.mockRestore();
        engine.running = false;
    });

    it('buys EVEN after four qualifying odd digits', async () => {
        const sent: SentPayload[] = [];
        let handler: MessageHandler | null = null;
        const api = {
            send: jest.fn((payload: SentPayload) => sent.push(payload)),
            forgetAll: jest.fn(() => Promise.resolve()),
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
        const positions: Array<{ isOpen: boolean; contractId: string }> = [];
        engine.onLog = log => logs.push(log.message);
        engine.onPosition = position => positions.push({
            isOpen: position.isOpen,
            contractId: position.contractId,
        });
        engine.start();
        await Promise.resolve();
        await Promise.resolve();
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
        expect(positions).toContainEqual({ isOpen: true, contractId: '24680' });

        const settlement = latest(payload => payload.proposal_open_contract === 1);
        emit({
            msg_type: 'proposal_open_contract',
            req_id: settlement.req_id,
            subscription: { id: 'matrix-contract' },
            proposal_open_contract: {
                contract_id: 24680,
                status: 'lost',
                profit: '-0.50',
                bid_price: '0',
                entry_tick_display_value: '123.45',
                exit_tick_display_value: '123.46',
            },
        });
        expect(positions).toContainEqual({ isOpen: false, contractId: '24680' });

        engine.stop();
        mockApiBase.api = null;
    });

    it('passes the Martingale stake to the next proposal after a loss', async () => {
        const sent: SentPayload[] = [];
        let handler: MessageHandler | null = null;
        const api = {
            send: jest.fn((payload: SentPayload) => sent.push(payload)),
            forgetAll: jest.fn(() => Promise.resolve()),
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
        engine.start();
        await Promise.resolve();
        await Promise.resolve();
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

        const firstProposalRequest = latest(payload => payload.proposal === 1);
        emit({
            msg_type: 'proposal',
            req_id: firstProposalRequest.req_id,
            subscription: { id: 'matrix-proposal' },
            proposal: {
                id: 'matrix-even-proposal-1',
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

        const firstBuy = latest(payload => payload.buy === 'matrix-even-proposal-1');
        expect(firstBuy.price).toBe(0.5);
        emit({
            msg_type: 'buy',
            req_id: firstBuy.req_id,
            buy: {
                contract_id: 24681,
                buy_price: '0.50',
                payout: '0.95',
                longcode: 'Even contract',
            },
        });

        const settlement = latest(payload => payload.proposal_open_contract === 1);
        emit({
            msg_type: 'proposal_open_contract',
            req_id: settlement.req_id,
            subscription: { id: 'matrix-contract-1' },
            proposal_open_contract: {
                contract_id: 24681,
                status: 'lost',
                profit: '-0.50',
                bid_price: '0',
                entry_tick_display_value: '123.45',
                exit_tick_display_value: '123.46',
            },
        });

        emit({
            msg_type: 'tick',
            subscription: { id: 'matrix-ticks' },
            tick: { quote: 1.99, pip_size: 2 },
        });

        const secondProposalRequest = latest(
            payload => payload.proposal === 1 && payload.req_id !== firstProposalRequest.req_id,
        );
        emit({
            msg_type: 'proposal',
            req_id: secondProposalRequest.req_id,
            subscription: { id: 'matrix-proposal-2' },
            proposal: {
                id: 'matrix-even-proposal-2',
                ask_price: '1.00',
                payout: '1.90',
                spot: '1.99',
                longcode: 'Even contract',
            },
        });

        const secondBuy = latest(payload => payload.buy === 'matrix-even-proposal-2');
        expect(secondBuy.price).toBe(1);

        engine.stop();
        mockApiBase.api = null;
    });

    it('blocks a second Binary Matrix runner from starting', () => {
        const api = {
            send: jest.fn(),
            forgetAll: jest.fn(() => Promise.resolve()),
            onMessage: () => ({
                subscribe: () => ({ unsubscribe: jest.fn() }),
            }),
        };
        mockApiBase.api = api;

        const config = {
            symbol: 'R_25',
            currency: 'USD',
            initialStake: 0.5,
            martingale: 2,
            takeProfit: 10,
            stopLoss: 50,
            reanalyzeAfterWins: 3,
        };
        const first = new BinaryMatrixEngine(config);
        const second = new BinaryMatrixEngine(config);

        expect(first.start()).toBe(true);
        expect(second.start()).toBe(false);

        second.stop();
        first.stop();
        mockApiBase.api = null;
    });
});