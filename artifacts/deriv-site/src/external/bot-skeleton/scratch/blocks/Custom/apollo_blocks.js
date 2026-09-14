import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

const generator = () => window.Blockly.JavaScript.javascriptGenerator;

const numberInput = (block, name, fallback) =>
    generator().valueToCode(block, name, generator().ORDER_ATOMIC) || fallback;

const decodeOptionPairs = encodedOptions => {
    try {
        const parsed = JSON.parse(decodeURIComponent(encodedOptions || ''));
        const options = parsed
            .filter(option => Array.isArray(option) && option.length >= 2)
            .map(option => [String(option[0]), String(option[1])]);
        return options.length ? options : [['', '']];
    } catch {
        return [['', '']];
    }
};

const optionMutation = (block, options) => {
    const mutation = document.createElementNS('http://www.w3.org/1999/xhtml', 'mutation');
    mutation.setAttribute('options', encodeURIComponent(JSON.stringify(options)));
    return mutation;
};

const applyOptionPairs = (block, options) => {
    const field = block.getField('OPTION');
    if (!field) return;
    field.menuGenerator_ = options;
    if (!options.some(option => option[1] === field.getValue())) {
        field.setValue(options[0][1]);
    }
};

const optionBlockDefinition = (isCondition = false) => ({
    init() {
        this.appendDummyInput()
            .appendField(isCondition ? localize('is') : localize('set'))
            .appendField(new window.Blockly.FieldVariable(localize('item')), 'VAR')
            .appendField(isCondition ? localize('equal to') : localize('to'))
            .appendField(new window.Blockly.FieldDropdown([['', '']]), 'OPTION');
        if (isCondition) {
            this.setOutput(true, 'Boolean');
            this.setOutputShape(window.Blockly.OUTPUT_SHAPE_ROUND);
        } else {
            this.setPreviousStatement(true);
            this.setNextStatement(true);
        }
        this.setColour(window.Blockly.Colours.Special2.colour);
        this.setTooltip(localize('Selects and compares a strategy option.'));
    },
    mutationToDom() {
        return optionMutation(this, this.optionPairs || [['', '']]);
    },
    domToMutation(xmlElement) {
        this.optionPairs = decodeOptionPairs(xmlElement.getAttribute('options'));
        applyOptionPairs(this, this.optionPairs);
    },
});

// These two blocks are serialized by the uploaded pattern-strategy XML. They
// are ordinary Blockly variable assignment/comparison blocks with a dynamic
// dropdown, so the uploaded strategy can be loaded without rewriting it.
window.Blockly.Blocks.variables_set_option = optionBlockDefinition(false);
window.Blockly.Blocks.variables_is_option = optionBlockDefinition(true);

window.Blockly.JavaScript.javascriptGenerator.forBlock.variables_set_option = block => {
    const varName = window.Blockly.JavaScript.variableDB_.getName(
        block.getFieldValue('VAR'),
        window.Blockly.Variables.CATEGORY_NAME
    );
    return `${varName} = ${JSON.stringify(block.getFieldValue('OPTION') || '')};\n`;
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.variables_is_option = block => {
    const varName = window.Blockly.JavaScript.variableDB_.getName(
        block.getFieldValue('VAR'),
        window.Blockly.Variables.CATEGORY_NAME
    );
    return [
        `${varName} === ${JSON.stringify(block.getFieldValue('OPTION') || '')}`,
        generator().ORDER_EQUALITY,
    ];
};

window.Blockly.Blocks.last_digits_condition = {
    init() {
        this.jsonInit(this.definition());
        this.setInputsInline(true);
    },
    definition() {
        return {
            message0: localize('Last %1 digits %2 %3'),
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
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Checks the latest digits using the selected condition.'),
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
            message0: localize('Purchase %1 prediction %2'),
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
            tooltip: localize('Places a one-tick digit contract.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Purchase'),
            description: localize('Places a one-tick digit contract.'),
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