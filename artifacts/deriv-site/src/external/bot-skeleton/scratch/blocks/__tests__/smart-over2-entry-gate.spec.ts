import * as BlocklyNamespace from 'blockly';
import * as BlocklyJavaScriptNamespace from 'blockly/javascript';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setWorkspaceBotTemplateIdentity } from '@/utils/bot-template-scope';
import { getMissingRequiredBlocks, hasAllRequiredBlocks } from '@/external/bot-skeleton/utils/workspace';

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

    it('registers reusable recovery gate, purchase, and settlement blocks', () => {
        const workspace = new Blockly.Workspace();
        javascriptGenerator.init(workspace);
        setWorkspaceBotTemplateIdentity(workspace, 'smart-over-2');

        const gate = workspace.newBlock('smart_over2_recovery_gate');
        const lookbackInputIndex = gate.inputList.findIndex(input => input.name === 'COUNT');
        const analysisInputIndex = gate.inputList.findIndex(input => input.name === 'ANALYSIS_COUNT');
        const martingaleInputIndex = gate.inputList.findIndex(input => input.name === 'MARTINGALE');
        const settingInputs = [
            'USE_MARTINGALE',
            'OVER_PREDICTION',
            'RECOVERY_PREDICTION',
            'USE_VIRTUAL_HOOK',
            'MAX_VIRTUAL_LOSSES',
            'TARGET_PROFIT',
            'STOP_LOSS',
        ];
        expect(gate.getInputsInline()).toBe(false);
        expect(lookbackInputIndex).toBeGreaterThanOrEqual(0);
        expect(analysisInputIndex).toBeGreaterThan(lookbackInputIndex);
        expect(martingaleInputIndex).toBeGreaterThan(analysisInputIndex);
        settingInputs.forEach(inputName => expect(gate.getInput(inputName)).not.toBeNull());
        expect(
            gate
                .getInput('MARTINGALE')
                ?.fieldRow.map(field => field.getText())
                .join('')
                .trim()
        ).toBe('Martingale');
        const generatedGate = javascriptGenerator.blockToCode(gate);
        expect(Array.isArray(generatedGate) ? generatedGate[0] : generatedGate).toBe(
            'Bot.checkSmartOver2Recovery(4, 100, "smart-over-2", 1.2, true, 2, 5, false, 2, 0, 0)'
        );

        const purchase = workspace.newBlock('smart_over2_recovery_purchase');
        expect(javascriptGenerator.blockToCode(purchase)).toBe(
            'Bot.purchaseSmartOver2Recovery("smart-over-2");\n'
        );

        const settlement = workspace.newBlock('smart_over2_recovery_settlement');
        expect(javascriptGenerator.blockToCode(settlement)).toBe(
            'Bot.completeSmartOver2Recovery("smart-over-2");\n'
        );

        workspace.dispose();
    });

    it('accepts the Smart Over 2 recovery purchase as the mandatory Purchase block', () => {
        const blocks = [
            { type: 'trade_definition_tradeoptions' },
            { type: 'trade_definition' },
            { type: 'before_purchase' },
            { type: 'smart_over2_recovery_purchase' },
        ];
        const requiredBlockTypes = [
            'trade_definition_tradeoptions',
            'trade_definition',
            'purchase',
            'before_purchase',
        ];

        expect(getMissingRequiredBlocks(blocks, requiredBlockTypes)).toEqual([]);

        const previousWorkspace = (Blockly as any).derivWorkspace;
        (Blockly as any).derivWorkspace = { getAllBlocks: () => blocks };
        try {
            expect(hasAllRequiredBlocks()).toBe(true);
        } finally {
            (Blockly as any).derivWorkspace = previousWorkspace;
        }
    });

    it('uses the recovery blocks without changing the bot duration or stake', () => {
        const xml = readFileSync(
            resolve(__dirname, '../../../../../../public/bots/Smart_Over_2_Bot.xml'),
            'utf8'
        );

        ['smart_over2_recovery_gate', 'smart_over2_recovery_purchase', 'smart_over2_recovery_settlement'].forEach(
            type => {
                expect(xml).toContain(`<block type="${type}"`);
                expect(Blockly.Blocks[type]).toBeDefined();
            }
        );
        expect(xml).toMatch(/<field name="DURATIONTYPE_LIST">t<\/field>/);
        expect(xml).toMatch(/<field name="NUM">1<\/field>/);
        expect(xml).toMatch(/<field name="NUM">0\.5<\/field>/);
        expect(xml).toMatch(/<field name="NUM">2<\/field>/);

        expect(xml).not.toContain('apollo_purchase2');
        expect(xml).toContain('smart_over2_recovery_purchase');
    });

    it('stores editable Smart Over 2 settings in Run once at start and connects them to the strategy', () => {
        const xml = readFileSync(
            resolve(__dirname, '../../../../../../public/bots/Smart_Over_2_Bot.xml'),
            'utf8'
        );

        const variables = [
            ['Stake', 'stake'],
            ['Martingale factor', 'martingale'],
            ['Maximum Virtual Hook losses', 'max_virtual_losses'],
            ['Use Virtual Hook', 'virtual_hook'],
            ['Target Profit', 'target_profit'],
            ['Stop Loss', 'stop_loss'],
            ['Use Martingale', 'use_martingale'],
            ['Over prediction (2)', 'over_prediction'],
            ['Virtual Hook prediction (5)', 'recovery_prediction'],
        ];
        variables.forEach(([name, id]) => {
            expect(xml).toContain(`>${name}</variable>`);
            expect(xml).toContain(`<field name="VAR" id="smart_over2_var_${id}">`);
        });
        expect(xml).toContain('<statement name="INITIALIZATION">');
        expect(xml).toContain('<field name="BOOL">FALSE</field>');
        expect(xml).toContain('<field name="BOOL">TRUE</field>');
        expect(xml).toContain('<block type="variables_get" id="smart_over2_get_stake">');
        expect(xml).toContain('<block type="variables_get" id="smart_over2_get_over_prediction">');
        expect(xml).toContain('<block type="variables_get" id="smart_over2_get_recovery_prediction">');
        expect(xml).toContain('<block type="variables_get" id="smart_over2_get_use_martingale">');
        expect(xml).toContain('<block type="variables_get" id="smart_over2_get_virtual_hook">');
        expect(xml).toContain('<block type="variables_get" id="smart_over2_get_target_profit">');
        expect(xml).toContain('<block type="variables_get" id="smart_over2_get_stop_loss">');
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