import * as BlocklyNamespace from 'blockly';
import * as BlocklyJavaScriptNamespace from 'blockly/javascript';
import { setWorkspaceBotTemplateIdentity } from '@/utils/bot-template-scope';

jest.mock('../../utils', () => ({
    modifyContextMenu: jest.fn(),
}));

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
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
        };
        Blockly.Categories = { Tick_Analysis: 'Tick Analysis' } as typeof Blockly.Categories;
        Blockly.JavaScript = {
            ...BlocklyJavaScriptNamespace,
            javascriptGenerator,
        } as typeof Blockly.JavaScript;
        window.Blockly = Blockly;

        await import('blockly/blocks');
        await import('../Custom/analysis_blocks');
    });

    it('initializes the menu block and generates the configured tick window', () => {
        const workspace = new Blockly.Workspace();
        javascriptGenerator.init(workspace);

        const gate = workspace.newBlock('smart_over2_entry_gate');
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
});