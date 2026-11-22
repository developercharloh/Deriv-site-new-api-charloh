export const RISE_FALL_ENTRY_PATTERN = 'RRRFFRFFF';
export const EVEN_ODD_ENTRY_PATTERN = 'EEEOEEEEOOO';

const lastDigitOf = (price: number, pipSize: number): number => {
    const formatted = price.toFixed(pipSize);
    return Number(formatted[formatted.length - 1]);
};

export const matchesRiseFallEntryPattern = (prices: number[]): boolean => {
    const requiredPrices = RISE_FALL_ENTRY_PATTERN.length + 1;
    if (prices.length < requiredPrices) return false;

    const latestPrices = prices.slice(-requiredPrices);
    const sequence = latestPrices.slice(1).map((price, index) =>
        price > latestPrices[index] ? 'R' : 'F',
    ).join('');

    return sequence === RISE_FALL_ENTRY_PATTERN;
};

export const matchesEvenOddEntryPattern = (prices: number[], pipSize: number): boolean => {
    if (prices.length < EVEN_ODD_ENTRY_PATTERN.length) return false;

    const sequence = prices
        .slice(-EVEN_ODD_ENTRY_PATTERN.length)
        .map(price => lastDigitOf(price, pipSize) % 2 === 0 ? 'E' : 'O')
        .join('');

    return sequence === EVEN_ODD_ENTRY_PATTERN;
};
