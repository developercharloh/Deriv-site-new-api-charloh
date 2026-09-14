import {
    APOLLO_BLOCK_REGISTRY,
    isRegisteredApolloBlock,
    resolveApolloPurchase,
} from '../apollo-block-registry';
import { analyzeBinaryMatrix, evaluateBinaryMatrix } from '../binary-matrix-strategy';

describe('Binary Matrix AI Apollo adapters', () => {
    it('registers both custom Apollo block types', () => {
        expect(isRegisteredApolloBlock('last_digits_condition')).toBe(true);
        expect(isRegisteredApolloBlock('apollo_purchase2')).toBe(true);
        expect(Object.keys(APOLLO_BLOCK_REGISTRY)).toEqual([
            'last_digits_condition',
            'apollo_purchase2',
        ]);
    });

    it('keeps the XML condition order and purchase mapping', () => {
        expect(evaluateBinaryMatrix([1, 3, 5, 7])?.label).toBe('EVEN');
        expect(evaluateBinaryMatrix([0, 2, 4, 8])?.label).toBe('ODD');
        expect(evaluateBinaryMatrix([8, 2, 1, 3])?.label).toBe('OVER 4');
        expect(evaluateBinaryMatrix([1, 6, 8, 9])?.label).toBe('UNDER 5');
        expect(evaluateBinaryMatrix([1, 3, 6, 8])).toBeNull();
    });

    it('uses an explicit Apollo prediction as the native barrier', () => {
        expect(resolveApolloPurchase('DIGITOVER', 4)).toMatchObject({
            contractType: 'DIGITOVER',
            barrier: '4',
            label: 'OVER 4',
        });
        expect(resolveApolloPurchase('DIGITUNDER', 5)).toMatchObject({
            contractType: 'DIGITUNDER',
            barrier: '5',
            label: 'UNDER 5',
        });
        expect(resolveApolloPurchase('UNSUPPORTED')).toBeNull();
    });

    it('keeps the active condition stable through losses', () => {
        const initial = evaluateBinaryMatrix([1, 3, 5, 7]);
        expect(initial?.label).toBe('EVEN');

        const analysis = analyzeBinaryMatrix([1, 3, 5, 2], initial);
        expect(analysis).toMatchObject({
            condition: 'ALL_ODD',
            count: 4,
            result: false,
            decision: null,
            digits: [1, 3, 5, 2],
        });
    });

    it('publishes a false analysis for a complete window with no signal', () => {
        expect(analyzeBinaryMatrix([1, 3, 5, 2])).toMatchObject({
            condition: 'ALL_ODD',
            count: 4,
            result: false,
            digits: [1, 3, 5, 2],
            decision: null,
        });
    });

    it('publishes a false partial-window analysis before a purchase window is complete', () => {
        expect(analyzeBinaryMatrix([1, 3])).toMatchObject({
            condition: 'ALL_ODD',
            count: 4,
            result: false,
            digits: [1, 3],
            decision: null,
        });
        expect(evaluateBinaryMatrix([1, 3])).toBeNull();
    });
});