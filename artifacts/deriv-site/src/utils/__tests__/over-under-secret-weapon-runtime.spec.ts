import * as BlocklyNamespace from 'blockly';
import * as BlocklyJavaScriptNamespace from 'blockly/javascript';
import fs from 'node:fs';
import path from 'node:path';
import { configureOverUnderBotXml } from '../bot-patch';

jest.mock('@/external/bot-skeleton/scratch/utils', () => ({
    modifyContextMenu: jest.fn(),
    runIrreversibleEvents: (callback: () => void) => callback(),
}));

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values: Record<string, string> = {}) =>
        text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`),
}));

describe('Over/Under Secret Weapon Blockly runtime', () => {
    let Blockly: typeof BlocklyNamespace.default;
    let javascriptGenerator: typeof BlocklyJavaScriptNamespace.javascriptGenerator;

    beforeAll(async () => {
        Blockly = (BlocklyNamespace.default ?? BlocklyNamespace) as typeof BlocklyNamespace.default;
        javascriptGenerator = BlocklyJavaScriptNamespace.javascriptGenerator;
        Blockly.Colours = {
            Base: { colour: '#4c97ff', colourSecondary: '#3373cc', colourTertiary: '#2855a6' },
            RootBlock: { colour: '#0f6b78', colourSecondary: '#0b4d56', colourTertiary: '#08343a' },
            Special1: { colour: '#8b5cf6', colourSecondary: '#6d28d9', colourTertiary: '#4c1d95' },
            Special2: { colour: '#f59e0b', colourSecondary: '#d97706', colourTertiary: '#92400e' },
            Special3: { colour: '#10b981', colourSecondary: '#059669', colourTertiary: '#047b4e' },
            Special4: { colour: '#ef4444', colourSecondary: '#dc2626', colourTertiary: '#991b1b' },
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
            Miscellaneous: 'Miscellaneous',
        };
        Blockly.JavaScript = {
            ...BlocklyJavaScriptNamespace,
            javascriptGenerator,
        } as typeof Blockly.JavaScript;
        window.Blockly = Blockly;
        await import('blockly/blocks');
        await import('@/external/bot-skeleton/scratch/blocks');
    });

    it('imports and generates a complete immediate-run #21 bot without undefined fields', () => {
        const templatePath = path.resolve(__dirname, '../../../public/bots/OverUnder_Signal_Bot.xml');
        const xml = fs.readFileSync(templatePath, 'utf8');
        const configured = configureOverUnderBotXml(xml, {
            mode: 'MACD_OVER_4',
            barrier: 4,
            stake: 0.35,
            takeProfit: 15,
            stopLoss: 50,
            martingale: 2,
        });
        const workspace = new Blockly.Workspace();

        try {
            Blockly.Xml.clearWorkspaceAndLoadFromXml(
                Blockly.utils.xml.textToDom(new XMLSerializer().serializeToString(configured.documentElement)),
                workspace,
            );
            javascriptGenerator.init(workspace);
            (Blockly.JavaScript as any).variableDB_ = (javascriptGenerator as any).nameDB_;

            const generated = javascriptGenerator.workspaceToCode(workspace);
            expect(generated).toContain('Bot.purchase');
            expect(generated).not.toContain('undefined');
            expect(workspace.getVariableById('ou_ep_id')).toBeNull();
            expect(workspace.getAllBlocks(false).some(block => block.id === 'ou_scan_notify')).toBe(false);
        } finally {
            workspace.dispose();
        }
    });
});
