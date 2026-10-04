import {
    assessEdgingProEntry,
    calculateEdgingProPairProfit,
} from '../edging-pro-strategy';

describe('Edging pro Engine entry condition', () => {
    it('waits until X consecutive digits are available', () => {
        expect(assessEdgingProEntry([4, 5, 4], 4)).toEqual({
            status: 'WAITING',
            lookback: 4,
            digits: [4, 5, 4],
        });
    });

    it('marks the condition met only when every digit in the lookback is 4 or 5', () => {
        expect(assessEdgingProEntry([1, 4, 5, 4, 5], 4)).toEqual({
            status: 'MET',
            lookback: 4,
            digits: [4, 5, 4, 5],
        });
        expect(assessEdgingProEntry([4, 5, 3, 4], 4).status).toBe('NOT MET');
    });
});

describe('Edging pro Engine virtual pair accounting', () => {
    const over = { askPrice: 0.5, payout: 0.9 };
    const under = { askPrice: 0.5, payout: 0.9 };

    it.each([4, 5])('counts settlement digit %s as a double loss', digit => {
        expect(calculateEdgingProPairProfit(digit, 5, 4, over, under)).toBe(-1);
    });

    it('uses the matching leg payout and the losing leg stake for other digits', () => {
        expect(calculateEdgingProPairProfit(3, 5, 4, over, under)).toBe(-0.1);
        expect(calculateEdgingProPairProfit(6, 5, 4, over, under)).toBe(-0.1);
    });
});