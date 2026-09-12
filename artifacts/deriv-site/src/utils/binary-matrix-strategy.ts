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
}

function lastDigitsMatch(digits: number[], count: number, predicate: (digit: number) => boolean): boolean {
    if (digits.length < count) return false;
    return digits.slice(-count).every(predicate);
}

/**
 * Executes the four-condition last_digits_condition chain from the XML.
 * Conditions are intentionally ordered and short-circuit exactly like the
 * Blockly elseif chain.
 */
export function evaluateBinaryMatrix(digits: readonly number[]): BinaryMatrixDecision | null {
    const normalized = digits
        .map(Number)
        .filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);

    let direction: BinaryMatrixDirection | null = null;
    let purchase: ApolloPurchaseSpec | null = null;
    let reason = '';

    if (lastDigitsMatch(normalized, 4, digit => digit % 2 === 1)) {
        direction = 0;
        purchase = resolveApolloPurchase('DIGITEVEN');
        reason = 'Last 4 digits are all odd → EVEN';
    } else if (lastDigitsMatch(normalized, 4, digit => digit % 2 === 0)) {
        direction = 1;
        purchase = resolveApolloPurchase('DIGITODD');
        reason = 'Last 4 digits are all even → ODD';
    } else if (lastDigitsMatch(normalized, 3, digit => digit <= 3)) {
        direction = 4;
        purchase = resolveApolloPurchase('DIGITOVER', 4);
        reason = 'Last 3 digits are ≤ 3 → OVER 4';
    } else if (lastDigitsMatch(normalized, 3, digit => digit >= 6)) {
        direction = 5;
        purchase = resolveApolloPurchase('DIGITUNDER', 5);
        reason = 'Last 3 digits are ≥ 6 → UNDER 5';
    }

    if (direction === null || !purchase) return null;

    return {
        ...purchase,
        direction,
        reason,
        scannedDigits: normalized.slice(-4),
    };
}