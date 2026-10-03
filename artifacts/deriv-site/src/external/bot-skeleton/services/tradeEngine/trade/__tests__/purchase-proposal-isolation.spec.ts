import Purchase from '../Purchase';
import Proposal from '../Proposal';

class TestEngine extends Proposal(Purchase(class {})) {}

describe('trade engine purchase state isolation', () => {
    it('keeps purchase references independent between engines', () => {
        const first = new TestEngine();
        const second = new TestEngine();

        first.regeneratePurchaseReference();
        const firstReference = first.getPurchaseReference();
        second.regeneratePurchaseReference();
        const secondReference = second.getPurchaseReference();

        expect(firstReference).toBeTruthy();
        expect(secondReference).toBeTruthy();
        expect(firstReference).not.toBe(secondReference);
        expect(first.getPurchaseReference()).toBe(firstReference);
    });

    it('keeps retry delay indexes independent between engines', () => {
        const first = new TestEngine();
        const second = new TestEngine();

        expect(first.getNextPurchaseDelayIndex()).toBe(0);
        expect(first.getNextPurchaseDelayIndex()).toBe(1);
        expect(second.getNextPurchaseDelayIndex()).toBe(0);
        expect(first.getNextPurchaseDelayIndex()).toBe(2);
    });

    it('treats a symbol change as a new proposal option set', () => {
        const engine = new TestEngine();
        const baseOptions = {
            amount: 1,
            basis: 'stake',
            duration: 1,
            duration_unit: 't',
            prediction: undefined,
            secondBarrierOffset: undefined,
            symbol: '1HZ100V',
        };

        expect(engine.isNewTradeOption(baseOptions)).toBe(true);
        expect(engine.isNewTradeOption({ ...baseOptions })).toBe(false);
        expect(engine.isNewTradeOption({ ...baseOptions, symbol: '1HZ volatility 10 (1s)' })).toBe(true);
    });

    it('refreshes proposals when a recovery purchase changes the digit prediction', async () => {
        const engine: any = new TestEngine();
        const baseOptions = {
            amount: 0.5,
            basis: 'stake',
            contractTypes: ['DIGITOVER', 'DIGITUNDER'],
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
            prediction: 2,
            secondBarrierOffset: undefined,
            symbol: '1HZ50V',
        };
        engine.options = baseOptions;
        engine.trade_option = { ...baseOptions };
        engine.renewProposalsOnPurchase = jest.fn();
        engine.waitForProposalsReady = jest.fn().mockResolvedValue(true);

        await expect(engine.prepareProposalsForPurchase({ ...baseOptions, prediction: 4 })).resolves.toBe(true);

        const overProposal = engine.proposal_templates.find((proposal: any) => proposal.contract_type === 'DIGITOVER');
        expect(overProposal).toEqual(
            expect.objectContaining({
                barrier: 4,
                selected_tick: 4,
                passthrough: expect.objectContaining({
                    contract_type: 'DIGITOVER',
                    prediction: 4,
                }),
            })
        );
        expect(engine.getPurchaseReference()).toBeTruthy();
        expect(engine.renewProposalsOnPurchase).toHaveBeenCalledTimes(1);
    });

    it('selects only a proposal with the requested recovery prediction', () => {
        const engine: any = new TestEngine();
        engine.data = {
            proposals: [
                {
                    id: 'over-2',
                    contract_type: 'DIGITOVER',
                    purchase_reference: 'current',
                    prediction: 2,
                    ask_price: 0.5,
                },
                {
                    id: 'over-4',
                    contract_type: 'DIGITOVER',
                    purchase_reference: 'current',
                    prediction: 4,
                    ask_price: 0.5,
                },
            ],
        };
        engine.purchaseReference = 'current';

        expect(engine.selectProposal('DIGITOVER', 4)).toEqual({ id: 'over-4', askPrice: 0.5 });
        engine.data.proposals = engine.data.proposals.slice(0, 1);
        expect(() => engine.selectProposal('DIGITOVER', 4)).toThrow();
    });
});