import fs from 'fs';
import path from 'path';

import * as BlocklyNamespace from 'blockly';
import * as BlocklyJavaScriptNamespace from 'blockly/javascript';

jest.mock('../../utils', () => ({
    modifyContextMenu: jest.fn(),
}));

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values: Record<string, string> = {}) =>
        text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`),
    useTranslations: () => ({
        localize: (text: string, values: Record<string, string> = {}) =>
            text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`),
        currentLang: 'EN',
    }),
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => i18n_default_text,
    getAllowedLanguages: () => ({ EN: 'English' }),
    initializeI18n: () => undefined,
}));

describe('Rise/Fall Master Bot XML', () => {
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
            RootBlock: {
                colour: '#0f6b78',
                colourSecondary: '#0b4d56',
                colourTertiary: '#08343a',
            },
            Special1: {
                colour: '#8b5cf6',
                colourSecondary: '#6d28d9',
                colourTertiary: '#4c1d95',
            },
            Special2: {
                colour: '#f59e0b',
                colourSecondary: '#d97706',
                colourTertiary: '#92400e',
            },
            Special3: {
                colour: '#10b981',
                colourSecondary: '#059669',
                colourTertiary: '#047857',
            },
            Special4: {
                colour: '#ef4444',
                colourSecondary: '#dc2626',
                colourTertiary: '#991b1b',
            },
        };
        Blockly.Categories = {
            Indicators: 'Indicators',
            Before_Purchase: 'Before Purchase',
            Tick_Analysis: 'Tick Analysis',
            Logic: 'Logic',
            Text: 'Text',
            Math: 'Math',
            Lists: 'Lists',
            Variables: 'Variables',
            Functions: 'Functions',
            Advanced: 'Advanced',
            Binary: 'Binary',
            Tools: 'Tools',
            After_Purchase: 'After Purchase',
            During_Purchase: 'During Purchase',
            Trade_Definition: 'Trade Definition',
        };
        Blockly.JavaScript = {
            ...BlocklyJavaScriptNamespace,
            javascriptGenerator,
        } as typeof Blockly.JavaScript;
        window.Blockly = Blockly;
        (Blockly.Block.prototype as any).initSvg = jest.fn();
        (Blockly.Block.prototype as any).queueRender = jest.fn();

        await import('blockly/blocks');
        await import('../index');
    });

    it('imports and generates the live indicator and safety gate', () => {
        const xmlPath = path.resolve(__dirname, '../../../../../../public/bots/Rise_Fall_Master_Bot.xml');
        const xmlText = fs.readFileSync(xmlPath, 'utf8');
        const sourceDom = Blockly.utils.xml.textToDom(xmlText);

        const workspace = new Blockly.Workspace();
        expect(() => Blockly.Xml.domToWorkspace(sourceDom, workspace)).not.toThrow();

        const blockTypes = new Set(workspace.getAllBlocks(false).map(block => block.type));
        [
            'indicator_ready',
            'no_active_contract',
            'consecutive_loss_gate',
            'payout_gate',
            'session_risk_gate',
            'model_confidence_gate',
            'models_agree',
            'adx_value',
            'atr_value',
            'ichimoku_value',
            'stochastic_value',
            'macd_value',
            'rsi_value',
            'bollinger_value',
            'bollinger_squeeze',
        ].forEach(type => expect(blockTypes).toContain(type));

        javascriptGenerator.init(workspace);
        (Blockly.JavaScript as any).variableDB_ = (javascriptGenerator as any).nameDB_;
        const gateBlock = workspace.getBlockById('bp_gate_if');
        expect(gateBlock).toBeDefined();
        const gateCondition = gateBlock!.getInputTargetBlock('IF0');
        expect(gateCondition).toBeDefined();
        const generatedResult = javascriptGenerator.blockToCode(gateCondition!);
        const generated = Array.isArray(generatedResult) ? generatedResult[0] : generatedResult;
        expect(generated).toContain('Bot.canOpenNewContract()');
        expect(generated).toContain('Bot.getModelConfidence');
        expect(generated).toContain('Bot.getIchimokuValue');
        expect(generated).toContain('Bot.isBollingerSqueeze');

        workspace.dispose();
    });
});