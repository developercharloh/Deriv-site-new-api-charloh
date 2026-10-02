import {
    AUTO_MOMENTUM_CONFIDENCE,
    AUTO_MOMENTUM_LONG_WINDOW,
    AUTO_MOMENTUM_SHORT_WINDOW,
    AUTO_SIGNAL_CONFIDENCE_WINDOW,
    evaluateMomentumMarket,
    isMomentumDirectionConfirmed,
    isNexusDigitDecisionQualified,
    selectBestAvailableDigitFallback,
    selectAdaptiveDigitMarketPlan,
    selectAutoFallbackMarket,
    selectBestQualifiedMomentumMarket,
    selectNextNexusDecision,
    selectNexusAutomaticCandidates,
    selectQualifiedMomentumMarkets,
    selectStrongestMomentumMarket,
    strategyContractDisplayLabel,
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

    it('ranks every qualified market while excluding closed and below-gate markets', () => {
        const results = selectQualifiedMomentumMarkets([
            source('QUALIFIED_ONE', pricesFromMoves([
                ...Array(24).fill(-1),
                ...Array(22).fill(1),
                ...Array(14).fill(1),
            ])),
            source('QUALIFIED_TWO', pricesFromMoves([
                ...Array(20).fill(-1),
                ...Array(26).fill(1),
                ...Array(14).fill(1),
            ])),
            source('BELOW_GATE', pricesFromMoves([
                ...Array(28).fill(-1),
                ...Array(18).fill(1),
                ...Array(14).fill(1),
            ])),
            { ...source('CLOSED', pricesFromMoves(Array(60).fill(1))), tradable: false },
        ]);

        expect(results.map(result => result.symbol)).toEqual(['QUALIFIED_TWO', 'QUALIFIED_ONE']);
        expect(results.every(result => result.contractType === 'CALL')).toBe(true);
    });

    it('pairs the strongest threshold market with its requested recovery barrier', () => {
        const result = selectAdaptiveDigitMarketPlan({
            ...source('OVER_BIAS', [100, 101, 102, 103, 104, 105]),
            lastDigits: [8, 9, 7, 6, 8, 9],
        }, 6);

        expect(result?.primaryMarket).toBe('over-2');
        expect(result?.primary.contractType).toBe('DIGITOVER');
        expect(result?.primary.barrier).toBe('2');
        expect(result?.recoveryMarket).toBe('over-4');
        expect(result?.recovery.barrier).toBe('4');
    });

    it('pairs a low-digit market with Under 5 recovery', () => {
        const result = selectAdaptiveDigitMarketPlan({
            ...source('UNDER_BIAS', [100, 99, 98, 97, 96, 95]),
            lastDigits: [0, 1, 2, 3, 4, 6],
        }, 6);

        expect(result?.primaryMarket).toBe('under-7');
        expect(result?.recoveryMarket).toBe('under-5');
        expect(result?.primary.barrier).toBe('7');
        expect(result?.recovery.barrier).toBe('5');
    });

    it('pairs an Even primary with Odd recovery', () => {
        const result = selectAdaptiveDigitMarketPlan({
            ...source('EVEN_BIAS', [100, 101, 102, 103, 104, 105]),
            lastDigits: [0, 2, 4, 6, 8, 2],
        }, 6);

        expect(result?.primaryMarket).toBe('even');
        expect(result?.primary.contractType).toBe('DIGITEVEN');
        expect(result?.recoveryMarket).toBe('odd');
        expect(result?.recovery.contractType).toBe('DIGITODD');
    });

    it('skips a broker-rejected route and selects the strongest available fallback', () => {
        const result = selectBestAvailableDigitFallback(
            {
                ...source('FALLBACK', [100, 99, 98, 97, 96, 95]),
                lastDigits: [0, 1, 2, 3, 4, 6],
            },
            'under-7',
            6,
            new Set(['under-7', 'under-5']),
        );

        expect(result?.purchaseMarket).toBe('even');
        expect(result?.contractType).toBe('DIGITEVEN');
        expect(result?.reason).toMatch(/fallback/i);
    });

    it('provides an actionable adaptive digit route when momentum has no qualified market', () => {
        const fallback = selectAutoFallbackMarket({
            ...source('NO_MOMENTUM', [100, 99, 100, 99, 100, 99]),
            lastDigits: [8, 9, 7, 6, 8, 9],
        }, 6);

        expect(selectBestQualifiedMomentumMarket([
            source('NO_MOMENTUM', [100, 99, 100, 99, 100, 99]),
        ])).toBeNull();
        expect(fallback?.symbol).toBe('NO_MOMENTUM');
        expect(fallback?.contractType).toBe('DIGITOVER');
        expect(fallback?.reason).toMatch(/No strict momentum market/);
    });
});

describe('Nexus automatic candidate selection', () => {
    it('ranks Rise/Fall, parity, and Over/Under candidates from open markets', () => {
        const riseAndEven = {
            ...source('RISE_EVEN', Array.from({ length: 61 }, (_, index) => index + 1)),
            lastDigits: Array.from({ length: 60 }, (_, index) => (index % 5) * 2),
            tradable: true,
        };
        const overCandidate = {
            ...source('OVER', Array.from({ length: 60 }, () => 100)),
            lastDigits: Array.from({ length: 60 }, (_, index) => [5, 6, 7, 8, 9, 5][index % 6]),
            tradable: true,
        };
        const closed = { ...overCandidate, symbol: 'CLOSED', tradable: false };

        const candidates = selectNexusAutomaticCandidates([riseAndEven, overCandidate, closed]);

        expect(candidates.some(candidate => candidate.symbol === 'RISE_EVEN' && candidate.contractType === 'CALL')).toBe(true);
        expect(candidates.some(candidate => candidate.symbol === 'RISE_EVEN' && candidate.contractType === 'DIGITEVEN')).toBe(true);
        expect(candidates.some(candidate => candidate.symbol === 'OVER' && candidate.contractType === 'DIGITOVER')).toBe(true);
        expect(candidates.every(candidate => candidate.symbol !== 'CLOSED')).toBe(true);
    });

    it('requires enough recent digits, an observed edge, and a lower bound above baseline', () => {
        const qualified = {
            ...source('QUALIFIED', Array(60).fill(100)),
            lastDigits: [...Array(40).fill(2), ...Array(20).fill(1)],
            tradable: true,
        };
        const belowEdge = {
            ...source('BELOW_EDGE', Array(60).fill(100)),
            lastDigits: [...Array(35).fill(2), ...Array(25).fill(1)],
            tradable: true,
        };
        const shortHistory = {
            ...source('SHORT', Array(59).fill(100)),
            lastDigits: Array(59).fill(2),
            tradable: true,
        };

        const candidates = selectNexusAutomaticCandidates([qualified, belowEdge, shortHistory]);
        const evenCandidate = candidates.find(candidate =>
            candidate.symbol === 'QUALIFIED' && candidate.contractType === 'DIGITEVEN',
        );

        expect(evenCandidate).toBeDefined();
        expect(isNexusDigitDecisionQualified(evenCandidate!, qualified)).toBe(true);
        expect(candidates.some(candidate =>
            candidate.symbol === 'BELOW_EDGE' && candidate.contractType === 'DIGITEVEN',
        )).toBe(false);
        expect(candidates.some(candidate => candidate.symbol === 'SHORT')).toBe(false);
    });

    it('blocks high-risk Over/Under edge barriers even with perfect recent evidence', () => {
        const blockedRoutes = [
            { market: 'under-1', contractType: 'DIGITUNDER', barrier: '1', digit: 0 },
            { market: 'under-2', contractType: 'DIGITUNDER', barrier: '2', digit: 0 },
            { market: 'under-3', contractType: 'DIGITUNDER', barrier: '3', digit: 0 },
            { market: 'over-7', contractType: 'DIGITOVER', barrier: '7', digit: 9 },
            { market: 'over-8', contractType: 'DIGITOVER', barrier: '8', digit: 9 },
        ] as const;

        for (const route of blockedRoutes) {
            const marketSource = {
                ...source(route.market.toUpperCase(), Array(60).fill(100)),
                lastDigits: Array(60).fill(route.digit),
                tradable: true,
            };
            const decision = {
                symbol: marketSource.symbol,
                displayName: marketSource.displayName,
                condition: route.market,
                label: route.market,
                contractType: route.contractType,
                barrier: route.barrier,
                purchaseMarket: route.market,
                digits: [...marketSource.lastDigits],
                strength: 100,
                reason: 'Perfect historical match.',
            };

            expect(isNexusDigitDecisionQualified(decision, marketSource)).toBe(false);
            expect(selectNexusAutomaticCandidates([marketSource]).some(candidate =>
                candidate.purchaseMarket === route.market,
            )).toBe(false);
        }
    });

    it('keeps nearby safer Over/Under barriers eligible when their evidence passes', () => {
        const underSource = {
            ...source('UNDER_4', Array(60).fill(100)),
            lastDigits: Array(60).fill(0),
            tradable: true,
        };
        const overSource = {
            ...source('OVER_6', Array(60).fill(100)),
            lastDigits: Array(60).fill(9),
            tradable: true,
        };

        const candidates = selectNexusAutomaticCandidates([underSource, overSource]);

        expect(candidates.some(candidate =>
            candidate.symbol === 'UNDER_4' && candidate.purchaseMarket === 'under-4',
        )).toBe(true);
        expect(candidates.some(candidate =>
            candidate.symbol === 'OVER_6' && candidate.purchaseMarket === 'over-6',
        )).toBe(true);
    });

    it('prioritizes qualified Rise/Fall before a higher-scoring digit candidate', () => {
        const moves = [...Array(26).fill(-1), ...Array(34).fill(1)];
        let price = 100;
        const prices = [price];
        for (const move of moves) {
            price += move;
            prices.push(price);
        }
        const bothFamilies = {
            ...source('BOTH_FAMILIES', prices),
            lastDigits: Array(60).fill(9),
            tradable: true,
        };

        const candidates = selectNexusAutomaticCandidates([bothFamilies]);
        const riseFall = candidates.find(candidate =>
            candidate.contractType === 'CALL' || candidate.contractType === 'PUT',
        );
        const highScoringDigit = candidates.find(candidate => candidate.contractType === 'DIGITOVER');

        expect(riseFall).toBeDefined();
        expect(highScoringDigit).toBeDefined();
        expect(highScoringDigit!.strength).toBeGreaterThan(riseFall!.strength);
        expect(candidates[0].contractType).toBe(riseFall!.contractType);
        expect(selectNextNexusDecision(candidates)?.contractType).toBe(riseFall!.contractType);
    });

    it('rotates to a qualified Rise/Fall candidate when the previous route was digits', () => {
        const sourceWithBothFamilies = {
            ...source('BOTH', Array.from({ length: 61 }, (_, index) => index + 1)),
            lastDigits: Array.from({ length: 60 }, (_, index) => (index % 5) * 2),
            tradable: true,
        };
        const candidates = selectNexusAutomaticCandidates([sourceWithBothFamilies]);
        const previousDigit = candidates.find(candidate => candidate.contractType === 'DIGITEVEN');
        expect(previousDigit).toBeDefined();

        const next = selectNextNexusDecision(candidates, {
            lastDecisionKey: `${previousDigit!.symbol}|${previousDigit!.contractType}|${previousDigit!.barrier || ''}`,
            lastFamily: 'digits',
            lastSymbol: previousDigit!.symbol,
        });

        expect(next?.contractType).toBe('CALL');
    });

    it('shows the direction represented by broker CALL and PUT codes', () => {
        expect(strategyContractDisplayLabel('CALL')).toBe('Rise (CALL)');
        expect(strategyContractDisplayLabel('PUT')).toBe('Fall (PUT)');
    });
});