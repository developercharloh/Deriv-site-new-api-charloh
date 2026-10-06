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
                'Use %1 for consecutive virtual losses and winning real trades before switching sides'
            ),
            args1: [{ type: 'input_value', name: 'SWITCH_AFTER', check: 'Number' }],
            previousStatement: null,
            nextStatement: null,
            inputsInline: false,
            ...colours(),
            tooltip: localize(
                'Wait for this many consecutive virtual losses on the active side, then keep trading that side live until this many real trades win. Live losses do not count toward the win target. After the target wins, switch sides and restart the Virtual Hook.'
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
        const switchAfter = js.valueToCode(block, 'SWITCH_AFTER', js.ORDER_ATOMIC) || '3';
        return `Bot.configureEvenOddStrikeEagleVirtualHook(${switchAfter});\n`;
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
