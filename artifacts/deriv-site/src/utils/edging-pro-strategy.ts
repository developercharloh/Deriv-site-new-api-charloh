export type EdgingProConditionStatus = 'WAITING' | 'MET' | 'NOT MET';

export interface EdgingProEntryAssessment {
    status: EdgingProConditionStatus;
    lookback: number;
    digits: number[];
}

export interface EdgingProPairQuote {
    askPrice: number;
    payout: number;
}

export function assessEdgingProEntry(digits: number[], lookback: number): EdgingProEntryAssessment {
    const count = Number.isFinite(lookback) ? Math.max(1, Math.floor(lookback)) : 4;
    const recent = digits.slice(-count);
    if (recent.length < count) {
        return { status: 'WAITING', lookback: count, digits: recent };
    }
    const matches = recent.every(digit => Number.isInteger(digit) && digit >= 4 && digit <= 5);
    return { status: matches ? 'MET' : 'NOT MET', lookback: count, digits: recent };
}

export function calculateEdgingProPairProfit(
    settlementDigit: number,
    overPrediction: number,
    underPrediction: number,
    over: EdgingProPairQuote,
    under: EdgingProPairQuote
): number {
    const overProfit =
        settlementDigit > overPrediction ? over.payout - over.askPrice : -over.askPrice;
    const underProfit =
        settlementDigit < underPrediction ? under.payout - under.askPrice : -under.askPrice;
    return Number((overProfit + underProfit).toFixed(2));
}