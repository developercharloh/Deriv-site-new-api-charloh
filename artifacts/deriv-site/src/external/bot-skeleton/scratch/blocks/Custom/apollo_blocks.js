import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

const generator = () => window.Blockly.JavaScript.javascriptGenerator;

const numberInput = (block, name, fallback) =>
    generator().valueToCode(block, name, generator().ORDER_ATOMIC) || fallback;

window.Blockly.Blocks.last_digits_condition = {
    init() {
        this.jsonInit(this.definition());
        this.setInputsInline(true);
    },
    definition() {
        return {
            message0: localize('Last %1 digits %2 %3 %4'),
            args0: [
                {
                    type: 'input_value',
                    name: 'N',
                    check: 'Number',
                },
                {
                    type: 'field_dropdown',
                    name: 'CONDITION',
                    options: [
                        [localize('all odd'), 'ALL_ODD'],
                        [localize('all even'), 'ALL_EVEN'],
                        [localize('≤'), 'LESS_OR_EQUAL'],
                        [localize('≥'), 'GREATER_OR_EQUAL'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'COMPARE_VALUE',
                    check: 'Number',
                },
                {
                    type: 'field_label',
                    name: 'APOLLO_LABEL',
                    text: '',
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Checks the latest digits using the Apollo condition.'),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    meta() {
        return {
            display_name: localize('Last digits condition'),
            description: localize('Checks parity or a threshold across the latest tick digits.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.last_digits_condition = block => {
    const condition = block.getFieldValue('CONDITION') || 'ALL_ODD';
    const count = numberInput(block, 'N', '1');
    const compareValue = numberInput(block, 'COMPARE_VALUE', '0');
    return [
        `Bot.checkLastDigitsCondition('${condition}', ${count}, ${compareValue})`,
        generator().ORDER_FUNCTION_CALL,
    ];
};

window.Blockly.Blocks.apollo_purchase2 = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Apollo purchase %1 prediction %2'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [
                        [localize('Even'), 'DIGITEVEN'],
                        [localize('Odd'), 'DIGITODD'],
                        [localize('Over'), 'DIGITOVER'],
                        [localize('Under'), 'DIGITUNDER'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'PREDICTION',
                    check: 'Number',
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Places the Apollo one-tick digit contract.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Apollo purchase'),
            description: localize('Native equivalent of the Apollo purchase2 block.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_purchase2 = block => {
    const purchaseType = block.getFieldValue('PURCHASE_LIST') || 'DIGITEVEN';
    const prediction = block.getInput('PREDICTION')
        ? numberInput(block, 'PREDICTION', 'undefined')
        : 'undefined';
    return `Bot.purchase('${purchaseType}', ${prediction});\n`;
};