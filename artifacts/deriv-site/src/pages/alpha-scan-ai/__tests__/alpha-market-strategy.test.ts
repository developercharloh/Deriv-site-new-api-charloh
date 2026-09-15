import {
    AUTO_MOMENTUM_CONFIDENCE,
    AUTO_MOMENTUM_LONG_WINDOW,
    AUTO_MOMENTUM_SHORT_WINDOW,
    isMomentumDirectionConfirmed,
    selectStrongestMomentumMarket,
    type StrategySource,
} from '../alpha-market-strategy';

const source = (symbol: string, prices: number[]): StrategySource => ({
    symbol,
    displayName: symbol,
    prices,
    lastDigits: [],
});

describe('auto volatility momentum selection', () => {
    it('selects the strongest aligned CALL candidate', () => {
        const result = selectStrongestMomentumMarket(
            [
                source('WEAK', [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1]),
                source('CALL_SYMBOL', Array.from({ length: 30 }, (_, index) => index + 1)),
            ],
            AUTO_MOMENTUM_SHORT_WINDOW,
            AUTO_MOMENTUM_LONG_WINDOW,
            AUTO_MOMENTUM_CONFIDENCE,
        );

        expect(result?.symbol).toBe('CALL_SYMBOL');
        expect(result?.contractType).toBe('CALL');
        expect(result?.label).toContain('CALL');
    });

    it('does not select a flat or conflicting market', () => {
        const result = selectStrongestMomentumMarket([
            source('FLAT', Array.from({ length: 30 }, () => 100)),
            source('CONFLICT', [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1]),
        ]);

        expect(result).toBeNull();
    });

    it('rejects a fresh confirmation after the live direction reverses', () => {
        const freshDecision = selectStrongestMomentumMarket([
            source('REVERSED', Array.from({ length: 30 }, (_, index) => 30 - index)),
        ]);

        expect(freshDecision?.contractType).toBe('PUT');
        expect(isMomentumDirectionConfirmed('CALL', freshDecision)).toBe(false);
    });
});