import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

const generator = () => window.Blockly.JavaScript.javascriptGenerator;

window.Blockly.Blocks.candle_close_entry_window = {
    init() {
        this.jsonInit({
            message0: localize('Enter %1 seconds before the %2-second candle closes'),
            args0: [
                {
                    type: 'field_number',
                    name: 'SECONDS_BEFORE_CLOSE',
                    value: 2,
                    min: 1,
                    max: 59,
                    precision: 1,
                },
                {
                    type: 'field_number',
                    name: 'INTERVAL_SECONDS',
                    value: 60,
                    min: 2,
                    max: 3600,
                    precision: 1,
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('True only when the latest broker tick is in the configured candle-close entry second.'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
        this.setInputsInline(true);
    },
    meta() {
        return {
            display_name: localize('Candle-close entry window'),
            description: localize('Checks the latest broker tick against a candle-close entry time.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.candle_close_entry_window = block => {
    const interval = Number(block.getFieldValue('INTERVAL_SECONDS')) || 60;
    const secondsBeforeClose = Number(block.getFieldValue('SECONDS_BEFORE_CLOSE')) || 2;
    return [
        `Bot.isCandleCloseEntryWindow(${interval}, ${secondsBeforeClose})`,
        generator().ORDER_FUNCTION_CALL,
    ];
};
