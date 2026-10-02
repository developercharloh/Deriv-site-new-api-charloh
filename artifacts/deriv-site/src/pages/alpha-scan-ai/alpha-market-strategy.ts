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

export const NEXUS_ALLOWED_DIGIT_MARKETS = [
    'even',
    'odd',
    'over-1',
    'over-2',
    'over-3',
    'over-4',
    'over-5',
    'under-4',
    'under-5',
    'under-6',
    'under-7',
    'under-8',
] as const satisfies readonly PurchaseMarket[];

const NEXUS_ALLOWED_DIGIT_MARKET_SET = new Set<string>(NEXUS_ALLOWED_DIGIT_MARKETS);

export const isNexusDigitMarketAllowed = (market: string): market is typeof NEXUS_ALLOWED_DIGIT_MARKETS[number] =>
    NEXUS_ALLOWED_DIGIT_MARKET_SET.has(market);

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

export const NEXUS_MARKET_OPTION_GROUPS: MarketOptionGroup[] = MARKET_OPTION_GROUPS
    .map(group => ({
        ...group,
        options: group.options.filter(({ value }) =>
            value === 'all-even' ||
            value === 'all-odd' ||
            /^over-[1-5]$/.test(value) ||
            /^under-[4-8]$/.test(value),
        ),
    }))
    .filter(group => group.options.length > 0);

export const NEXUS_PURCHASE_MARKET_OPTION_GROUPS: PurchaseMarketOptionGroup[] = PURCHASE_MARKET_OPTION_GROUPS
    .map(group => ({
        ...group,
        options: group.options.filter(option => NEXUS_ALLOWED_DIGIT_MARKET_SET.has(option.value)),
    }))
    .filter(group => group.options.length > 0);

export const purchaseMarketLabel = (market: PurchaseMarket): string =>
    PURCHASE_MARKET_OPTIONS.find(option => option.value === market)?.label || market;

export const strategyContractDisplayLabel = (contractType: string): string =>
    contractType === 'CALL'
        ? 'Rise (CALL)'
        : contractType === 'PUT'
            ? 'Fall (PUT)'
            : contractType;

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
    purchaseMarket?: PurchaseMarket;
    entryDigit?: number;
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
        purchaseMarket: market,
        label: purchaseMarketLabel(market),
        contractType,
        barrier,
    };
};

export const purchaseMarketFromDecision = (
    decision: RankedMarketDecision,
): PurchaseMarket | null => decision.purchaseMarket || (
    decision.contractType === 'DIGITEVEN'
        ? 'even'
        : decision.contractType === 'DIGITODD'
            ? 'odd'
            : decision.contractType === 'DIGITOVER'
                ? `over-${Number(decision.barrier ?? 0)}`
                : decision.contractType === 'DIGITUNDER'
                    ? `under-${Number(decision.barrier ?? 0)}`
                    : null
);

export const isNexusExecutionDecisionAllowed = (decision: RankedMarketDecision): boolean => {
    const market = purchaseMarketFromDecision(decision);
    if (!market || !isNexusDigitMarketAllowed(market)) return false;

    if (market === 'even') return decision.contractType === 'DIGITEVEN' && decision.barrier === null;
    if (market === 'odd') return decision.contractType === 'DIGITODD' && decision.barrier === null;

    const match = market.match(/^(over|under)-(\d+)$/);
    if (!match || decision.barrier !== match[2]) return false;
    return match[1] === 'over'
        ? decision.contractType === 'DIGITOVER'
        : decision.contractType === 'DIGITUNDER';
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
    role: 'primary' | 'recovery' | 'fallback',
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
        reason: `${role === 'primary' ? 'Primary' : role === 'recovery' ? 'Recovery' : 'Fallback'} ${purchaseMarketLabel(market)} estimated hit rate ${(
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

    const pairedRecoveryMarket: PurchaseMarket = best.market === 'over-2'
        ? 'over-4'
        : best.market === 'under-7'
            ? 'under-5'
            : best.market === 'even'
                ? 'odd'
                : 'even';
    const recoveryHitRate = pairedRecoveryMarket === 'over-4'
        ? digitHitRate(digits, digit => digit > 4)
        : pairedRecoveryMarket === 'under-5'
            ? digitHitRate(digits, digit => digit < 5)
            : pairedRecoveryMarket === 'even'
                ? digitHitRate(digits, digit => digit % 2 === 0)
                : digitHitRate(digits, digit => digit % 2 !== 0);

    return {
        primary,
        recovery: adaptiveDigitDecision(source, pairedRecoveryMarket, recoveryHitRate, digits.length, 'recovery'),
        primaryMarket: best.market,
        recoveryMarket: pairedRecoveryMarket,
    };
};

export const selectAutoFallbackMarket = (
    source: StrategySource,
    windowSize = 20,
): RankedMarketDecision | null => {
    const primary = selectAdaptiveDigitMarketPlan(source, windowSize)?.primary;
    return primary
        ? {
            ...primary,
            reason: `No strict momentum market passed the live confidence gate. Using the strongest available ${primary.label} route on ${source.displayName}; fresh ticks must confirm it before purchase.`,
        }
        : null;
};

/**
 * Pick the strongest supported digit route after the broker rejects the
 * currently selected one. This deliberately excludes the rejected route and
 * any route cached as unsupported for the same symbol.
 */
export const selectBestAvailableDigitFallback = (
    source: StrategySource,
    rejectedMarket: PurchaseMarket,
    windowSize = 20,
    unavailableMarkets: ReadonlySet<PurchaseMarket> = new Set(),
): RankedMarketDecision | null => {
    const digits = source.lastDigits
        .slice(-Math.max(3, Math.floor(windowSize)))
        .filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    if (!digits.length) return null;

    const candidates: Array<{ market: PurchaseMarket; hitRate: number; priority: number }> = [
        { market: 'over-2', hitRate: digitHitRate(digits, digit => digit > 2), priority: 4 },
        { market: 'under-7', hitRate: digitHitRate(digits, digit => digit < 7), priority: 4 },
        { market: 'over-4', hitRate: digitHitRate(digits, digit => digit > 4), priority: 3 },
        { market: 'under-5', hitRate: digitHitRate(digits, digit => digit < 5), priority: 3 },
        { market: 'even', hitRate: digitHitRate(digits, digit => digit % 2 === 0), priority: 2 },
        { market: 'odd', hitRate: digitHitRate(digits, digit => digit % 2 !== 0), priority: 2 },
    ];
    const availableCandidates = candidates.filter(
        candidate => candidate.market !== rejectedMarket && !unavailableMarkets.has(candidate.market),
    );

    const best = availableCandidates.sort((left, right) =>
        right.hitRate - left.hitRate || right.priority - left.priority,
    )[0];
    return best
        ? adaptiveDigitDecision(source, best.market, best.hitRate, digits.length, 'fallback')
        : null;
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
export const NEXUS_DIGIT_SIGNAL_WINDOW = 60;
export const NEXUS_DIGIT_MIN_EDGE = 0.04;
export const NEXUS_DIGIT_WILSON_Z = 1.645;
export const NEXUS_DEFAULT_PAYOUT_FLOOR = 1.8;

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

const digitMarketProbability = (market: PurchaseMarket): number | null => {
    if (market === 'even' || market === 'odd') return 0.5;
    const match = market.match(/^(over|under)-(\d+)$/);
    if (!match) return null;
    const barrier = Number(match[2]);
    return match[1] === 'over'
        ? (9 - barrier) / 10
        : barrier / 10;
};

const digitMarketMatches = (market: PurchaseMarket, digit: number): boolean => {
    if (market === 'even') return digit % 2 === 0;
    if (market === 'odd') return digit % 2 !== 0;
    const match = market.match(/^(over|under)-(\d+)$/);
    if (!match) return false;
    const barrier = Number(match[2]);
    return match[1] === 'over' ? digit > barrier : digit < barrier;
};

const oneSidedWilsonLowerBound = (successes: number, observations: number): number => {
    if (!Number.isFinite(successes) || !Number.isFinite(observations) || observations <= 0) return 0;
    const sampleSize = observations;
    const observedRate = Math.max(0, Math.min(1, successes / sampleSize));
    const zSquared = NEXUS_DIGIT_WILSON_Z ** 2;
    const denominator = 1 + zSquared / sampleSize;
    const center = observedRate + zSquared / (2 * sampleSize);
    const margin = NEXUS_DIGIT_WILSON_Z * Math.sqrt(
        (observedRate * (1 - observedRate) + zSquared / (4 * sampleSize)) / sampleSize,
    );
    return Math.max(0, (center - margin) / denominator);
};

const hasNexusDigitEvidence = (
    digits: number[],
    market: PurchaseMarket,
    expectedRate: number,
): boolean => {
    if (!digits.length) return false;
    const hits = digits.filter(digit => digitMarketMatches(market, digit)).length;
    const observedRate = hits / digits.length;
    return observedRate >= expectedRate + NEXUS_DIGIT_MIN_EDGE &&
        oneSidedWilsonLowerBound(hits, digits.length) > expectedRate;
};

const nexusDigitDecision = (
    source: StrategySource,
    market: PurchaseMarket,
    digits: number[],
    hitRate: number,
    expectedRate: number,
): RankedMarketDecision => {
    const condition: MarketCondition = market === 'even'
        ? 'all-even'
        : market === 'odd'
            ? 'all-odd'
            : market as MarketCondition;
    const edge = hitRate - expectedRate;
    const hits = digits.filter(digit => digitMarketMatches(market, digit)).length;
    const lowerBound = oneSidedWilsonLowerBound(hits, digits.length);
    return {
        symbol: source.symbol,
        displayName: source.displayName,
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
        purchaseMarket: market,
        entryDigit: digits[digits.length - 1],
        digits,
        strength: 50 + edge * 100,
        reason: `${purchaseMarketLabel(market)} appeared ${hits}/${digits.length} times (${(
            hitRate * 100
        ).toFixed(0)}%) in the latest digits; its one-sided 95% Wilson lower bound is ${(
            lowerBound * 100
        ).toFixed(0)}% versus a ${(expectedRate * 100).toFixed(0)}% theoretical baseline. Latest scanned digit: ${
            digits[digits.length - 1]
        }. This is an evidence screen, not a win-probability guarantee.`,
    };
};

/**
 * Require a minimum tick sample, an observed edge, and a one-sided 95% Wilson
 * lower bound above the route baseline. This is a screening statistic, not a
 * calibrated estimate of the next contract's win probability.
 */
export const isNexusDigitDecisionQualified = (
    decision: RankedMarketDecision,
    source: StrategySource,
    windowSize = NEXUS_DIGIT_SIGNAL_WINDOW,
): boolean => {
    const market = purchaseMarketFromDecision(decision);
    if (!market || !isNexusExecutionDecisionAllowed(decision)) return false;
    const expectedRate = digitMarketProbability(market);
    if (!expectedRate || expectedRate <= 0) return false;
    const digits = source.lastDigits
        .slice(-windowSize)
        .filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    if (digits.length < windowSize) return false;
    const entryDigit = digits[digits.length - 1];
    return digitMarketMatches(market, entryDigit) &&
        hasNexusDigitEvidence(digits, market, expectedRate);
};

export type NexusQuoteGateInput = {
    leg: 'primary' | 'recovery';
    payoutMultiplier: number;
    minimumPayoutMultiplier: number;
    enforceMinimumPayout: boolean;
    primaryPayoutMultiplier: number | null;
    projectedProfit: number;
    sessionDeficit: number;
};

export const evaluateNexusQuoteGate = (input: NexusQuoteGateInput): string[] => {
    const reasons: string[] = [];
    const multiplierLabel = Number.isFinite(input.payoutMultiplier)
        ? input.payoutMultiplier.toFixed(2)
        : 'unknown';

    if (input.enforceMinimumPayout && (
        !Number.isFinite(input.minimumPayoutMultiplier) ||
        input.minimumPayoutMultiplier <= 0 ||
        !Number.isFinite(input.payoutMultiplier) ||
        input.payoutMultiplier < input.minimumPayoutMultiplier
    )) {
        reasons.push(
            `quoted payout ${multiplierLabel}x is below the ${input.minimumPayoutMultiplier.toFixed(2)}x floor`,
        );
    }

    if (input.leg === 'recovery') {
        const primaryLabel = input.primaryPayoutMultiplier === null ||
            !Number.isFinite(input.primaryPayoutMultiplier)
            ? 'unknown'
            : input.primaryPayoutMultiplier.toFixed(2);
        if (
            input.primaryPayoutMultiplier === null ||
            !Number.isFinite(input.primaryPayoutMultiplier) ||
            !Number.isFinite(input.payoutMultiplier) ||
            input.payoutMultiplier <= input.primaryPayoutMultiplier
        ) {
            reasons.push(`recovery payout must exceed the primary ${primaryLabel}x rate`);
        }

        const deficit = Math.max(0, Number(input.sessionDeficit) || 0);
        if (
            !Number.isFinite(input.projectedProfit) ||
            input.projectedProfit < deficit
        ) {
            const projectedLabel = Number.isFinite(input.projectedProfit)
                ? input.projectedProfit.toFixed(2)
                : '0.00';
            reasons.push(
                `quoted recovery profit $${projectedLabel} does not cover the $${deficit.toFixed(2)} session deficit`,
            );
        }
    }

    return reasons;
};

/**
 * Rank only the configured digit routes across currently open synthetic
 * markets. A route needs a 60-tick sample, an observed baseline edge, and a
 * conservative binomial evidence bound. The broker quote, not a theoretical
 * hit-rate proxy, decides whether its payout is acceptable.
 */
export const selectNexusAutomaticCandidates = (
    sources: StrategySource[],
    windowSize = NEXUS_DIGIT_SIGNAL_WINDOW,
): RankedMarketDecision[] => {
    const openSources = sources.filter(source => source.tradable === true);
    const digitCandidates = openSources.flatMap(source => {
        const digits = source.lastDigits
            .slice(-windowSize)
            .filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
        if (digits.length < windowSize) return [];
        return NEXUS_ALLOWED_DIGIT_MARKETS.flatMap(market => {
            const expectedRate = digitMarketProbability(market);
            if (!expectedRate || expectedRate <= 0) return [];
            const hitRate = digitHitRate(digits, digit => digitMarketMatches(market, digit));
            if (!hasNexusDigitEvidence(digits, market, expectedRate)) return [];
            return [nexusDigitDecision(source, market, digits, hitRate, expectedRate)];
        });
    });
    return digitCandidates.sort((left, right) =>
        right.strength - left.strength ||
            left.symbol.localeCompare(right.symbol) ||
            left.contractType.localeCompare(right.contractType) ||
            (left.barrier || '').localeCompare(right.barrier || ''),
    );
};

type NexusDecisionSelectionOptions = {
    lastDecisionKey?: string | null;
    lastSymbol?: string | null;
    recovery?: boolean;
};

const nexusDecisionKey = (decision: RankedMarketDecision): string =>
    `${decision.symbol}|${decision.contractType}|${decision.barrier || ''}`;

/**
 * Select only whitelisted digit decisions. Recovery still requires a
 * different symbol from the last contract.
 */
export const selectNextNexusDecision = (
    candidates: RankedMarketDecision[],
    options: NexusDecisionSelectionOptions = {},
): RankedMarketDecision | null => {
    const eligible = candidates.filter(decision =>
        isNexusExecutionDecisionAllowed(decision) &&
        (!options.recovery || decision.symbol !== options.lastSymbol),
    );
    if (options.recovery) {
        return eligible.find(decision => nexusDecisionKey(decision) !== options.lastDecisionKey) || null;
    }

    const differentDecision = eligible.filter(
        decision => nexusDecisionKey(decision) !== options.lastDecisionKey,
    );
    return differentDecision[0] || eligible[0] || null;
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
): RankedMarketDecision | null => selectQualifiedMomentumMarkets(
    sources,
    shortWindow,
    longWindow,
    minimumConfidence,
    confidenceWindow,
)[0] || null;

export const selectQualifiedMomentumMarkets = (
    sources: StrategySource[],
    shortWindow = AUTO_MOMENTUM_SHORT_WINDOW,
    longWindow = AUTO_MOMENTUM_LONG_WINDOW,
    minimumConfidence = AUTO_MOMENTUM_CONFIDENCE,
    confidenceWindow = AUTO_SIGNAL_CONFIDENCE_WINDOW,
): RankedMarketDecision[] => sources
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
        label: `Momentum ${strategyContractDisplayLabel(evaluation.signal)} · ${evaluation.confidence.toFixed(0)}% / ${evaluation.confidenceWindow} ticks`,
        contractType: evaluation.signal as StrategyContractType,
        barrier: null,
        digits: [],
        strength: evaluation.confidence,
        reason: `${strategyContractDisplayLabel(evaluation.signal)} qualified: ${evaluation.confidence.toFixed(0)}% of recent price transitions moved in that direction across ${evaluation.confidenceWindow} ticks; short/long momentum aligned. Historical agreement is not a win guarantee.`,
    } satisfies RankedMarketDecision));

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
                label: `Adaptive Momentum ${strategyContractDisplayLabel(signal)}`,
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