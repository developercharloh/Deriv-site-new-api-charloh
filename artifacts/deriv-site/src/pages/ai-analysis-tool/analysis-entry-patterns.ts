export const RISE_FALL_ENTRY_PATTERN = 'RRRFFRFFF';
export const EVEN_ODD_ENTRY_PATTERN = 'EEEOEEEEOOO';
export const OVER_UNDER_ENTRY_PATTERN = Array.from(RISE_FALL_ENTRY_PATTERN, direction =>
    direction === 'R' ? 'Ov' : 'U',
).join(' ');

const lastDigitOf = (price: number, pipSize: number): number => {
    const formatted = price.toFixed(pipSize);
    return Number(formatted[formatted.length - 1]);
};

export const getRiseFallSequence = (prices: number[]): string => {
    const latestPrices = prices.slice(-(RISE_FALL_ENTRY_PATTERN.length + 1));
    return latestPrices.slice(1).map((price, index) => {
        if (price > latestPrices[index]) return 'R';
        if (price < latestPrices[index]) return 'F';
        return '-';
    }).join('');
};

export const getEvenOddSequence = (prices: number[], pipSize: number): string =>
    prices
        .slice(-EVEN_ODD_ENTRY_PATTERN.length)
        .map(price => lastDigitOf(price, pipSize) % 2 === 0 ? 'E' : 'O')
        .join('');

export const getOverUnderSequence = (
    prices: number[],
    pipSize: number,
    barrier: number,
): string =>
    prices
        .slice(-RISE_FALL_ENTRY_PATTERN.length)
        .map(price => {
            const digit = lastDigitOf(price, pipSize);
            if (digit > barrier) return 'Ov';
            if (digit < barrier) return 'U';
            return '=';
        })
        .join(' ');

export const matchesRiseFallEntryPattern = (prices: number[]): boolean => {
    const requiredPrices = RISE_FALL_ENTRY_PATTERN.length + 1;
    if (prices.length < requiredPrices) return false;

    return getRiseFallSequence(prices) === RISE_FALL_ENTRY_PATTERN;
};

export const matchesEvenOddEntryPattern = (prices: number[], pipSize: number): boolean => {
    if (prices.length < EVEN_ODD_ENTRY_PATTERN.length) return false;

    return getEvenOddSequence(prices, pipSize) === EVEN_ODD_ENTRY_PATTERN;
};

export const matchesOverUnderEntryPattern = (
    prices: number[],
    pipSize: number,
    barrier: number,
): boolean => {
    if (prices.length < RISE_FALL_ENTRY_PATTERN.length) return false;

    const expectedSequence = OVER_UNDER_ENTRY_PATTERN.replace(/Ov/g, 'O').replace(/U/g, 'U');
    const actualSequence = getOverUnderSequence(prices, pipSize, barrier)
        .replace(/Ov/g, 'O')
        .replace(/U/g, 'U')
        .replace(/=/g, '-');

    return actualSequence === expectedSequence;
};
