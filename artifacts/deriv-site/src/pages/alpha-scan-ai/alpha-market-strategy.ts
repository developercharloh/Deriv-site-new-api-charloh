export type StrategyContractType =
    | 'CALL'
    | 'PUT'
    | 'DIGITMATCH'
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
};

export type RankedMarketDecision = MarketDecision & {
    symbol: string;
    displayName: string;
};

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

export const withPurchaseCondition = (
    decision: RankedMarketDecision,
    condition: MarketCondition,
): RankedMarketDecision => {
    const barrierMatch = condition.match(/^(?:over|under|matches)-(\d+)$/) || condition.match(/^all-(?:over|under)-(\d+)$/);
    const latestDigit = decision.digits[decision.digits.length - 1];
    let contractType: StrategyContractType = 'DIGITMATCH';
    let barrier: string | null = barrierMatch ? barrierMatch[1] : null;

    if (condition === 'all-even') contractType = 'DIGITEVEN';
    else if (condition === 'all-odd') contractType = 'DIGITODD';
    else if (condition === 'all-rise') contractType = 'CALL';
    else if (condition === 'all-fall') contractType = 'PUT';
    else if (condition === 'all-same') barrier = String(latestDigit);
    else if (condition.startsWith('over-') || condition.startsWith('all-over-')) contractType = 'DIGITOVER';
    else if (condition.startsWith('under-') || condition.startsWith('all-under-')) contractType = 'DIGITUNDER';
    else if (condition.startsWith('matches-')) contractType = 'DIGITMATCH';

    return {
        ...decision,
        condition,
        label: marketConditionLabel(condition),
        contractType,
        barrier,
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