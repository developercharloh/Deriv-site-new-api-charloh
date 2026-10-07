import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

const generator = () => window.Blockly.JavaScript.javascriptGenerator;
const colours = () => ({
    colour: window.Blockly.Colours.Base.colour,
    colourSecondary: window.Blockly.Colours.Base.colourSecondary,
    colourTertiary: window.Blockly.Colours.Base.colourTertiary,
});

window.Blockly.Blocks.even_odd_strike_eagle_virtual_hook_settings = {
    init() {
        this.jsonInit({
            message0: localize('Even Odd Strike Eagle · Virtual Hook'),
            message1: localize(
                'Enable live trading after %1 consecutive virtual losses'
            ),
            args1: [{ type: 'input_value', name: 'LOSS_THRESHOLD', check: 'Number' }],
            previousStatement: null,
            nextStatement: null,
            inputsInline: false,
            ...colours(),
            tooltip: localize(
                'Qualify the active Even/Odd side with this many consecutive Virtual Hook losses. Live trading then continues on that side. The separate Switch After setting controls how many real wins trigger a side change.'
            ),
        });
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.even_odd_strike_eagle_virtual_hook_settings =
    block => {
        const js = generator();
        const lossThreshold = js.valueToCode(block, 'LOSS_THRESHOLD', js.ORDER_ATOMIC) || '3';
        return `Bot.configureEvenOddStrikeEagleVirtualHook(${lossThreshold});\n`;
    };

window.Blockly.Blocks.even_odd_strike_eagle_virtual_hook_gate = {
    init() {
        this.jsonInit({
            message0: localize('Virtual Hook ready for Even/Odd side %1'),
            args0: [{ type: 'input_value', name: 'SIDE' }],
            output: 'Boolean',
            inputsInline: true,
            ...colours(),
            tooltip: localize(
                'Returns true only after the selected Even or Odd side has reached the configured consecutive virtual-loss threshold.'
            ),
        });
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.even_odd_strike_eagle_virtual_hook_gate =
    block => {
        const js = generator();
        const side = js.valueToCode(block, 'SIDE', js.ORDER_ATOMIC) || '"A"';
        return [
            `Bot.checkEvenOddStrikeEagleVirtualHook(${side}, "even-odd-strike-eagle")`,
            js.ORDER_FUNCTION_CALL,
        ];
    };
