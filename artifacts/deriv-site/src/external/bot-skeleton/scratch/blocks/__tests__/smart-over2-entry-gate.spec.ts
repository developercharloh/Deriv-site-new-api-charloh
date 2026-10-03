import * as BlocklyNamespace from 'blockly';
import * as BlocklyJavaScriptNamespace from 'blockly/javascript';
import { setWorkspaceBotTemplateIdentity } from '@/utils/bot-template-scope';

jest.mock('../../utils', () => ({
    excludeOptionFromContextMenu: jest.fn(),
    modifyContextMenu: jest.fn(),
    runIrreversibleEvents: jest.fn(callback => callback()),
}));

jest.mock('../../../services/api/api-helpers', () => ({
    __esModule: true,
    default: { instance: null },
}));

jest.mock('../../dbot-store', () => ({
    __esModule: true,
    default: { instance: { dashboard: { setBotBuilderSymbol: jest.fn() } } },
}));

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values: Record<string, string> = {}) =>
        Object.entries(values).reduce(
            (localized, [key, value]) => localized.replace(`{{ ${key} }}`, value),
            text
        ),
}));

describe('Smart Over 2 Blockly entry gate', () => {
    let Blockly: typeof BlocklyNamespace.default;
    let javascriptGenerator: typeof BlocklyJavaScriptNamespace.javascriptGenerator;

    beforeAll(async () => {
        Blockly = (BlocklyNamespace.default ?? BlocklyNamespace) as typeof BlocklyNamespace.default;
        javascriptGenerator = BlocklyJavaScriptNamespace.javascriptGenerator;
        Blockly.Colours = {
            Base: {
                colour: '#4c97ff',
                colourSecondary: '#3373cc',
                colourTertiary: '#2855a6',
            },
            Special1: {
                colour: '#4c97ff',
                colourSecondary: '#3373cc',
                colourTertiary: '#2855a6',
            },
        };
        Blockly.Categories = { Tick_Analysis: 'Tick Analysis' } as typeof Blockly.Categories;
        Blockly.JavaScript = {
            ...BlocklyJavaScriptNamespace,
            javascriptGenerator,
        } as typeof Blockly.JavaScript;
        window.Blockly = Blockly;

        await import('blockly/blocks');
        await import('../Custom/analysis_blocks');
        await import('../Binary/Trade Definition/trade_definition_market');
        await import('../Binary/Trade Definition/trade_definition_tradetype');
        await import('../Binary/Trade Definition/trade_definition_restartbuysell');
        await import('../Binary/Trade Definition/trade_definition_restartonerror');
    });

    it('initializes the menu block and generates the configured tick window', () => {
        const workspace = new Blockly.Workspace();
        javascriptGenerator.init(workspace);

        const gate = workspace.newBlock('smart_over2_entry_gate');
        expect(gate.getInputsInline()).toBe(false);
        const count = workspace.newBlock('math_number');
        count.setFieldValue('6', 'NUM');
        gate.getInput('COUNT')?.connection?.connect(count.outputConnection!);

        const generated = javascriptGenerator.blockToCode(gate);
        const code = Array.isArray(generated) ? generated[0] : generated;

        expect(gate.isEnabled()).toBe(true);
        expect(code).toBe('Bot.checkSmartOver2Entry(6, null)');

        setWorkspaceBotTemplateIdentity(workspace, 'matches-signal');
        const unrelatedGenerated = javascriptGenerator.blockToCode(gate);
        const unrelatedCode = Array.isArray(unrelatedGenerated) ? unrelatedGenerated[0] : unrelatedGenerated;
        expect(unrelatedCode).toBe('Bot.checkSmartOver2Entry(6, null)');

        setWorkspaceBotTemplateIdentity(workspace, 'smart-over-2');
        const smartOver2Generated = javascriptGenerator.blockToCode(gate);
        const smartOver2Code = Array.isArray(smartOver2Generated) ? smartOver2Generated[0] : smartOver2Generated;
        expect(smartOver2Code).toBe('Bot.checkSmartOver2Entry(6, "smart-over-2")');

        setWorkspaceBotTemplateIdentity(workspace, 'Rise_Fall_Master_Bot');
        const riseFallGenerated = javascriptGenerator.blockToCode(gate);
        const riseFallCode = Array.isArray(riseFallGenerated) ? riseFallGenerated[0] : riseFallGenerated;
        expect(riseFallCode).toBe('Bot.checkSmartOver2Entry(6, "rise-fall-master")');

        workspace.dispose();
    });

    it('keeps shared trade settings on short rows without renaming saved fields', () => {
        const workspace = new Blockly.Workspace();
        const blockRows = [
            ['trade_definition_market', 3, ['MARKET_LIST', 'SUBMARKET_LIST', 'SYMBOL_LIST']],
            ['trade_definition_tradetype', 2, ['TRADETYPECAT_LIST', 'TRADETYPE_LIST']],
            ['trade_definition_restartbuysell', 2, ['TIME_MACHINE_ENABLED']],
            ['trade_definition_restartonerror', 2, ['RESTARTONERROR']],
        ] as const;

        blockRows.forEach(([type, rowCount, fieldNames]) => {
            const block = workspace.newBlock(type);
            expect(block.inputList).toHaveLength(rowCount);
            fieldNames.forEach(fieldName => expect(block.getField(fieldName)).not.toBeNull());
        });

        workspace.dispose();
    });
});