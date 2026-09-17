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
});