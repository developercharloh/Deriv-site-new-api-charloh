import { restoreDropdownSelections } from '@/external/bot-skeleton/scratch/utils';
import { restoreOverUnderWorkspaceSymbol } from '../bot-patch';

jest.mock('@/external/bot-skeleton/scratch/utils', () => ({
    scheduleWorkspaceReveal: jest.fn(),
    restoreDropdownSelections: jest.fn(async (workspace: any, selections: Record<string, string[]>) => {
        const blocks = workspace.getAllBlocks(true);
        const set = (type: string, field: string, value: string) => {
            blocks.find((block: any) => block.type === type)?.setFieldValue(value, field);
        };
        set('trade_definition_market', 'MARKET_LIST', selections.MARKET_LIST[0]);
        set('trade_definition_market', 'SUBMARKET_LIST', selections.SUBMARKET_LIST[0]);
        set('trade_definition_market', 'SYMBOL_LIST', selections.SYMBOL_LIST[0]);
        set('trade_definition_tradetype', 'TRADETYPECAT_LIST', selections.TRADETYPECAT_LIST[0]);
        set('trade_definition_tradetype', 'TRADETYPE_LIST', selections.TRADETYPE_LIST[0]);
        set('trade_definition_contracttype', 'TYPE_LIST', selections.TYPE_LIST[0]);
        set('trade_definition_tradeoptions', 'DURATIONTYPE_LIST', selections.DURATIONTYPE_LIST[0]);
        selections.PURCHASE_LIST.forEach((type, index) => {
            blocks.filter((block: any) => block.getField('PURCHASE_LIST'))[index]
                ?.setFieldValue(type, 'PURCHASE_LIST');
        });
    }),
}));

jest.mock('@/external/bot-skeleton/services/api/api-helpers', () => ({
    __esModule: true,
    default: { instance: {} },
}));

const makeBlock = (type: string, fields: Record<string, string> = {}) => ({
    type,
    fields: { ...fields },
    getFieldValue(field: string) {
        return this.fields[field];
    },
    setFieldValue(value: string, field: string) {
        this.fields[field] = value;
    },
    getField(field: string) {
        return Object.hasOwn(this.fields, field) ? { getValue: () => this.fields[field] } : null;
    },
});

const makeWorkspace = (fieldsRestored = false) => {
    const blocks = [
        makeBlock('trade_definition_market', fieldsRestored ? {
            MARKET_LIST: 'synthetic_index',
            SUBMARKET_LIST: 'random_index',
            SYMBOL_LIST: '1HZ10V',
        } : {}),
        makeBlock('trade_definition_tradetype', fieldsRestored ? {
            TRADETYPECAT_LIST: 'digits',
            TRADETYPE_LIST: 'overunder',
        } : {}),
        makeBlock('trade_definition_contracttype', fieldsRestored ? { TYPE_LIST: 'both' } : {}),
        makeBlock('trade_definition_tradeoptions', fieldsRestored ? { DURATIONTYPE_LIST: 't' } : {}),
        makeBlock('purchase', { PURCHASE_LIST: '' }),
        makeBlock('purchase', { PURCHASE_LIST: '' }),
    ];
    return { getAllBlocks: () => blocks };
};

describe('bot #21 dropdown restoration', () => {
    beforeEach(() => {
        (window as any).Blockly = { Events: {} };
        jest.clearAllMocks();
    });

    it('restores and validates every dependent field before allowing #21 to be run', async () => {
        const workspace = makeWorkspace();
        await restoreOverUnderWorkspaceSymbol(workspace, '1HZ10V', {
            SYMBOL_LIST: ['1HZ10V'],
            TRADETYPECAT_LIST: ['digits'],
            TRADETYPE_LIST: ['overunder'],
            TYPE_LIST: ['both'],
            DURATIONTYPE_LIST: ['t'],
            PURCHASE_LIST: ['DIGITOVER', 'DIGITUNDER'],
        });

        expect(restoreDropdownSelections).toHaveBeenCalledWith(
            workspace,
            expect.objectContaining({
                MARKET_LIST: ['synthetic_index'],
                SUBMARKET_LIST: ['random_index'],
                SYMBOL_LIST: ['1HZ10V'],
                TRADETYPECAT_LIST: ['digits'],
                TRADETYPE_LIST: ['overunder'],
                TYPE_LIST: ['both'],
                DURATIONTYPE_LIST: ['t'],
                PURCHASE_LIST: ['DIGITOVER', 'DIGITUNDER'],
            }),
            expect.any(Object),
        );
    });

    it('keeps #21 from loading when its purchase choices could not be restored', async () => {
        const workspace = makeWorkspace(true);
        (restoreDropdownSelections as jest.Mock).mockImplementationOnce(async () => undefined);

        await expect(restoreOverUnderWorkspaceSymbol(workspace, '1HZ10V'))
            .rejects.toThrow('did not restore #21’s Over and Under purchase choices');
    });
});
