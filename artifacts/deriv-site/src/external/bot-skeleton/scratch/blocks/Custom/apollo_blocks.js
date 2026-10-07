import { localize } from '@deriv-com/translations';
import { config } from '../../../constants/config';
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

window.Blockly.Blocks.even_odd_analysis = {
    init() {
        this.jsonInit({
            message0: localize('%1 percentage of the last %2 digits'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'ANALYSIS_TYPE',
                    options: [
                        [localize('Even'), 'EVEN_PERCENTAGE'],
                        [localize('Odd'), 'ODD_PERCENTAGE'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'N',
                    check: 'Number',
                },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Returns the percentage of even or odd digits in the selected tick window.'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
        this.setInputsInline(true);
    },
    meta() {
        return {
            display_name: localize('Even/Odd Analysis'),
            description: localize('Returns the percentage of even or odd digits in the selected tick window.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.even_odd_analysis = block => {
    const parity = block.getFieldValue('ANALYSIS_TYPE') === 'ODD_PERCENTAGE' ? 'odd' : 'even';
    const count = numberInput(block, 'N', '1000');
    return [`Bot.getParityPercentage('${parity}', ${count})`, generator().ORDER_FUNCTION_CALL];
};

window.Blockly.Blocks.apollo_notify = {
    init() {
        this.jsonInit({
            message0: localize('Notify %1 with sound %2 %3'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'NOTIFICATION_TYPE',
                    options: config().lists.NOTIFICATION_TYPE,
                },
                {
                    type: 'field_dropdown',
                    name: 'NOTIFICATION_SOUND',
                    options: config().lists.NOTIFICATION_SOUND,
                },
                {
                    type: 'input_value',
                    name: 'MESSAGE',
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special3.colour,
            colourSecondary: window.Blockly.Colours.Special3.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special3.colourTertiary,
            tooltip: localize('Displays a digit-strategy notification.'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('Digit Pro Notification'),
            description: localize('Displays a notification from the digit strategy.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_notify = block => {
    const notificationType = block.getFieldValue('NOTIFICATION_TYPE') || 'info';
    const sound = block.getFieldValue('NOTIFICATION_SOUND') || 'silent';
    const message =
        generator().valueToCode(block, 'MESSAGE', generator().ORDER_ATOMIC) ||
        JSON.stringify(localize('<empty message>'));
    return `Bot.notify({ className: 'journal__text--${notificationType}', message: ${message}, sound: '${sound}', block_id: '${block.id}', variable_name: null });\n`;
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

// Legacy templates serialize this purchase block without a PREDICTION input.
// Read the current trade-definition expression so strategies that change their
// barrier after settlement keep using the live value rather than the startup one.
window.Blockly.Blocks.apollo_purchase = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Purchase %1'),
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
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Buys the selected digit contract using the current prediction from Trade parameters.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Legacy digit purchase'),
            description: localize('Uses the current Trade parameters prediction when purchasing a digit contract.'),
            key_words: localize('buy'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_purchase = block => {
    const purchaseType = block.getFieldValue('PURCHASE_LIST') || 'DIGITUNDER';
    const workspace = block.workspace;
    const tradeDefinition =
        workspace?.getTradeDefinitionBlock?.() ??
        workspace?.getAllBlocks?.(true)?.find(candidate => candidate.type === 'trade_definition');
    const tradeOptions = tradeDefinition
        ? workspace?.getAllBlocks?.(false)?.find(
              candidate =>
                  ['trade_definition_tradeoptions', 'trade_definition_tradeoptions_payout'].includes(candidate.type) &&
                  candidate.getRootBlock?.() === tradeDefinition
          )
        : undefined;
    const prediction =
        tradeOptions?.getInput?.('PREDICTION') &&
        generator().valueToCode(tradeOptions, 'PREDICTION', generator().ORDER_ATOMIC);

    return `Bot.purchase('${purchaseType}', ${prediction || 'undefined'});\n`;
};