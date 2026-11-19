type MessageHandler = (message: unknown) => void;
type SentPayload = Record<string, any>;

class AutoScanSocket {
    static instance: AutoScanSocket | null = null;
    readyState = 1;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    sent: SentPayload[] = [];

    constructor(_url: string) {
        AutoScanSocket.instance = this;
    }

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }

    close(): void {
        this.readyState = 3;
    }

    open(): void {
        this.onopen?.({} as Event);
    }

    respond(message: SentPayload): void {
        this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
    }
}

const nativeWebSocket = global.WebSocket;

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: null, is_authorized: true },
}));

import { BinaryMatrixEngine } from '@/utils/binary-matrix-engine';
import { DERIV_VOLATILITIES } from '@/utils/deriv-volatilities';
import { api_base as mockApiBase } from '@/external/bot-skeleton/services/api/api-base';
import { observer } from '@/external/bot-skeleton/utils/observer';

describe('BinaryMatrixEngine live purchase path', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mockApiBase.is_authorized = true;
    });

    afterEach(() => {
        jest.useRealTimers();
        global.WebSocket = nativeWebSocket;
        AutoScanSocket.instance = null;
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
        const statuses: string[] = [];
        const positions: Array<{ isOpen: boolean; contractId: string }> = [];
        engine.onLog = log => logs.push(log.message);
        engine.onStatus = status => statuses.push(status);
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

        engine.stop();
        expect(statuses[statuses.length - 1]).toBe('waiting');
        expect(logs.some(message => message.includes('Stop requested.'))).toBe(true);

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
        expect(statuses[statuses.length - 1]).toBe('stopped');
        expect(logs.some(message => message.includes('stopped. No new contracts'))).toBe(true);

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
        emit({
            msg_type: 'buy',
            req_id: secondBuy.req_id,
            error: { message: 'Purchase cancelled.' },
        });
        mockApiBase.api = null;
    });

    it('requires historical evidence, a passing live payout, and a fresh signal before buying', async () => {
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
        mockApiBase.api = api as any;
        (global as any).WebSocket = AutoScanSocket;

        const engine = new BinaryMatrixEngine({
            symbol: 'R_25',
            currency: 'USD',
            initialStake: 0.5,
            martingale: 2,
            takeProfit: 10,
            stopLoss: 50,
            reanalyzeAfterWins: 3,
            autoMarketScan: true,
        });
        const scanUpdates: any[] = [];
        engine.onMarketScan = snapshot => scanUpdates.push(snapshot);
        expect(engine.start()).toBe(true);

        const publicSocket = AutoScanSocket.instance;
        if (!publicSocket) throw new Error('Expected the public market scan socket.');
        publicSocket.open();
        const publicHistoryRequest = publicSocket.sent[0];
        const selectedSymbol = DERIV_VOLATILITIES[0].code;
        const historyDigits: number[] = [];
        for (let index = 0; index < 120; index += 1) historyDigits.push(1, 1, 1, 1, 0);
        historyDigits.push(1, 1, 1, 1);
        publicSocket.respond({
            msg_type: 'history',
            req_id: publicHistoryRequest.req_id,
            pip_size: 2,
            history: {
                prices: historyDigits.map((digit, index) => `${index + 1}.${digit}${digit}`),
            },
            subscription: { id: 'public-selected-market' },
        });

        await Promise.resolve();
        await Promise.resolve();
        jest.advanceTimersByTime(300);

        const emit = (message: SentPayload) => {
            if (!handler) throw new Error('The authenticated engine message subscription is not active.');
            handler({ data: message });
        };
        const latest = (predicate: (payload: SentPayload) => boolean) => {
            const payload = [...sent].reverse().find(predicate);
            if (!payload) throw new Error('Expected a matching authenticated engine request.');
            return payload;
        };

        const liveHistoryRequest = latest(payload => payload.ticks_history === selectedSymbol);
        emit({
            msg_type: 'history',
            req_id: liveHistoryRequest.req_id,
            subscription: { id: 'adaptive-live-ticks' },
            history: { prices: [] },
            pip_size: 2,
        });
        const proposalRequest = latest(payload => payload.proposal === 1);
        expect(proposalRequest).toMatchObject({
            contract_type: 'DIGITEVEN',
            underlying_symbol: selectedSymbol,
        });
        expect(sent.some(payload => payload.buy)).toBe(false);
        emit({
            msg_type: 'tick',
            subscription: { id: 'adaptive-live-ticks' },
            tick: { quote: 1.12, pip_size: 2 },
        });
        expect(sent.some(payload => payload.buy)).toBe(false);
        expect(scanUpdates.some(snapshot => snapshot.selectedSymbol === selectedSymbol)).toBe(true);
        emit({
            msg_type: 'proposal',
            req_id: proposalRequest.req_id,
            subscription: { id: 'adaptive-live-proposal' },
            proposal: {
                id: 'adaptive-even-proposal',
                ask_price: '0.50',
                payout: '0.90',
                spot: '1.11',
                longcode: 'One-tick Even contract',
            },
        });
        expect(sent.some(payload => payload.buy)).toBe(false);

        [1.13, 1.15, 1.17, 1.19].forEach(quote => emit({
            msg_type: 'tick',
            subscription: { id: 'adaptive-live-ticks' },
            tick: { quote, pip_size: 2 },
        }));
        const buy = latest(payload => payload.buy === 'adaptive-even-proposal');
        expect(buy).toMatchObject({ price: 0.5, buy: 'adaptive-even-proposal' });
        expect(scanUpdates.some(snapshot =>
            snapshot.selectedSymbol === selectedSymbol &&
            snapshot.rows.some((row: any) => row.symbol === selectedSymbol && row.status === 'qualified')
        )).toBe(true);

        engine.stop();
        emit({ msg_type: 'buy', req_id: buy.req_id, error: { message: 'Purchase cancelled.' } });
        expect(scanUpdates[scanUpdates.length - 1].status).toBe('idle');
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