import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

window.Blockly.Blocks.matches_king_strategy = {
    init() {
        const countOptions = Array.from({ length: 10 }, (_, index) => {
            const count = String(index + 1);
            return [count, count];
        });
        const digitDefaults = [4, 5, 9, 7, 0, 1, 2, 3, 6, 8];
        this.jsonInit({
            message0: localize('Matches King · number of digits %1 · stake per digit %2'),
            args0: [
                { type: 'field_dropdown', name: 'DIGIT_COUNT', options: countOptions },
                { type: 'field_number', name: 'STAKE', value: 0.5, min: 0.35, precision: 0.01 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'Choose how many digits to match, then enter one prediction in each Digit box. The stake applies to each contract; any winning contract resets stake, and Martingale advances only after an all-loss batch.'
            ),
            category: window.Blockly.Categories.Tick_Analysis,
        });
        this.getField('DIGIT_COUNT').setValidator(function (value) {
            this.getSourceBlock()?.updateDigitInputVisibility_(Number(value));
            return value;
        });

        for (let index = 0; index < 10; index += 1) {
            const digitNumber = index + 1;
            this.appendDummyInput(`DIGIT_INPUT_${digitNumber}`)
                .appendField(localize(`Digit ${digitNumber}`))
                .appendField(
                    new window.Blockly.FieldNumber(digitDefaults[index], 0, 9, 1),
                    `DIGIT_${digitNumber}`
                );
        }

        this.appendDummyInput('MATCHES_KING_RECOVERY')
            .appendField(localize('Martingale'))
            .appendField(new window.Blockly.FieldNumber(2, 1, 1000, 0.1), 'MARTINGALE')
            .appendField(localize('Take Profit'))
            .appendField(new window.Blockly.FieldNumber(10, 0.01, 1000000, 0.01), 'TAKE_PROFIT')
            .appendField(localize('Stop Loss'))
            .appendField(new window.Blockly.FieldNumber(30, 0.01, 1000000, 0.01), 'STOP_LOSS');

        this.appendDummyInput('MATCHES_KING_VIRTUAL_HOOK')
            .appendField(localize('Virtual Hook · buy after'))
            .appendField(
                new window.Blockly.FieldNumber(2, 1, 100, 1),
                'VIRTUAL_LOSS_THRESHOLD'
            )
            .appendField(localize('consecutive all-loss batches'));

        this.setInputsInline(false);
        this.setFieldValue('4', 'DIGIT_COUNT');
        this.updateDigitInputVisibility_(4);
    },
    updateDigitInputVisibility_(count) {
        const visibleCount = Math.max(1, Math.min(10, Math.floor(Number(count) || 1)));
        for (let digitNumber = 1; digitNumber <= 10; digitNumber += 1) {
            this.getInput(`DIGIT_INPUT_${digitNumber}`)?.setVisible(digitNumber <= visibleCount);
        }
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
