export interface MatchesKingBatchSettlement {
    combinedProfit: number;
    nextStakePerDigit: number;
    result: 'win' | 'loss' | 'break-even';
}

export const parseMatchesKingDigits = (input: string): number[] => {
    const tokens = input.trim().split(/[,\s]+/).filter(Boolean);
    if (!tokens.length || tokens.some(token => !/^[0-9]$/.test(token))) {
        throw new Error('Enter one or more digits from 0 to 9, separated by commas or spaces.');
    }
    const digits = [...new Set(tokens.map(Number))];
    if (digits.length > 10) throw new Error('Select no more than 10 unique digits.');
    return digits;
};

export const getMatchesKingBatchCost = (stakePerDigit: number, digitCount: number): number =>
    Number((stakePerDigit * digitCount).toFixed(2));

export const settleMatchesKingBatch = (
    contractProfits: number[],
    currentStakePerDigit: number,
    baseStakePerDigit: number,
    martingale: number
): MatchesKingBatchSettlement => {
    const combinedProfit = Number(contractProfits.reduce((sum, profit) => sum + profit, 0).toFixed(2));
    const hasWinner = contractProfits.some(profit => profit > 0);
    const allLost = contractProfits.length > 0 && contractProfits.every(profit => profit < 0);
    if (hasWinner) {
        return { combinedProfit, nextStakePerDigit: baseStakePerDigit, result: 'win' };
    }
    if (allLost) {
        return {
            combinedProfit,
            nextStakePerDigit: Number((currentStakePerDigit * martingale).toFixed(2)),
            result: 'loss',
        };
    }
    return { combinedProfit, nextStakePerDigit: currentStakePerDigit, result: 'break-even' };
};

export const matchesKingVirtualBatchWon = (settlementDigit: number, selectedDigits: number[]): boolean =>
    selectedDigits.includes(settlementDigit);
