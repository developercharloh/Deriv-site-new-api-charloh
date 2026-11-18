import * as BlocklyNamespace from 'blockly';
import * as BlocklyJavaScriptNamespace from 'blockly/javascript';

jest.mock('../../utils', () => ({
    modifyContextMenu: jest.fn(),
}));

const blockDefinitions = {
    aroon_value: 'Bot.getAroonValue',
    ichimoku_value: 'Bot.getIchimokuValue',
    adx_value: 'Bot.getAdxValue',
    atr_value: 'Bot.getAtrValue',
    stochastic_value: 'Bot.getStochasticValue',
    macd_value: 'Bot.getMacdValue',
    rsi_value: 'Bot.getRsiValue',
    bollinger_value: 'Bot.getBollingerValue',
    macd_cross: 'Bot.isMacdCross',
    over_under_indicator_signal: 'Bot.getOverUnderIndicatorSignal',
    even_odd_beast_signal: 'Bot.getEvenOddBeastSignal',
    rsi_cross: 'Bot.isRsiCross',
    bollinger_squeeze: 'Bot.isBollingerSqueeze',
    indicator_ready: 'Bot.isIndicatorReady',
    no_active_contract: 'Bot.canOpenNewContract',
    consecutive_loss_gate: 'Bot.getConsecutiveLosses',
    payout_gate: 'Bot.isPayoutAcceptable',
    session_risk_gate: 'Bot.getTotalProfit',
    model_confidence_gate: 'Bot.getModelConfidence',
    models_agree: '!==',
    model_signal: 'Bot.getModelSignal',
    model_confidence: 'Bot.getModelConfidence',
} as const;

describe('custom strategy Blockly blocks', () => {
    let Blockly: typeof BlocklyNamespace.default;
    let javascriptGenerator: typeof BlocklyJavaScriptNamespace.javascriptGenerator;

    beforeAll(async () => {
        Blockly = (BlocklyNamespace.default ?? BlocklyNamespace) as typeof BlocklyNamespace.default;
        javascriptGenerator = BlocklyJavaScriptNamespace.javascriptGenerator;

        Blockly.Colours = {
            Special1: {
                colour: '#4c97ff',
                colourSecondary: '#3373cc',
                colourTertiary: '#2855a6',
            },
            Base: {
                colour: '#4c97ff',
                colourSecondary: '#3373cc',
                colourTertiary: '#2855a6',
            },
        };
        Blockly.Categories = {
            Indicators: 'Indicators',
            Tick_Analysis: 'Tick Analysis',
            Before_Purchase: 'Before Purchase',
        };
        Blockly.JavaScript = {
            ...BlocklyJavaScriptNamespace,
            javascriptGenerator,
        } as typeof Blockly.JavaScript;
        window.Blockly = Blockly;

        await import('../Custom/strategy_blocks');
        await import('../Custom/matches_king_blocks');
    });

    it('defaults Matches King to Use Virtual Hook true, including older saved blocks', () => {
        const workspace = new Blockly.Workspace();
        try {
            Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(
                '<xml><block type="matches_king_strategy"><field name="DIGIT_COUNT">4</field></block></xml>'
            ), workspace);
            const block = workspace.getAllBlocks(false)[0];
            expect(block.getFieldValue('USE_VIRTUAL_HOOK')).toBe('TRUE');
            expect(block.getFieldValue('INITIAL_ENTRY_MODE')).toBe('IMMEDIATE');
            expect(block.getInput('MATCHES_KING_ENTRY_TIMING')?.visible).toBe(false);
            expect(block.getFieldValue('DIGIT_COUNT')).toBe('4');
            expect(block.getFieldValue('DIGIT_4')).toBe(7);
            expect(block.getInput('MATCHES_KING_VIRTUAL_HOOK')?.visible).toBe(true);
            block.setFieldValue('FALSE', 'USE_VIRTUAL_HOOK');
            expect(block.getInput('MATCHES_KING_VIRTUAL_HOOK')?.visible).toBe(false);
            expect(block.getFieldValue('VIRTUAL_LOSS_THRESHOLD')).toBe(2);
            block.setFieldValue('TRUE', 'USE_VIRTUAL_HOOK');
            expect(block.getInput('MATCHES_KING_VIRTUAL_HOOK')?.visible).toBe(true);
        } finally {
            workspace.dispose();
        }
    });

    it('preserves Matches King false when saving and reopening its Blockly settings', () => {
        const workspace = new Blockly.Workspace();
        const restored = new Blockly.Workspace();
        try {
            const block = workspace.newBlock('matches_king_strategy');
            block.setFieldValue('CANDLE_CLOSE', 'INITIAL_ENTRY_MODE');
            block.setFieldValue('6', 'VIRTUAL_LOSS_THRESHOLD');
            block.setFieldValue('FALSE', 'USE_VIRTUAL_HOOK');
            expect(block.getInput('MATCHES_KING_VIRTUAL_HOOK')?.visible).toBe(false);
            Blockly.Xml.domToWorkspace(Blockly.Xml.workspaceToDom(workspace), restored);
            const restoredBlock = restored.getAllBlocks(false)[0];
            expect(restoredBlock.getFieldValue('INITIAL_ENTRY_MODE')).toBe('CANDLE_CLOSE');
            expect(restoredBlock.getFieldValue('USE_VIRTUAL_HOOK')).toBe('FALSE');
            expect(restoredBlock.getFieldValue('VIRTUAL_LOSS_THRESHOLD')).toBe(6);
            expect(restoredBlock.getInput('MATCHES_KING_VIRTUAL_HOOK')?.visible).toBe(false);
            restoredBlock.setFieldValue('TRUE', 'USE_VIRTUAL_HOOK');
            expect(restoredBlock.getInput('MATCHES_KING_VIRTUAL_HOOK')?.visible).toBe(true);
            expect(restoredBlock.getFieldValue('VIRTUAL_LOSS_THRESHOLD')).toBe(6);
        } finally {
            workspace.dispose();
            restored.dispose();
        }
    });

    it('registers and generates code for every new strategy block', () => {
        const workspace = new Blockly.Workspace();
        javascriptGenerator.init(workspace);

        Object.entries(blockDefinitions).forEach(([type, expectedCode]) => {
            expect(Blockly.Blocks[type]).toBeDefined();
            expect(javascriptGenerator.forBlock[type]).toEqual(expect.any(Function));

            const block = workspace.newBlock(type);
            const generated = javascriptGenerator.blockToCode(block);
            const code = Array.isArray(generated) ? generated[0] : generated;

            expect(code).toEqual(expect.any(String));
            expect(code).toContain(expectedCode);
        });

        workspace.dispose();
    });

    it('keeps the standalone Even Odd Beast side automatic and emits locked signal mode', () => {
        const workspace = new Blockly.Workspace();
        javascriptGenerator.init(workspace);
        const block = workspace.newBlock('even_odd_beast_signal');

        expect(block.getFieldValue('MODE')).toBe('AUTO');
        block.setFieldValue('ODD', 'SIDE');
        block.setFieldValue('LOCKED', 'MODE');
        const generated = javascriptGenerator.blockToCode(block);
        const code = Array.isArray(generated) ? generated[0] : generated;

        expect(code).toContain("Bot.getEvenOddBeastSignal('ODD', 'LOCKED')");
        workspace.dispose();
    });

    it('allows every directional primary signal regardless of secondary direction', () => {
        const workspace = new Blockly.Workspace();
        javascriptGenerator.init(workspace);

        const makeAgreementBlock = (primary: string, secondary: string) => {
            const agreement = workspace.newBlock('models_agree');
            const primaryBlock = workspace.newBlock('text');
            const secondaryBlock = workspace.newBlock('text');
            primaryBlock.setFieldValue(primary, 'TEXT');
            secondaryBlock.setFieldValue(secondary, 'TEXT');
            agreement.getInput('PRIMARY')?.connection?.connect(primaryBlock.outputConnection!);
            agreement.getInput('SECONDARY')?.connection?.connect(secondaryBlock.outputConnection!);
            const generated = javascriptGenerator.blockToCode(agreement);
            return Array.isArray(generated) ? generated[0] : generated;
        };

        expect(Function(`return ${makeAgreementBlock('CALL', 'WAIT')}`)()).toBe(true);
        expect(Function(`return ${makeAgreementBlock('PUT', 'WAIT')}`)()).toBe(true);
        expect(Function(`return ${makeAgreementBlock('CALL', 'PUT')}`)()).toBe(true);
        expect(Function(`return ${makeAgreementBlock('PUT', 'CALL')}`)()).toBe(true);
        expect(Function(`return ${makeAgreementBlock('WAIT', 'CALL')}`)()).toBe(false);
        expect(Function(`return ${makeAgreementBlock('WAIT', 'PUT')}`)()).toBe(false);

        workspace.dispose();
    });

    it('initializes each block with all declared inputs without Blockly errors', () => {
        const workspace = new Blockly.Workspace();
        javascriptGenerator.init(workspace);

        Object.keys(blockDefinitions).forEach(type => {
            const block = workspace.newBlock(type);

            expect(block.isEnabled()).toBe(true);
            expect(block.outputConnection || block.previousConnection || block.nextConnection).toBeTruthy();
        });

        workspace.dispose();
    });
});