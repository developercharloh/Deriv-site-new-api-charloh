import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

window.Blockly.Blocks.matches_king_strategy = {
    init() {
        this.jsonInit({
            message0: localize('Matches King · digits %1 · stake per digit %2'),
            args0: [
                { type: 'field_input', name: 'DIGITS', text: '1,2,3,4' },
                { type: 'field_number', name: 'STAKE', value: 0.5, min: 0.35, precision: 0.01 },
            ],
            message1: localize('Martingale %1× · Take Profit %2 · Stop Loss %3'),
            args1: [
                { type: 'field_number', name: 'MARTINGALE', value: 2, min: 1, precision: 0.1 },
                { type: 'field_number', name: 'TAKE_PROFIT', value: 10, min: 0.01, precision: 0.01 },
                { type: 'field_number', name: 'STOP_LOSS', value: 30, min: 0.01, precision: 0.01 },
            ],
            message2: localize('Virtual Hook · buy after %1 consecutive all-loss batches'),
            args2: [
                { type: 'field_number', name: 'VIRTUAL_LOSS_THRESHOLD', value: 2, min: 1, max: 100, precision: 1 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'The stake is applied separately to every selected digit. Three digits at $30 each cost $90 per batch. Any winning contract resets the per-digit stake; only an all-loss batch advances Martingale.'
            ),
            category: window.Blockly.Categories.Tick_Analysis,
        });
        this.setInputsInline(false);
    },
    meta() {
        return {
            display_name: localize('Matches King strategy'),
            description: localize('Configures a one-tick Digit Matches batch from the Run panel.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.Blocks.matches_king_purchase_condition = {
    init() {
        this.jsonInit({
            message0: localize('Matches King · evaluate the selected digit batch'),
            previousStatement: 'Purchase',
            nextStatement: 'Purchase',
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Place in Purchase conditions. The Matches King runner handles the configured virtual and real batches.'),
            category: window.Blockly.Categories.Before_Purchase,
        });
        this.setInputsInline(false);
    },
    meta() {
        return {
            display_name: localize('Matches King purchase condition'),
            description: localize('Routes this workspace through the Matches King multi-contract runner.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.matches_king_strategy = () => '';
window.Blockly.JavaScript.javascriptGenerator.forBlock.matches_king_purchase_condition = () => '';
