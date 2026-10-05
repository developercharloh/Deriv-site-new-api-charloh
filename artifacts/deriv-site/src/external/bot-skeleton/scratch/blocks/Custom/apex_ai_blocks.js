import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

const generator = () => window.Blockly.JavaScript.javascriptGenerator;
const colours = () => ({
    colour: window.Blockly.Colours.Base.colour,
    colourSecondary: window.Blockly.Colours.Base.colourSecondary,
    colourTertiary: window.Blockly.Colours.Base.colourTertiary,
});

window.Blockly.Blocks.apex_ai_virtual_hook_settings = {
    init() {
        this.jsonInit({
            message0: localize('Apex AI Virtual Hook · Even/Odd mode'),
            message1: localize(
                'Use Switch After %1 for both consecutive virtual losses and live trades per side'
            ),
            args1: [{ type: 'input_value', name: 'SWITCH_AFTER', check: 'Number' }],
            previousStatement: null,
            nextStatement: null,
            inputsInline: false,
            ...colours(),
            tooltip: localize(
                'Simulate one-tick Even or Odd contracts until this many consecutive losses, then trade that side live for the same number of contracts.'
            ),
        });
        modifyContextMenu(this);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.apex_ai_virtual_hook_settings = block => {
    const js = generator();
    const switchAfter = js.valueToCode(block, 'SWITCH_AFTER', js.ORDER_ATOMIC) || '3';
    return `Bot.configureApexAIVirtualHook(${switchAfter});\n`;
};

window.Blockly.Blocks.apex_ai_virtual_hook_gate = {
    init() {
        this.jsonInit({
            message0: localize('Apex AI Virtual Hook ready for side %1'),
            args0: [{ type: 'input_value', name: 'SIDE' }],
            output: 'Boolean',
            inputsInline: true,
            ...colours(),
            tooltip: localize(
                'Returns true only after the selected Even or Odd side has reached the configured consecutive virtual-loss threshold.'
            ),
        });
        modifyContextMenu(this);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.apex_ai_virtual_hook_gate = block => {
    const js = generator();
    const side = js.valueToCode(block, 'SIDE', js.ORDER_ATOMIC) || '"A"';
    return [`Bot.checkApexAIVirtualHook(${side}, "apex-ai")`, js.ORDER_FUNCTION_CALL];
};
