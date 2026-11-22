import {
    matchesEvenOddEntryPattern,
    matchesOverUnderEntryPattern,
    matchesRiseFallEntryPattern,
    OVER_UNDER_ENTRY_PATTERN,
} from '../analysis-entry-patterns';

describe('AI Analysis entry patterns', () => {
    it('recognizes the configured Rise/Fall sequence in chronological order', () => {
        const prices = [10];
        for (const direction of 'RRRFFRFFF') {
            const previous = prices[prices.length - 1];
            prices.push(previous + (direction === 'R' ? 1 : -1));
        }

        expect(matchesRiseFallEntryPattern(prices)).toBe(true);
        expect(matchesRiseFallEntryPattern(prices.slice(0, -1))).toBe(false);
    });

    it('recognizes the configured Even/Odd sequence using the market precision', () => {
        const prices = ['100.00', '100.02', '100.04', '100.01', '100.06', '100.08',
            '100.10', '100.12', '100.03', '100.05', '100.07'].map(Number);

        expect(matchesEvenOddEntryPattern(prices, 2)).toBe(true);
        expect(matchesEvenOddEntryPattern(prices, 3)).toBe(false);
    });

    it('does not report an entry before enough ticks are available', () => {
        expect(matchesRiseFallEntryPattern([1, 2, 3])).toBe(false);
        expect(matchesEvenOddEntryPattern([1, 2, 3], 2)).toBe(false);
        expect(matchesOverUnderEntryPattern([1, 2, 3], 2, 4)).toBe(false);
    });

    it('classifies last digits against the selected barrier and matches the Ov/U pattern', () => {
        const prices = [5, 6, 7, 3, 2, 8, 1, 0, 3].map(digit => 100 + digit / 100);

        expect(OVER_UNDER_ENTRY_PATTERN).toBe('Ov Ov Ov U U Ov U U U');
        expect(matchesOverUnderEntryPattern(prices, 2, 4)).toBe(true);
        expect(matchesOverUnderEntryPattern(prices, 2, 5)).toBe(false);
    });

    it('treats a digit equal to the barrier as neither Over nor Under', () => {
        const prices = [5, 6, 7, 3, 2, 8, 1, 0, 4].map(digit => 100 + digit / 100);

        expect(matchesOverUnderEntryPattern(prices, 2, 4)).toBe(false);
    });

    it('does not count a flat price comparison as a Fall', () => {
        const prices = [10];
        for (const direction of 'RRRFFRFFF') {
            const previous = prices[prices.length - 1];
            prices.push(previous + (direction === 'R' ? 1 : -1));
        }
        prices[prices.length - 1] = prices[prices.length - 2];

        expect(matchesRiseFallEntryPattern(prices)).toBe(false);
    });
});
