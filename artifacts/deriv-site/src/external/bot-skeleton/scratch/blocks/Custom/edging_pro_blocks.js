import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

window.Blockly.Blocks.edging_pro_strategy = {
    init() {
        this.jsonInit({
            message0: localize('Edging pro · Last X digits %1 · stake per leg %2'),
            args0: [
                {
                    type: 'field_number',
                    name: 'LAST_X',
                    value: 4,
                    min: 1,
                    max: 1000,
                    precision: 1,
                },
                {
                    type: 'field_number',
                    name: 'STAKE',
                    value: 0.5,
                    min: 0.35,
                    precision: 0.01,
                },
            ],
            message1: localize('Over %1 · Under %2 · Martingale %3×'),
            args1: [
                {
                    type: 'field_number',
                    name: 'OVER_PREDICTION',
                    value: 5,
                    min: 1,
                    max: 8,
                    precision: 1,
                },
                {
                    type: 'field_number',
                    name: 'UNDER_PREDICTION',
                    value: 4,
                    min: 0,
                    max: 8,
                    precision: 1,
                },
                {
                    type: 'field_number',
                    name: 'MARTINGALE',
                    value: 2,
                    min: 1,
                    precision: 0.1,
                },
            ],
            message2: localize('Take Profit %1 · Stop Loss %2'),
            args2: [
                {
                    type: 'field_number',
                    name: 'TAKE_PROFIT',
                    value: 10,
                    min: 0.01,
                    precision: 0.01,
                },
                {
                    type: 'field_number',
                    name: 'STOP_LOSS',
                    value: 30,
                    min: 0.01,
                    precision: 0.01,
                },
            ],
            message3: localize('Virtual Hook %1 · real pair after %2 consecutive losses'),
            args3: [
                {
                    type: 'field_checkbox',
                    name: 'USE_VIRTUAL_HOOK',
                    checked: true,
                },
                {
                    type: 'field_number',
                    name: 'VIRTUAL_LOSS_THRESHOLD',
                    value: 2,
                    min: 1,
                    max: 100,
                    precision: 1,
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'Runs paired one-tick Digit Over and Digit Under contracts when the latest X digits are all 4 or 5. The Run button reads these settings from the workspace.'
            ),
            category: window.Blockly.Categories.Tick_Analysis,
        });
        this.setInputsInline(false);
    },
    meta() {
        return {
            display_name: localize('Edging pro paired-digit strategy'),
            description: localize(
                'Starts the Edging pro strategy from DBot Builder using the settings stored in this block.'
            ),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

// The Run panel routes workspaces containing this block to the paired-contract
// runtime instead of the standard single-contract Blockly purchase loop.
window.Blockly.JavaScript.javascriptGenerator.forBlock.edging_pro_strategy = () => '';