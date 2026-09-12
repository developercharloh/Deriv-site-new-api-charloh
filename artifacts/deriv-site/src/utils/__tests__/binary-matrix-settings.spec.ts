import { readBlocklyNumberVariable } from '@/utils/binary-matrix-settings';

describe('Binary Matrix Builder settings', () => {
    it('reads a configured number by Blockly variable name, not the internal field id', () => {
        const stakeBlock = {
            type: 'variables_set',
            getFieldValue: (field: string) => field === 'VAR' ? 'stake-variable-id' : null,
            getInputTargetBlock: (input: string) => input === 'VALUE'
                ? { getFieldValue: (field: string) => field === 'NUM' ? '50' : null }
                : null,
        };
        const workspace = {
            getAllBlocks: () => [stakeBlock],
            getVariableById: (id: string) => id === 'stake-variable-id' ? { name: 'Stake' } : null,
        };

        expect(readBlocklyNumberVariable(workspace, 'Stake', 0.5)).toBe(50);
        expect(readBlocklyNumberVariable(workspace, 'Martingale', 2)).toBe(2);
    });
});