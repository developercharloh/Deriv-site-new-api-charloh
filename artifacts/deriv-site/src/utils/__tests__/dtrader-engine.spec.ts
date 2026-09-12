type MessageHandler = (message: unknown) => void;
type SentPayload = Record<string, any>;

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: null, is_authorized: true },
}));

import { DTraderEngine, type DTConfig } from '@/utils/dtrader-engine';
import { api_base as mockApiBase } from '@/external/bot-skeleton/services/api/api-base';

const makeHarness = (config: DTConfig) => {
    const sent: SentPayload[] = [];
    let handler: MessageHandler | null = null;
    const api = {
        send: jest.fn((payload: SentPayload) => {
            sent.push(payload);
        }),
        onMessage: () => ({
            subscribe: (next: MessageHandler) => {
                handler = next;
                return {
                    unsubscribe: () => {
                        if (handler === next) handler = null;
                    },
                };
            },
        }),
    };
    mockApiBase.api = api;

    const engine = new DTraderEngine();
    const feedback: Array<{ kind: string; message: string }> = [];
    const positions: Array<Record<string, any>> = [];
    engine.onBuyFeedback = value => feedback.push(value);
    engine.onPosition = value => positions.push(value);
    engine.start(config);

    const emit = (message: Record<string, any>) => {
        if (!handler) throw new Error('The engine message subscription is not active.');
        handler({ data: message });
    };

    const latest = (predicate: (payload: SentPayload) => boolean) => {
        const payload = [...sent].reverse().find(predicate);
        if (!payload) throw new Error('Expected a matching engine request.');
        return payload;
    };

    return { engine, sent, feedback, positions, emit, latest };
};

const baseConfig: DTConfig = {
    symbol: 'R_100',
    contractType: 'DIGITEVEN',
    durationValue: 1,
    durationUnit: 't',
    stake: 10,
    barrier: null,
    currency: 'USD',
};

describe('DTraderEngine Alpha Scan execution path', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mockApiBase.is_authorized = true;
        mockApiBase.api = null;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it.each([
        ['Over', 'DIGITOVER', '3'],
        ['Under', 'DIGITUNDER', '6'],
        ['Even', 'DIGITEVEN', null],
        ['Odd', 'DIGITODD', null],
    ])('sends the Deriv contract type for %s', (_label, contractType, barrier) => {
        const config = { ...baseConfig, contractType: contractType as DTConfig['contractType'], barrier };
        const harness = makeHarness(config);

        harness.engine.placeBuyNow(config);
        const proposal = harness.latest(payload => payload.proposal === 1);

        expect(proposal).toMatchObject({
            contract_type: contractType,
            underlying_symbol: 'R_100',
            duration: 1,
            duration_unit: 't',
        });
        if (barrier === null) {
            expect(proposal).not.toHaveProperty('barrier');
        } else {
            expect(proposal.barrier).toBe(barrier);
        }

        harness.engine.stop();
    });

    it('settles a one-tick buy and emits the final stake, payout, and profit', () => {
        const harness = makeHarness(baseConfig);
        const feedback: string[] = [];
        harness.engine.onBuyFeedback = value => feedback.push(`${value.kind}:${value.message}`);

        harness.engine.placeBuyNow(baseConfig);
        const proposal = harness.latest(payload => payload.proposal === 1);
        harness.emit({
            msg_type: 'proposal',
            req_id: proposal.req_id,
            proposal: {
                id: 'proposal-even',
                ask_price: '10.00',
                payout: '19.50',
                spot: '1379.50',
                longcode: 'Even contract',
            },
        });

        const buy = harness.latest(payload => payload.buy === 'proposal-even');
        expect(buy.price).toBe(10);
        harness.emit({
            msg_type: 'buy',
            req_id: buy.req_id,
            buy: {
                contract_id: 987654,
                buy_price: '10.00',
                payout: '19.50',
                longcode: 'Even contract',
            },
        });

        const open = harness.positions.at(-1);
        expect(open).toMatchObject({
            contractId: '987654',
            contractType: 'DIGITEVEN',
            stake: 10,
            payout: 19.5,
            isOpen: true,
        });

        const poc = harness.latest(payload => payload.proposal_open_contract === 1);
        harness.emit({
            msg_type: 'proposal_open_contract',
            req_id: poc.req_id,
            subscription: { id: 'poc-subscription' },
            proposal_open_contract: {
                contract_id: 987654,
                status: 'won',
                is_sold: 1,
                profit: '9.50',
                payout: '19.50',
                entry_tick_display_value: '1379.50',
                exit_tick_display_value: '1379.52',
            },
        });

        expect(harness.positions.at(-1)).toMatchObject({
            contractId: '987654',
            stake: 10,
            payout: 19.5,
            profit: 9.5,
            isOpen: false,
            isWin: true,
            entrySpot: '1379.50',
            exitSpot: '1379.52',
        });
        expect(feedback.some(message => message.startsWith('success:Bought'))).toBe(true);
        harness.engine.stop();
    });

    it('returns proposal rejection to idle feedback without buying', () => {
        const harness = makeHarness(baseConfig);
        harness.engine.placeBuyNow(baseConfig);
        const proposal = harness.latest(payload => payload.proposal === 1);

        harness.emit({
            msg_type: 'proposal',
            req_id: proposal.req_id,
            error: { message: 'Contract unavailable' },
        });

        expect(harness.feedback.at(-1)).toMatchObject({
            kind: 'error',
            message: "Couldn't price your trade: Contract unavailable",
        });
        expect(harness.sent.some(payload => payload.buy)).toBe(false);
        harness.engine.stop();
    });

    it('recovers from an existing tick subscription before scanning', async () => {
        const harness = makeHarness(baseConfig);
        const initialTickRequest = harness.latest(payload => payload.ticks_history === 'R_100');
        const forgetAll = jest.fn(() => Promise.resolve());
        (mockApiBase.api as any).forgetAll = forgetAll;

        harness.emit({
            msg_type: 'history',
            req_id: initialTickRequest.req_id,
            error: { message: 'You are already subscribed to R_100' },
        });

        expect(forgetAll).toHaveBeenCalledWith('ticks');
        expect(harness.sent.some(payload => payload.forget_all === 'ticks')).toBe(false);

        await Promise.resolve();
        await Promise.resolve();
        const retry = harness.sent.filter(payload => payload.ticks_history === 'R_100');
        expect(retry).toHaveLength(2);
        expect(retry.at(-1)).toMatchObject({
            count: 1000,
            end: 'latest',
            subscribe: 1,
        });
        harness.engine.stop();
    });

    it('clears a rejected buy proposal so the next attempt requests a fresh proposal', () => {
        const harness = makeHarness(baseConfig);
        harness.engine.placeBuyNow(baseConfig);
        const proposal = harness.latest(payload => payload.proposal === 1);
        harness.emit({
            msg_type: 'proposal',
            req_id: proposal.req_id,
            proposal: {
                id: 'stale-proposal',
                ask_price: '10',
                payout: '19',
                spot: '1379.50',
            },
        });

        const buy = harness.latest(payload => payload.buy === 'stale-proposal');
        harness.emit({
            msg_type: 'buy',
            req_id: buy.req_id,
            error: { message: 'Proposal has expired' },
        });
        expect(harness.feedback.at(-1)).toMatchObject({ kind: 'error', message: 'Proposal has expired' });

        const countBeforeRetry = harness.sent.filter(payload => payload.proposal === 1).length;
        harness.engine.placeBuyNow(baseConfig);
        expect(harness.sent.filter(payload => payload.proposal === 1).length).toBe(countBeforeRetry + 1);
        expect(harness.sent.at(-1)).toMatchObject({ proposal: 1, contract_type: 'DIGITEVEN' });
        harness.engine.stop();
    });
});