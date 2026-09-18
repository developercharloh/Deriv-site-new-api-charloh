export type StrategyContractType =
    | 'CALL'
    | 'PUT'
    | 'DIGITMATCH'
    | 'DIGITDIFF'
    | 'DIGITEVEN'
    | 'DIGITODD'
    | 'DIGITOVER'
    | 'DIGITUNDER';

export type MarketCondition =
    | 'all-even'
    | 'all-odd'
    | 'all-rise'
    | 'all-fall'
    | 'all-same'
    | `all-over-${number}`
    | `all-under-${number}`
    | `over-${number}`
    | `under-${number}`
    | `matches-${number}`;

export type PurchaseMarket =
    | 'even'
    | 'odd'
    | 'rise'
    | 'fall'
    | `over-${number}`
    | `under-${number}`
    | `matches-${number}`
    | `differs-${number}`;

export type MarketOptionGroup = {
    label: string;
    options: Array<{ value: MarketCondition; label: string }>;
};

export const MARKET_OPTION_GROUPS: MarketOptionGroup[] = [
    {
        label: 'Parity',
        options: [
            { value: 'all-even', label: 'All Even' },
            { value: 'all-odd', label: 'All Odd' },
        ],
    },
    {
        label: 'Pattern',
        options: [
            { value: 'all-same', label: 'All Same' },
            { value: 'all-rise', label: 'Rise' },
            { value: 'all-fall', label: 'Fall' },
        ],
    },
    {
        label: 'Over',
        options: Array.from({ length: 8 }, (_, index) => {
            const barrier = index + 1;
            return { value: `over-${barrier}` as MarketCondition, label: `Over ${barrier}` };
        }),
    },
    {
        label: 'Under',
        options: Array.from({ length: 9 }, (_, index) => {
            const barrier = 9 - index;
            return { value: `under-${barrier}` as MarketCondition, label: `Under ${barrier}` };
        }),
    },
    {
        label: 'Matches',
        options: Array.from({ length: 9 }, (_, index) => {
            const digit = index + 1;
            return { value: `matches-${digit}` as MarketCondition, label: `Matches ${digit}` };
        }),
    },
];

export const MARKET_OPTIONS = MARKET_OPTION_GROUPS.flatMap(group => group.options);

export type PurchaseMarketOptionGroup = {
    label: string;
    options: Array<{ value: PurchaseMarket; label: string }>;
};

export const PURCHASE_MARKET_OPTION_GROUPS: PurchaseMarketOptionGroup[] = [
    {
        label: 'Over prediction',
        options: Array.from({ length: 9 }, (_, digit) => ({
            value: `over-${digit}` as PurchaseMarket,
            label: `Over prediction ${digit}`,
        })),
    },
    {
        label: 'Under prediction',
        options: Array.from({ length: 9 }, (_, index) => {
            const digit = 9 - index;
            return { value: `under-${digit}` as PurchaseMarket, label: `Under prediction ${digit}` };
        }),
    },
    {
        label: 'Direction and parity',
        options: [
            { value: 'even', label: 'Even' },
            { value: 'odd', label: 'Odd' },
            { value: 'rise', label: 'Rise' },
            { value: 'fall', label: 'Fall' },
        ],
    },
    {
        label: 'Matches prediction',
        options: Array.from({ length: 10 }, (_, digit) => ({
            value: `matches-${digit}` as PurchaseMarket,
            label: `Matches prediction ${digit}`,
        })),
    },
    {
        label: 'Differs prediction',
        options: Array.from({ length: 10 }, (_, digit) => ({
            value: `differs-${digit}` as PurchaseMarket,
            label: `Differs prediction ${digit}`,
        })),
    },
];

export const PURCHASE_MARKET_OPTIONS = PURCHASE_MARKET_OPTION_GROUPS.flatMap(group => group.options);

export const purchaseMarketLabel = (market: PurchaseMarket): string =>
    PURCHASE_MARKET_OPTIONS.find(option => option.value === market)?.label || market;

export const marketConditionLabel = (condition: MarketCondition): string =>
    MARKET_OPTIONS.find(option => option.value === condition)?.label ||
    ({
        'all-over-1': 'Over 1',
        'all-over-2': 'Over 2',
        'all-over-3': 'Over 3',
        'all-over-4': 'Over 4',
        'all-over-5': 'Over 5',
        'all-over-6': 'Over 6',
        'all-over-7': 'Over 7',
        'all-over-8': 'Over 8',
        'all-under-1': 'Under 1',
        'all-under-2': 'Under 2',
        'all-under-3': 'Under 3',
        'all-under-4': 'Under 4',
        'all-under-5': 'Under 5',
        'all-under-6': 'Under 6',
        'all-under-7': 'Under 7',
        'all-under-8': 'Under 8',
        'all-under-9': 'Under 9',
    } as Record<string, string>)[condition] || condition;

export type MarketDecision = {
    condition: MarketCondition;
    label: string;
    contractType: StrategyContractType;
    barrier: string | null;
    digits: number[];
    strength: number;
    reason: string;
};

export type StrategySource = {
    symbol: string;
    displayName: string;
    prices: number[];
    lastDigits: number[];
    /** A closed symbol remains visible in scan coverage but cannot be selected. */
    tradable?: boolean;
};

export type RankedMarketDecision = MarketDecision & {
    symbol: string;
    displayName: string;
};

export const isMomentumDirectionConfirmed = (
    expectedContractType: StrategyContractType,
    freshDecision: RankedMarketDecision | null,
): boolean => freshDecision?.contractType === expectedContractType;

const all = (values: number[], predicate: (value: number, index: number) => boolean): boolean =>
    values.length > 0 && values.every(predicate);

const toDigitContractDecision = (
    condition: MarketCondition,
    label: string,
    contractType: StrategyContractType,
    barrier: string | null,
    digits: number[],
    strength: number,
    reason: string,
): MarketDecision => ({
    condition,
    label,
    contractType,
    barrier,
    digits,
    strength,
    reason,
});

/**
 * Convert a quote to the last quoted digit while preserving the symbol's
 * decimal precision when Deriv provides pip_size. The fallback is only used
 * for public history responses that omit pip_size.
 */
export const quoteToLastDigit = (quote: number, pipSize?: number): number => {
    if (!Number.isFinite(quote)) return 0;
    const decimals = Number.isInteger(pipSize) && (pipSize as number) >= 0
        ? Math.min(8, pipSize as number)
        : Math.min(8, Math.max(0, (String(quote).split('.')[1] || '').length));
    const formatted = quote.toFixed(decimals);
    return Number(formatted[formatted.length - 1] || 0);
};

export const quotesToLastDigits = (quotes: number[], pipSize?: number): number[] =>
    quotes.map(quote => quoteToLastDigit(quote, pipSize));

const buildConfiguredDecision = (
    condition: MarketCondition,
    rawDigits: number[],
    rawPrices: number[],
): MarketDecision | null => {
    const digits = rawDigits.filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    if (!digits.length) return null;

    const prices = rawPrices.slice(-digits.length);
    const label = marketConditionLabel(condition);
    const latestDigit = digits[digits.length - 1];
    const barrierMatch = condition.match(/^(?:over|under|matches)-(\d+)$/);
    const barrier = barrierMatch ? Number(barrierMatch[1]) : null;
    const everyDigitIsEven = all(digits, digit => digit % 2 === 0);
    const everyDigitIsOdd = all(digits, digit => digit % 2 !== 0);
    const everyDigitIsSame = new Set(digits).size === 1;
    const rises = digits.length >= 2 && all(prices.slice(1), (price, index) => price > prices[index]);
    const falls = digits.length >= 2 && all(prices.slice(1), (price, index) => price < prices[index]);

    let qualifies = false;
    let reason = '';
    let contractType: StrategyContractType | null = null;
    let decisionBarrier: string | null = null;

    if (condition === 'all-even') {
        qualifies = everyDigitIsEven;
        reason = `Every one of the latest ${digits.length} digits is even.`;
        contractType = 'DIGITEVEN';
    } else if (condition === 'all-odd') {
        qualifies = everyDigitIsOdd;
        reason = `Every one of the latest ${digits.length} digits is odd.`;
        contractType = 'DIGITODD';
    } else if (condition === 'all-same') {
        qualifies = everyDigitIsSame;
        reason = `All ${digits.length} latest digits are ${digits[0]}.`;
        contractType = 'DIGITMATCH';
        decisionBarrier = String(digits[0]);
    } else if (condition === 'all-rise') {
        qualifies = rises;
        reason = `The latest ${digits.length} quotes rose consecutively.`;
        contractType = 'CALL';
    } else if (condition === 'all-fall') {
        qualifies = falls;
        reason = `The latest ${digits.length} quotes fell consecutively.`;
        contractType = 'PUT';
    } else if (condition.startsWith('over-') || condition.startsWith('all-over-')) {
        qualifies = barrier !== null && all(digits, digit => digit > barrier);
        reason = `Every latest digit is greater than ${barrier}.`;
        contractType = 'DIGITOVER';
        decisionBarrier = String(barrier);
    } else if (condition.startsWith('under-') || condition.startsWith('all-under-')) {
        qualifies = barrier !== null && all(digits, digit => digit < barrier);
        reason = `Every latest digit is less than ${barrier}.`;
        contractType = 'DIGITUNDER';
        decisionBarrier = String(barrier);
    } else if (condition.startsWith('matches-')) {
        qualifies = barrier !== null && latestDigit === barrier;
        reason = `The latest digit is ${barrier}.`;
        contractType = 'DIGITMATCH';
        decisionBarrier = String(barrier);
    }

    if (!qualifies || !contractType) return null;

    return toDigitContractDecision(
        condition,
        label,
        contractType,
        decisionBarrier,
        digits,
        100 + digits.length / 100,
        reason,
    );
};

export const selectConfiguredMarket = (
    source: StrategySource,
    windowSize: number,
    condition: MarketCondition,
): RankedMarketDecision | null => {
    const decision = buildConfiguredDecision(
        condition,
        source.lastDigits.slice(-windowSize),
        source.prices,
    );
    return decision ? { ...decision, symbol: source.symbol, displayName: source.displayName } : null;
};

export const withPurchaseMarket = (
    decision: RankedMarketDecision,
    market: PurchaseMarket,
): RankedMarketDecision => {
    const barrierMatch = market.match(/^(?:over|under|matches|differs)-(\d+)$/);
    let contractType: StrategyContractType = 'DIGITDIFF';
    const barrier: string | null = barrierMatch ? barrierMatch[1] : null;

    if (market === 'even') contractType = 'DIGITEVEN';
    else if (market === 'odd') contractType = 'DIGITODD';
    else if (market === 'rise') contractType = 'CALL';
    else if (market === 'fall') contractType = 'PUT';
    else if (market.startsWith('over-')) contractType = 'DIGITOVER';
    else if (market.startsWith('under-')) contractType = 'DIGITUNDER';
    else if (market.startsWith('matches-')) contractType = 'DIGITMATCH';

    return {
        ...decision,
        label: purchaseMarketLabel(market),
        contractType,
        barrier,
    };
};

export type AdaptiveDigitMarketPlan = {
    primary: RankedMarketDecision;
    recovery: RankedMarketDecision;
    primaryMarket: PurchaseMarket;
    recoveryMarket: PurchaseMarket;
};

const digitHitRate = (digits: number[], predicate: (digit: number) => boolean): number =>
    digits.length ? digits.filter(predicate).length / digits.length : 0;

const adaptiveDigitDecision = (
    source: StrategySource,
    market: PurchaseMarket,
    hitRate: number,
    windowSize: number,
    role: 'primary' | 'recovery',
): RankedMarketDecision => {
    const condition = market === 'even'
        ? 'all-even'
        : market === 'odd'
            ? 'all-odd'
            : market.replace(/^(over|under)-/, '$1-') as MarketCondition;
    const baseDecision: RankedMarketDecision = {
        condition,
        label: purchaseMarketLabel(market),
        contractType: market === 'even'
            ? 'DIGITEVEN'
            : market === 'odd'
                ? 'DIGITODD'
                : market.startsWith('over-')
                    ? 'DIGITOVER'
                    : 'DIGITUNDER',
        barrier: market.match(/^(?:over|under)-(\d+)$/)?.[1] || null,
        digits: source.lastDigits.slice(-windowSize),
        strength: hitRate * 100,
        reason: `${role === 'primary' ? 'Primary' : 'Recovery'} ${purchaseMarketLabel(market)} estimated hit rate ${(
            hitRate * 100
        ).toFixed(0)}% across the latest ${Math.min(windowSize, source.lastDigits.length)} digits.`,
        symbol: source.symbol,
        displayName: source.displayName,
    };
    return withPurchaseMarket(baseDecision, market);
};

/**
 * Choose a digit contract from the current market evidence instead of
 * hard-coding parity. Threshold markets are preferred when they have enough
 * recent support; parity remains the safe fallback when threshold evidence is
 * weak or unavailable.
 */
export const selectAdaptiveDigitMarketPlan = (
    source: StrategySource,
    windowSize = 20,
): AdaptiveDigitMarketPlan | null => {
    const digits = source.lastDigits
        .slice(-Math.max(3, Math.floor(windowSize)))
        .filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    if (!digits.length) return null;

    const candidates: Array<{ market: PurchaseMarket; hitRate: number; priority: number }> = [
        { market: 'over-2', hitRate: digitHitRate(digits, digit => digit > 2), priority: 4 },
        { market: 'under-7', hitRate: digitHitRate(digits, digit => digit < 7), priority: 4 },
        { market: 'even', hitRate: digitHitRate(digits, digit => digit % 2 === 0), priority: 2 },
        { market: 'odd', hitRate: digitHitRate(digits, digit => digit % 2 !== 0), priority: 2 },
    ];
    const rankedCandidates = candidates.sort((left, right) =>
        right.hitRate - left.hitRate || right.priority - left.priority,
    );
    const best = rankedCandidates[0];
    const primary = adaptiveDigitDecision(source, best.market, best.hitRate, digits.length, 'primary');

    const pairedRecoveryMarket: PurchaseMarket | null = best.market === 'over-2'
        ? 'over-4'
        : best.market === 'under-7'
            ? 'under-5'
            : null;
    const recoveryCandidates: Array<{ market: PurchaseMarket; hitRate: number; priority: number }> = [
        ...(pairedRecoveryMarket
            ? [{ market: pairedRecoveryMarket, hitRate: digitHitRate(digits, digit => pairedRecoveryMarket === 'over-4' ? digit > 4 : digit < 5), priority: 5 }]
            : []),
        { market: 'over-4', hitRate: digitHitRate(digits, digit => digit > 4), priority: 3 },
        { market: 'under-5', hitRate: digitHitRate(digits, digit => digit < 5), priority: 3 },
        { market: 'even', hitRate: digitHitRate(digits, digit => digit % 2 === 0), priority: 1 },
        { market: 'odd', hitRate: digitHitRate(digits, digit => digit % 2 !== 0), priority: 1 },
    ].sort((left, right) => right.hitRate - left.hitRate || right.priority - left.priority);
    const recovery = recoveryCandidates[0];

    return {
        primary,
        recovery: adaptiveDigitDecision(source, recovery.market, recovery.hitRate, digits.length, 'recovery'),
        primaryMarket: best.market,
        recoveryMarket: recovery.market,
    };
};

/**
 * Select exactly one market. More specific patterns outrank broad patterns:
 * same-digit > monotonic movement > parity > the tightest valid Over/Under
 * threshold. This makes overlapping conditions deterministic.
 */
export const selectMarketForWindow = (
    rawDigits: number[],
    rawPrices: number[],
): MarketDecision | null => {
    const digits = rawDigits.filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    if (!digits.length) return null;

    const candidates: MarketDecision[] = [];
    const windowLengthBonus = digits.length / 100;
    const uniqueDigits = new Set(digits);
    const sameDigit = digits[0];
    const prices = rawPrices.slice(-digits.length);

    if (uniqueDigits.size === 1) {
        candidates.push(toDigitContractDecision(
            'all-same',
            'Matches',
            'DIGITMATCH',
            String(sameDigit),
            digits,
            100 + windowLengthBonus,
            `All ${digits.length} latest digits are ${sameDigit}.`,
        ));
    }

    const rises = digits.length >= 2 && all(prices.slice(1), (price, index) => price > prices[index]);
    const falls = digits.length >= 2 && all(prices.slice(1), (price, index) => price < prices[index]);
    if (rises) {
        candidates.push(toDigitContractDecision(
            'all-rise',
            'Rise',
            'CALL',
            null,
            digits,
            95 + windowLengthBonus,
            `All ${digits.length} latest quotes rose consecutively.`,
        ));
    }
    if (falls) {
        candidates.push(toDigitContractDecision(
            'all-fall',
            'Fall',
            'PUT',
            null,
            digits,
            95 + windowLengthBonus,
            `All ${digits.length} latest quotes fell consecutively.`,
        ));
    }

    if (all(digits, digit => digit % 2 === 0)) {
        candidates.push(toDigitContractDecision(
            'all-even',
            'Even',
            'DIGITEVEN',
            null,
            digits,
            90 + windowLengthBonus,
            `Every latest digit is even.`,
        ));
    }
    if (all(digits, digit => digit % 2 !== 0)) {
        candidates.push(toDigitContractDecision(
            'all-odd',
            'Odd',
            'DIGITODD',
            null,
            digits,
            90 + windowLengthBonus,
            `Every latest digit is odd.`,
        ));
    }

    const minimumDigit = Math.min(...digits);
    const maximumDigit = Math.max(...digits);
    const overBarrier = minimumDigit - 1;
    const underBarrier = maximumDigit + 1;

    if (overBarrier >= 1 && overBarrier <= 8) {
        candidates.push(toDigitContractDecision(
            `all-over-${overBarrier}`,
            `Over ${overBarrier}`,
            'DIGITOVER',
            String(overBarrier),
            digits,
            70 + overBarrier + windowLengthBonus,
            `Every latest digit is greater than ${overBarrier}.`,
        ));
    }
    if (underBarrier >= 1 && underBarrier <= 9) {
        candidates.push(toDigitContractDecision(
            `all-under-${underBarrier}`,
            `Under ${underBarrier}`,
            'DIGITUNDER',
            String(underBarrier),
            digits,
            70 + (10 - underBarrier) + windowLengthBonus,
            `Every latest digit is less than ${underBarrier}.`,
        ));
    }

    return candidates.sort((left, right) => right.strength - left.strength)[0] || null;
};

export const selectStrongestMarket = (
    sources: StrategySource[],
    windowSize: number,
    condition?: MarketCondition,
): RankedMarketDecision | null => {
    const candidates = sources
        .map(source => {
            if (condition) return selectConfiguredMarket(source, windowSize, condition);
            const digits = source.lastDigits.slice(-windowSize);
            const decision = selectMarketForWindow(digits, source.prices);
            return decision ? { ...decision, symbol: source.symbol, displayName: source.displayName } : null;
        })
        .filter((decision): decision is RankedMarketDecision => decision !== null);

    return candidates.sort((left, right) =>
        right.strength - left.strength ||
        left.displayName.localeCompare(right.displayName),
    )[0] || null;
};

export const AUTO_MOMENTUM_WARMUP = 30;
export const AUTO_MOMENTUM_SHORT_WINDOW = 6;
export const AUTO_MOMENTUM_LONG_WINDOW = 14;
export const AUTO_MOMENTUM_CONFIDENCE = 55;
export const AUTO_SIGNAL_CONFIDENCE_WINDOW = 60;

export type MomentumSignal = 'CALL' | 'PUT';

export type MomentumMarketEvaluation = {
    symbol: string;
    displayName: string;
    signal: MomentumSignal | null;
    confidence: number;
    confidenceWindow: number;
    shortRise: number;
    shortFall: number;
    longRise: number;
    longFall: number;
    historyReady: boolean;
    momentumAligned: boolean;
    confidencePassed: boolean;
    qualified: boolean;
    reasons: string[];
};

const directionalPercentage = (moves: number[], direction: 1 | -1): number =>
    moves.length ? (moves.filter(move => move === direction).length / moves.length) * 100 : 0;

const directionalMovesForWindow = (prices: number[], windowSize: number): number[] => {
    const window = prices.slice(-(windowSize + 1));
    return window.slice(1).map((price, index) => {
        const previous = window[index];
        return price > previous ? 1 : price < previous ? -1 : 0;
    });
};

export const evaluateMomentumMarket = (
    source: StrategySource,
    shortWindow = AUTO_MOMENTUM_SHORT_WINDOW,
    longWindow = AUTO_MOMENTUM_LONG_WINDOW,
    minimumConfidence = AUTO_MOMENTUM_CONFIDENCE,
    confidenceWindow = AUTO_SIGNAL_CONFIDENCE_WINDOW,
): MomentumMarketEvaluation => {
    const prices = source.prices.map(Number).filter(Number.isFinite);
    const shortSize = Math.max(2, Math.floor(Number(shortWindow) || AUTO_MOMENTUM_SHORT_WINDOW));
    const longSize = Math.max(shortSize, Math.floor(Number(longWindow) || AUTO_MOMENTUM_LONG_WINDOW));
    const requiredConfidence = Math.max(1, Math.min(99, Number(minimumConfidence) || AUTO_MOMENTUM_CONFIDENCE));
    const requestedConfidenceWindow = Math.max(
        longSize,
        Math.floor(Number(confidenceWindow) || AUTO_SIGNAL_CONFIDENCE_WINDOW),
    );
    const historyReady = prices.length >= Math.max(AUTO_MOMENTUM_WARMUP, requestedConfidenceWindow + 1);
    const moves = directionalMovesForWindow(prices, requestedConfidenceWindow);
    const shortMoves = moves.slice(-shortSize);
    const longMoves = moves.slice(-longSize);
    const shortRise = directionalPercentage(shortMoves, 1);
    const shortFall = directionalPercentage(shortMoves, -1);
    const longRise = directionalPercentage(longMoves, 1);
    const longFall = directionalPercentage(longMoves, -1);
    const shortBias = shortRise - shortFall;
    const longBias = longRise - longFall;
    const signal: MomentumSignal | null = shortBias >= requiredConfidence && longBias > 0
        ? 'CALL'
        : shortBias <= -requiredConfidence && longBias < 0
            ? 'PUT'
            : null;
    const confidence = signal === 'CALL'
        ? directionalPercentage(moves, 1)
        : signal === 'PUT'
            ? directionalPercentage(moves, -1)
            : Math.max(directionalPercentage(moves, 1), directionalPercentage(moves, -1));
    const momentumAligned = signal !== null;
    const confidencePassed = signal !== null && confidence >= requiredConfidence;
    const reasons: string[] = [];

    if (!historyReady) {
        reasons.push(`Needs ${requestedConfidenceWindow + 1} prices for a ${requestedConfidenceWindow}-tick confidence check; received ${prices.length}.`);
    }
    if (!momentumAligned) {
        reasons.push(`Short/long momentum did not align at the ${requiredConfidence}% signal threshold.`);
    }
    if (signal && !confidencePassed) {
        reasons.push(`${requestedConfidenceWindow}-tick ${signal} confidence is ${confidence.toFixed(0)}%, below ${requiredConfidence}%.`);
    }

    return {
        symbol: source.symbol,
        displayName: source.displayName,
        signal,
        confidence,
        confidenceWindow: requestedConfidenceWindow,
        shortRise,
        shortFall,
        longRise,
        longFall,
        historyReady,
        momentumAligned,
        confidencePassed,
        qualified: historyReady && momentumAligned && confidencePassed,
        reasons,
    };
};

export const selectBestQualifiedMomentumMarket = (
    sources: StrategySource[],
    shortWindow = AUTO_MOMENTUM_SHORT_WINDOW,
    longWindow = AUTO_MOMENTUM_LONG_WINDOW,
    minimumConfidence = AUTO_MOMENTUM_CONFIDENCE,
    confidenceWindow = AUTO_SIGNAL_CONFIDENCE_WINDOW,
): RankedMarketDecision | null => sources
    .filter(source => source.tradable !== false)
    .map(source => evaluateMomentumMarket(source, shortWindow, longWindow, minimumConfidence, confidenceWindow))
    .filter(evaluation => evaluation.qualified && evaluation.signal)
    .sort((left, right) =>
        right.confidence - left.confidence ||
        Math.max(right.longRise, right.longFall) - Math.max(left.longRise, left.longFall) ||
        left.displayName.localeCompare(right.displayName),
    )
    .map(evaluation => ({
        symbol: evaluation.symbol,
        displayName: evaluation.displayName,
        condition: evaluation.signal === 'CALL' ? 'all-rise' : 'all-fall',
        label: `Momentum ${evaluation.signal} · ${evaluation.confidence.toFixed(0)}% / ${evaluation.confidenceWindow} ticks`,
        contractType: evaluation.signal as StrategyContractType,
        barrier: null,
        digits: [],
        strength: evaluation.confidence,
        reason: `${evaluation.signal} qualified: ${evaluation.confidence.toFixed(0)}% confidence across the last ${evaluation.confidenceWindow} ticks; short/long momentum aligned.`,
    } satisfies RankedMarketDecision))[0] || null;

/**
 * Select the strongest live Rise/Fall candidate from the complete volatility
 * scan. This intentionally has a smaller signal surface than the research
 * model: short/long directional momentum is the signal, while execution
 * safety remains the engine's responsibility.
 */
export const selectStrongestMomentumMarket = (
    sources: StrategySource[],
    shortWindow = AUTO_MOMENTUM_SHORT_WINDOW,
    longWindow = AUTO_MOMENTUM_LONG_WINDOW,
    minimumConfidence = AUTO_MOMENTUM_CONFIDENCE,
): RankedMarketDecision | null => {
    const shortSize = Math.max(2, Math.floor(Number(shortWindow) || AUTO_MOMENTUM_SHORT_WINDOW));
    const longSize = Math.max(shortSize, Math.floor(Number(longWindow) || AUTO_MOMENTUM_LONG_WINDOW));
    const confidence = Math.max(1, Math.min(99, Number(minimumConfidence) || AUTO_MOMENTUM_CONFIDENCE));

    const candidates = sources.flatMap(source => {
            const prices = source.prices.map(Number).filter(Number.isFinite);
            const minimumHistory = Math.max(AUTO_MOMENTUM_WARMUP, longSize + 1);
            if (prices.length < minimumHistory) return [];

            const window = prices.slice(-(longSize + 1));
            const moves = window.slice(1).map((price, index) => {
                const previous = window[index];
                return price > previous ? 1 : price < previous ? -1 : 0;
            });
            const shortMoves = moves.slice(-shortSize);
            const shortRise = directionalPercentage(shortMoves, 1);
            const shortFall = directionalPercentage(shortMoves, -1);
            const longRise = directionalPercentage(moves, 1);
            const longFall = directionalPercentage(moves, -1);
            const shortBias = shortRise - shortFall;
            const longBias = longRise - longFall;
            const signal =
                shortBias >= confidence && longBias > 0
                    ? 'CALL'
                    : shortBias <= -confidence && longBias < 0
                      ? 'PUT'
                      : null;

            if (!signal) return [];

            const isCall = signal === 'CALL';
            const signalConfidence = Math.abs(shortBias);
            const trendConfidence = Math.abs(longBias);
            return [{
                symbol: source.symbol,
                displayName: source.displayName,
                condition: isCall ? 'all-rise' : 'all-fall',
                label: `Adaptive Momentum ${signal}`,
                contractType: isCall ? 'CALL' : 'PUT',
                barrier: null,
                digits: [],
                strength: signalConfidence + trendConfidence / 10,
                reason: `${signal} confirmed: short ${shortRise.toFixed(0)}% rise / ${shortFall.toFixed(0)}% fall; long ${longRise.toFixed(0)}% rise / ${longFall.toFixed(0)}% fall.`,
            } satisfies RankedMarketDecision];
        });

    return candidates.sort((left, right) =>
        right.strength - left.strength ||
        left.displayName.localeCompare(right.displayName),
    )[0] || null;
};