// ─── Binary Matrix AI native strategy ─────────────────────────────────────────
//
// This is the executable equivalent of the custom Apollo blocks in
// Binary_Matrix_AI.xml. It deliberately keeps the condition order from the
// source XML: parity checks first, then the low/high three-digit checks.

import { resolveApolloPurchase, type ApolloPurchaseSpec } from './apollo-block-registry';

export type BinaryMatrixDirection = 0 | 1 | 4 | 5;

export interface BinaryMatrixDecision extends ApolloPurchaseSpec {
    direction: BinaryMatrixDirection;
    reason: string;
    scannedDigits: number[];
    condition?: string;
    analysisCount?: number;
    compareValue?: number;
}

function lastDigitsMatch(digits: number[], count: number, predicate: (digit: number) => boolean): boolean {
    if (digits.length < count) return false;
    return digits.slice(-count).every(predicate);
}

export interface BinaryMatrixAnalysis {
    condition: string;
    count: number;
    compareValue: number;
    digits: number[];
    result: boolean;
    decision: BinaryMatrixDecision | null;
}

type MatrixCondition = {
    condition: string;
    count: number;
    compareValue: number;
    predicate: (digit: number) => boolean;
    purchase: ApolloPurchaseSpec | null;
    direction: BinaryMatrixDirection;
    label: string;
};

const MATRIX_CONDITIONS: MatrixCondition[] = [
    {
        condition: 'ALL_ODD',
        count: 4,
        compareValue: 0,
        predicate: digit => digit % 2 === 1,
        purchase: resolveApolloPurchase('DIGITEVEN'),
        direction: 0,
        label: 'EVEN',
    },
    {
        condition: 'ALL_EVEN',
        count: 4,
        compareValue: 0,
        predicate: digit => digit % 2 === 0,
        purchase: resolveApolloPurchase('DIGITODD'),
        direction: 1,
        label: 'ODD',
    },
    {
        condition: 'LESS_OR_EQUAL',
        count: 3,
        compareValue: 3,
        predicate: digit => digit <= 3,
        purchase: resolveApolloPurchase('DIGITOVER', 4),
        direction: 4,
        label: 'OVER 4',
    },
    {
        condition: 'GREATER_OR_EQUAL',
        count: 3,
        compareValue: 6,
        predicate: digit => digit >= 6,
        purchase: resolveApolloPurchase('DIGITUNDER', 5),
        direction: 5,
        label: 'UNDER 5',
    },
];

const normalizeDigits = (digits: readonly number[]): number[] =>
    digits
        .map(Number)
        .filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);

const conditionResult = (digits: number[], condition: MatrixCondition): boolean =>
    lastDigitsMatch(digits, condition.count, condition.predicate);

const makeDecision = (digits: number[], condition: MatrixCondition): BinaryMatrixDecision | null => {
    if (!condition.purchase || !conditionResult(digits, condition)) return null;

    return {
        ...condition.purchase,
        direction: condition.direction,
        reason: condition.label === 'EVEN'
            ? 'Last 4 digits are all odd → EVEN'
            : condition.label === 'ODD'
              ? 'Last 4 digits are all even → ODD'
              : condition.label === 'OVER 4'
                ? 'Last 3 digits are ≤ 3 → OVER 4'
                : 'Last 3 digits are ≥ 6 → UNDER 5',
        scannedDigits: digits.slice(-4),
        condition: condition.condition,
        analysisCount: condition.count,
        compareValue: condition.compareValue,
    };
};

/**
 * Evaluates the matrix for display and execution.
 *
 * When a decision is locked, the same condition is evaluated on every new
 * digit window. This keeps the active Binary Matrix logic stable through
 * losses; the engine explicitly clears the lock after the configured number
 * of wins.
 */
export function analyzeBinaryMatrix(
    digits: readonly number[],
    lockedDecision: BinaryMatrixDecision | null = null,
): BinaryMatrixAnalysis | null {
    const normalized = normalizeDigits(digits);
    if (normalized.length < 3) return null;

    if (lockedDecision?.condition) {
        const lockedCondition = MATRIX_CONDITIONS.find(
            condition => condition.condition === lockedDecision.condition,
        );
        if (lockedCondition) {
            const result = conditionResult(normalized, lockedCondition);
            return {
                condition: lockedCondition.condition,
                count: lockedCondition.count,
                compareValue: lockedCondition.compareValue,
                digits: normalized.slice(-lockedCondition.count),
                result,
                decision: result ? lockedDecision : null,
            };
        }
    }

    for (const condition of MATRIX_CONDITIONS) {
        const decision = makeDecision(normalized, condition);
        if (decision) {
            return {
                condition: condition.condition,
                count: condition.count,
                compareValue: condition.compareValue,
                digits: normalized.slice(-condition.count),
                result: true,
                decision,
            };
        }
    }

    const primaryCondition = MATRIX_CONDITIONS[0];
    return {
        condition: primaryCondition.condition,
        count: primaryCondition.count,
        compareValue: primaryCondition.compareValue,
        digits: normalized.slice(-primaryCondition.count),
        result: conditionResult(normalized, primaryCondition),
        decision: null,
    };
}

/**
 * Executes the four-condition last_digits_condition chain from the XML.
 * Conditions are intentionally ordered and short-circuit exactly like the
 * Blockly elseif chain.
 */
export function evaluateBinaryMatrix(digits: readonly number[]): BinaryMatrixDecision | null {
    return analyzeBinaryMatrix(digits)?.decision ?? null;
}