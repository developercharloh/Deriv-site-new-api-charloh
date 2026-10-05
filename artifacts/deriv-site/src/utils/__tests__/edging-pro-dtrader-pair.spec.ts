type SentPayload = Record<string, any>;
type MessageHandler = (message: unknown) => void;

jest.mock('@/external/bot-skeleton/services/api/api-base', () => ({
    api_base: { api: null, is_authorized: true },
}));

import {
    DTraderEngine,
    type DTDigitPairLegConfig,
    type DTConfig,
} from '@/utils/dtrader-engine';
import { api_base as mockApiBase } from '@/external/bot-skeleton/services/api/api-base';

const makeHarness = () => {
    const sent: SentPayload[] = [];
    let handler: MessageHandler | null = null;
    const api = {
        send: jest.fn((payload: SentPayload) => sent.push(payload)),
        balance: jest.fn().mockResolvedValue({ balance: { balance: 100, currency: 'USD' } }),
        onMessage: () => ({
            subscribe: (next: MessageHandler) => {
                handler = next;
                return { unsubscribe: () => { if (handler === next) handler = null; } };
            },
        }),
    };
    mockApiBase.api = api as any;
    mockApiBase.is_authorized = true;
    const engine = new DTraderEngine();
    const positions: Array<Record<string, any>> = [];
    engine.onPosition = position => positions.push(position);
    const base: DTConfig = {
        symbol: '1HZ50V',
        contractType: 'DIGITOVER',
        barrier: '5',
        durationValue: 1,
        durationUnit: 't',
        stake: 0.5,
        currency: 'USD',
    };
    engine.start(base);

    const emit = (message: Record<string, any>) => {
        if (!handler) throw new Error('The message subscription is not active.');
        handler({ data: message });
    };

    return { api, engine, sent, positions, emit };
};

const pairConfigs: DTDigitPairLegConfig[] = [
    {
        side: 'over',
        config: { contractType: 'DIGITOVER', barrier: '5', durationValue: 1, durationUnit: 't', stake: 0.5 },
    },
    {
        side: 'under',
        config: { contractType: 'DIGITUNDER', barrier: '4', durationValue: 1, durationUnit: 't', stake: 0.5 },
    },
];

describe('DTraderEngine paired digit orders', () => {
    afterEach(() => {
        mockApiBase.api = null;
    });

    it('prices both legs and submits both buys before awaiting either acknowledgement', async () => {
        const { engine, sent, positions, emit } = makeHarness();
        const resultPromise = engine.buyDigitPairNow(pairConfigs);
        const proposals = sent.filter(payload => payload.proposal === 1);
        expect(proposals).toHaveLength(2);

        const proposalMessage = (index: number) => ({
            req_id: proposals[index].req_id,
            msg_type: 'proposal',
            proposal: {
                id: `proposal-${index}`,
                ask_price: '0.50',
                payout: '0.90',
            },
        });
        emit(proposalMessage(0));
        const operationId = (engine as any).digitPairOperationCounter;
        (engine as any).handleDigitPairResponse(
            { ...proposalMessage(0), proposal: { id: 'duplicate-proposal', ask_price: '0.50', payout: '0.90' } },
            { operationId, side: 'over', stage: 'proposal' },
        );
        emit(proposalMessage(1));

        const buys = sent.filter(payload => payload.buy);
        expect(buys).toHaveLength(2);
        expect(buys.map(payload => payload.buy)).toEqual(['proposal-0', 'proposal-1']);

        buys.forEach((request, index) => emit({
            req_id: request.req_id,
            msg_type: 'buy',
            buy: {
                contract_id: 100 + index,
                buy_price: '0.50',
                payout: '0.90',
                longcode: `digit contract ${index}`,
            },
        }));

        const result = await resultPromise;
        expect(result.accepted.map(item => item.side)).toEqual(['over', 'under']);
        expect(result.accepted.map(item => item.contractId)).toEqual(['100', '101']);
        expect(positions.map(position => position.contractType)).toEqual(['DIGITOVER', 'DIGITUNDER']);
        engine.stop();
    });

    it('does not submit either buy when the entry condition expires during proposal pricing', async () => {
        const { engine, sent, emit } = makeHarness();
        const resultPromise = engine.buyDigitPairNow(pairConfigs, () => 'The Last X condition expired.');
        const proposals = sent.filter(payload => payload.proposal === 1);
        proposals.forEach((request, index) => emit({
            req_id: request.req_id,
            msg_type: 'proposal',
            proposal: { id: `proposal-${index}`, ask_price: '0.50', payout: '0.90' },
        }));

        const result = await resultPromise;
        expect(sent.filter(payload => payload.buy)).toHaveLength(0);
        expect(result.accepted).toHaveLength(0);
        expect(result.failed).toHaveLength(2);
        engine.stop();
    });
});