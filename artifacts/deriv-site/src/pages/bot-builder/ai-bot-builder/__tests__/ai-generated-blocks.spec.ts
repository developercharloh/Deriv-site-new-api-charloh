import * as BlocklyNamespace from 'blockly';
import * as BlocklyJavaScriptNamespace from 'blockly/javascript';
import { registerAiGeneratedBlocks } from '../ai-generated-blocks';

const definition = {
    type: 'ai_last_digits_below_threshold',
    message: 'Last %1 digits %2 %3',
    tooltip: 'Checks a comparison against the last digits.',
    method: 'checkLastDigitsCondition',
    outputType: 'Boolean',
    arguments: [
        {
            kind: 'number',
            name: 'COUNT',
            check: null,
            defaultValue: 4,
            options: [],
        },
        {
            kind: 'dropdown',
            name: 'CONDITION',
            check: null,
            defaultValue: 'LESS_THAN',
            options: [
                { label: 'below', value: 'LESS_THAN' },
                { label: 'above', value: 'GREATER_THAN' },
            ],
        },
        {
            kind: 'number',
            name: 'THRESHOLD',
            check: null,
            defaultValue: 6,
            options: [],
        },
    ],
    bindings: [
        { source: 'field', name: 'CONDITION' },
        { source: 'field', name: 'COUNT' },
        { source: 'field', name: 'THRESHOLD' },
    ],
} as const;

describe('AI-generated Blockly blocks', () => {
    it('registers a safe block and generates only its allowlisted Bot operation', () => {
        const Blockly = BlocklyNamespace as any;
        const javascriptGenerator = BlocklyJavaScriptNamespace.javascriptGenerator;
        Blockly.Colours = {
            Base: {
                colour: '#4c97ff',
                colourSecondary: '#3373cc',
                colourTertiary: '#2855a6',
            },
        };
        Blockly.Categories = { Tick_Analysis: 'Tick Analysis', Before_Purchase: 'Before Purchase' };
        Blockly.JavaScript = { ...BlocklyJavaScriptNamespace, javascriptGenerator };
        (window as any).Blockly = Blockly;

        const rollback = registerAiGeneratedBlocks([definition]);
        const workspace = new Blockly.Workspace();
        try {
            javascriptGenerator.init(workspace);
            const block = workspace.newBlock(definition.type);
            const generated = javascriptGenerator.blockToCode(block);

            expect(Blockly.Blocks[definition.type]).toBeDefined();
            expect(javascriptGenerator.forBlock[definition.type]).toEqual(expect.any(Function));
            expect(Array.isArray(generated) ? generated[0] : generated).toBe(
                'Bot.checkLastDigitsCondition("LESS_THAN", 4, 6)',
            );
            expect(() =>
                registerAiGeneratedBlocks([{ ...definition, method: 'eval' }]),
            ).toThrow('unsupported operation');
        } finally {
            workspace.dispose();
            rollback();
        }

        expect(Blockly.Blocks[definition.type]).toBeUndefined();
        expect(javascriptGenerator.forBlock[definition.type]).toBeUndefined();
    });
});
