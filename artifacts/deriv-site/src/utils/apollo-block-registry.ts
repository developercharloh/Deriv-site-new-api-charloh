// ─── Apollo block registry ────────────────────────────────────────────────────
//
// Apollo blocks are not part of Deriv's stock DBot Blockly toolbox. These
// definitions are the native equivalents used by custom runners so an Apollo
// XML export can be executed without loading unsupported block types into
// Blockly.

export type ApolloPurchaseType =
    | 'DIGITEVEN'
    | 'DIGITODD'
    | 'DIGITOVER'
    | 'DIGITUNDER';

export interface ApolloBlockDefinition {
    type: string;
    role: 'condition' | 'purchase';
    fields: readonly string[];
    description: string;
}

export const APOLLO_BLOCK_REGISTRY: Readonly<Record<string, ApolloBlockDefinition>> = {
    last_digits_condition: {
        type: 'last_digits_condition',
        role: 'condition',
        fields: ['CONDITION', 'N', 'COMPARE_VALUE'],
        description: 'Evaluates parity or a threshold across the latest digits.',
    },
    apollo_purchase2: {
        type: 'apollo_purchase2',
        role: 'purchase',
        fields: ['PURCHASE_LIST', 'PREDICTION'],
        description: 'Places a native one-tick digit contract.',
    },
};

export function isRegisteredApolloBlock(type: string): boolean {
    return Object.prototype.hasOwnProperty.call(APOLLO_BLOCK_REGISTRY, type);
}

export interface ApolloPurchaseSpec {
    blockType: 'apollo_purchase2';
    purchaseType: ApolloPurchaseType;
    contractType: ApolloPurchaseType;
    barrier: string | null;
    label: string;
}

/**
 * Resolves the PURCHASE_LIST/PREDICTION values from apollo_purchase2 into the
 * contract payload accepted by DTraderEngine.
 */
export function resolveApolloPurchase(
    purchaseType: string,
    prediction?: number,
): ApolloPurchaseSpec | null {
    switch (purchaseType.toUpperCase()) {
        case 'DIGITEVEN':
            return {
                blockType: 'apollo_purchase2',
                purchaseType: 'DIGITEVEN',
                contractType: 'DIGITEVEN',
                barrier: null,
                label: 'EVEN',
            };
        case 'DIGITODD':
            return {
                blockType: 'apollo_purchase2',
                purchaseType: 'DIGITODD',
                contractType: 'DIGITODD',
                barrier: null,
                label: 'ODD',
            };
        case 'DIGITOVER': {
            const barrier = Number.isInteger(prediction) ? prediction : 4;
            return {
                blockType: 'apollo_purchase2',
                purchaseType: 'DIGITOVER',
                contractType: 'DIGITOVER',
                barrier: String(Math.min(9, Math.max(0, barrier))),
                label: `OVER ${Math.min(9, Math.max(0, barrier))}`,
            };
        }
        case 'DIGITUNDER': {
            const barrier = Number.isInteger(prediction) ? prediction : 5;
            return {
                blockType: 'apollo_purchase2',
                purchaseType: 'DIGITUNDER',
                contractType: 'DIGITUNDER',
                barrier: String(Math.min(9, Math.max(0, barrier))),
                label: `UNDER ${Math.min(9, Math.max(0, barrier))}`,
            };
        }
        default:
            return null;
    }
}