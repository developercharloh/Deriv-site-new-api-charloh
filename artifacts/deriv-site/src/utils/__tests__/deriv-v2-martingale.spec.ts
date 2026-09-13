import { isWinningSettlement, nextMartingaleStake } from '@/utils/deriv-v2-engine';

describe('Deriv V2 settlement Martingale', () => {
    it('resets to the original stake after any winning settlement', () => {
        expect(isWinningSettlement('won', 3.38)).toBe(true);
        expect(nextMartingaleStake({
            initialStake: 0.5,
            currentStake: 4,
            multiplier: 3,
            isWin: true,
        })).toBe(0.5);
    });

    it('multiplies only after a losing settlement', () => {
        expect(isWinningSettlement('lost', -1)).toBe(false);
        expect(nextMartingaleStake({
            initialStake: 0.5,
            currentStake: 0.5,
            multiplier: 3,
            isWin: false,
        })).toBe(1.5);
        expect(nextMartingaleStake({
            initialStake: 0.5,
            currentStake: 1.5,
            multiplier: 3,
            isWin: false,
        })).toBe(4.5);
    });

    it('treats positive settled profit as a win even if status is delayed', () => {
        expect(isWinningSettlement('sold', 0.42)).toBe(true);
        expect(nextMartingaleStake({
            initialStake: 0.5,
            currentStake: 1,
            multiplier: 2,
            isWin: isWinningSettlement('sold', 0.42),
        })).toBe(0.5);
    });
});