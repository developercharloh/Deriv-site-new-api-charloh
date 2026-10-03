import * as BlocklyNamespace from 'blockly';
import * as BlocklyJavaScriptNamespace from 'blockly/javascript';

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
        expect(code).toBe('Bot.checkSmartOver2Entry(6)');

        workspace.dispose();
    });
});