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
    rsi_cross: 'Bot.isRsiCross',
    bollinger_squeeze: 'Bot.isBollingerSqueeze',
    indicator_ready: 'Bot.isIndicatorReady',
    no_active_contract: 'Bot.canOpenNewContract',
    consecutive_loss_gate: 'Bot.getConsecutiveLosses',
    payout_gate: 'Bot.isPayoutAcceptable',
    session_risk_gate: 'Bot.getTotalProfit',
    model_confidence_gate: 'Bot.getModelConfidence',
    models_agree: '===',
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
            Base: {
                colour: '#4c97ff',
                colourSecondary: '#3373cc',
                colourTertiary: '#2855a6',
            },
        };
        Blockly.Categories = {
            Indicators: 'Indicators',
            Before_Purchase: 'Before Purchase',
        };
        Blockly.JavaScript = {
            ...BlocklyJavaScriptNamespace,
            javascriptGenerator,
        } as typeof Blockly.JavaScript;
        window.Blockly = Blockly;

        await import('../Custom/strategy_blocks');
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