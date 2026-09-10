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
    | `all-under-${number}`;

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
): RankedMarketDecision | null => {
    const candidates = sources
        .map(source => {
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