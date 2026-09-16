import {
    AUTO_MOMENTUM_CONFIDENCE,
    AUTO_MOMENTUM_LONG_WINDOW,
    AUTO_MOMENTUM_SHORT_WINDOW,
    AUTO_SIGNAL_CONFIDENCE_WINDOW,
    evaluateMomentumMarket,
    isMomentumDirectionConfirmed,
    selectBestQualifiedMomentumMarket,
    selectStrongestMomentumMarket,
    type StrategySource,
} from '../alpha-market-strategy';

const source = (symbol: string, prices: number[]): StrategySource => ({
    symbol,
    displayName: symbol,
    prices,
    lastDigits: [],
});

const pricesFromMoves = (moves: number[]): number[] => moves.reduce(
    (prices, move) => [...prices, prices[prices.length - 1] + move],
    [100],
);

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

    it('requires at least 55% confidence across the last 60 tick transitions', () => {
        const exactThreshold = evaluateMomentumMarket(
            source('EXACT', pricesFromMoves([
                ...Array(27).fill(-1),
                ...Array(19).fill(1),
                ...Array(14).fill(1),
            ])),
        );
        const belowThreshold = evaluateMomentumMarket(
            source('BELOW', pricesFromMoves([
                ...Array(28).fill(-1),
                ...Array(18).fill(1),
                ...Array(14).fill(1),
            ])),
        );

        expect(exactThreshold.confidenceWindow).toBe(AUTO_SIGNAL_CONFIDENCE_WINDOW);
        expect(exactThreshold.signal).toBe('CALL');
        expect(exactThreshold.confidence).toBeCloseTo(55, 10);
        expect(exactThreshold.qualified).toBe(true);
        expect(belowThreshold.signal).toBe('CALL');
        expect(belowThreshold.confidence).toBeCloseTo(53.333, 2);
        expect(belowThreshold.confidencePassed).toBe(false);
        expect(belowThreshold.qualified).toBe(false);
    });

    it('selects the best market only after every scan condition passes', () => {
        const result = selectBestQualifiedMomentumMarket([
            source('BELOW_GATE', pricesFromMoves([
                ...Array(28).fill(-1),
                ...Array(18).fill(1),
                ...Array(14).fill(1),
            ])),
            source('QUALIFIED', pricesFromMoves([
                ...Array(24).fill(-1),
                ...Array(22).fill(1),
                ...Array(14).fill(1),
            ])),
            { ...source('CLOSED', pricesFromMoves(Array(60).fill(1))), tradable: false },
        ]);

        expect(result?.symbol).toBe('QUALIFIED');
        expect(result?.contractType).toBe('CALL');
        expect(result?.reason).toContain('60 ticks');
    });
});