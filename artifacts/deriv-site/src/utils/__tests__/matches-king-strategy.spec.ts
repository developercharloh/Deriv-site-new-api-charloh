import {
    getMatchesKingBatchCost,
    matchesKingVirtualBatchWon,
    parseMatchesKingDigits,
    settleMatchesKingBatch,
} from '../matches-king-strategy';

describe('Matches King batch rules', () => {
    it('parses unique selected digits and rejects invalid values', () => {
        expect(parseMatchesKingDigits('1, 2 3,1')).toEqual([1, 2, 3]);
        expect(() => parseMatchesKingDigits('1,10')).toThrow('digits from 0 to 9');
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
});
