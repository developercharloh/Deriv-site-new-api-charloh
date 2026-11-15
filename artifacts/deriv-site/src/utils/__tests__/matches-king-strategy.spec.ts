import {
    getMatchesKingVirtualDigitOutcomes,
    getMatchesKingBatchCost,
    matchesKingVirtualBatchWon,
    parseMatchesKingDigits,
    settleMatchesKingBatch,
} from '../matches-king-strategy';

describe('Matches King batch rules', () => {
    it('parses selected digits and rejects invalid or repeated values', () => {
        expect(parseMatchesKingDigits('4, 5, 9, 7')).toEqual([4, 5, 9, 7]);
        expect(() => parseMatchesKingDigits('1,10')).toThrow('digits from 0 to 9');
        expect(() => parseMatchesKingDigits('4,4')).toThrow('each digit only once');
    });

    it('applies one configured stake to each selected digit', () => {
        expect(getMatchesKingBatchCost(30, 3)).toBe(90);
    });

    it('resets the per-digit stake when any contract wins, even if combined P/L is negative', () => {
        expect(settleMatchesKingBatch([-30, 5, -30], 60, 30, 2)).toEqual({
            combinedProfit: -55,
            nextStakePerDigit: 30,
            result: 'win',
        });
    });

    it('multiplies per-digit stake only after an all-loss batch', () => {
        expect(settleMatchesKingBatch([-30, -30, -30], 60, 30, 2)).toEqual({
            combinedProfit: -90,
            nextStakePerDigit: 120,
            result: 'loss',
        });
    });

    it('keeps stake unchanged for a batch without a win or an all-loss result', () => {
        expect(settleMatchesKingBatch([0, -2], 30, 30, 2)).toMatchObject({
            combinedProfit: -2,
            nextStakePerDigit: 30,
            result: 'break-even',
        });
    });

    it('treats the virtual batch as a win if any selected digit matches', () => {
        expect(matchesKingVirtualBatchWon(3, [1, 3, 8])).toBe(true);
        expect(matchesKingVirtualBatchWon(4, [1, 3, 8])).toBe(false);
    });

    it('marks only the matching digit as a virtual win', () => {
        expect(getMatchesKingVirtualDigitOutcomes(7, [4, 5, 9, 7])).toEqual([
            { prediction: 4, outcome: 'loss' },
            { prediction: 5, outcome: 'loss' },
            { prediction: 9, outcome: 'loss' },
            { prediction: 7, outcome: 'win' },
        ]);
    });
});
