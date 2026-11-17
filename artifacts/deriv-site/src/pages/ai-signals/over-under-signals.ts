export type OverUnderSignalSide = 'OVER' | 'UNDER';

export const OVER_UNDER_SIGNAL_BARRIERS: Record<OverUnderSignalSide, readonly number[]> = {
    OVER: [4, 5],
    UNDER: [6, 5],
};

export interface OverUnderSignalOption {
    side: OverUnderSignalSide;
    barrier: number;
    probability: number;
    edge: number;
}

export function getOverUnderSignalOptions(digits: number[]): OverUnderSignalOption[] {
    const sampleSize = digits.length || 1;
    const options = (Object.entries(OVER_UNDER_SIGNAL_BARRIERS) as [
        OverUnderSignalSide,
        readonly number[],
    ][]).flatMap(([side, barriers]) =>
        barriers.map(barrier => {
            const probability = digits.filter(digit =>
                side === 'OVER' ? digit > barrier : digit < barrier,
            ).length / sampleSize;
            const expected = side === 'OVER' ? (9 - barrier) / 10 : barrier / 10;
            return { side, barrier, probability, edge: probability - expected };
        }),
    );

    return options.sort((a, b) => b.edge - a.edge || b.probability - a.probability);
}
