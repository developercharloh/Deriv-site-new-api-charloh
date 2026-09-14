import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

const generator = () => window.Blockly.JavaScript.javascriptGenerator;

const numberInput = (block, name, fallback) =>
    generator().valueToCode(block, name, generator().ORDER_ATOMIC) || fallback;

const blockColours = () => ({
    colour: window.Blockly.Colours.Special1.colour,
    colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
    colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
});

window.Blockly.Blocks.vh_settings = {
    init() {
        this.jsonInit(this.definition());
        this.setInputsInline(true);
    },
    definition() {
        return {
            message0: localize('set Virtual Hook Settings'),
            message1: localize('No. of Virtual losses %1'),
            message2: localize('No. of Wins on Real Trades %1'),
            args0: [],
            args1: [
                {
                    type: 'input_value',
                    name: 'MAX_STEPS',
                    check: 'Number',
                },
            ],
            args2: [
                {
                    type: 'input_value',
                    name: 'MIN_TRADES',
                    check: 'Number',
                },
            ],
            previousStatement: null,
            nextStatement: null,
            ...blockColours(),
            tooltip: localize('Configure the virtual loss and real-trade win thresholds.'),
            category: 'virtual_hook_switcher',
        };
    },
    meta() {
        return {
            display_name: localize('Virtual Hook'),
            description: localize('Sets the number of virtual losses and real-trade wins used by Virtual Hook.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_settings = block => {
    const maxSteps = numberInput(block, 'MAX_STEPS', '3');
    const minTrades = numberInput(block, 'MIN_TRADES', '1');
    return `Bot.setVirtualHookSettings(${maxSteps}, ${minTrades});\n`;
};

window.Blockly.Blocks.enable_virtual_hook = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Enable/Disable VH %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'ENABLE_VIRTUAL_HOOK',
                    options: [
                        [localize('enable'), 'enable'],
                        [localize('disable'), 'disable'],
                    ],
                },
            ],
            previousStatement: null,
            ...blockColours(),
            tooltip: localize('Enable or disable Virtual Hook.'),
            category: 'virtual_hook_switcher',
        };
    },
    meta() {
        return {
            display_name: localize('Virtual Hook Enabler'),
            description: localize('Enables or disables Virtual Hook.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.enable_virtual_hook = block => {
    const enabled = block.getFieldValue('ENABLE_VIRTUAL_HOOK') === 'enable';
    return `Bot.enableVirtualHook(${enabled});\n`;
};

window.Blockly.Blocks.virtual_hook_status = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('VirtualHook Status'),
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            ...blockColours(),
            tooltip: localize('Returns whether Virtual Hook is enabled.'),
            category: 'virtual_hook_switcher',
        };
    },
    meta() {
        return {
            display_name: localize('Virtual Hook Status'),
            description: localize('Returns whether Virtual Hook is active.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.virtual_hook_status = () => [
    'Bot.isVirtualHookEnabled()',
    generator().ORDER_FUNCTION_CALL,
];
