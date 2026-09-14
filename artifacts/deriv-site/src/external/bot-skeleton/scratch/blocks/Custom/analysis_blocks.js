import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

const generator = () => window.Blockly.JavaScript.javascriptGenerator;
const numberInput = (block, name, fallback) =>
    generator().valueToCode(block, name, generator().ORDER_ATOMIC) || fallback;
const analysisColours = () => ({
    colour: window.Blockly.Colours.Base.colour,
    colourSecondary: window.Blockly.Colours.Base.colourSecondary,
    colourTertiary: window.Blockly.Colours.Base.colourTertiary,
});

const registerOutputBlock = ({ type, message0, args0 = [], output = 'Number', tooltip, generatorCode, meta }) => {
    window.Blockly.Blocks[type] = {
        init() {
            this.jsonInit({
                message0,
                args0,
                output,
                outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
                ...analysisColours(),
                tooltip,
                category: window.Blockly.Categories.Tick_Analysis,
            });
            this.setInputsInline(true);
        },
        meta() {
            return {
                display_name: localize(meta),
                description: localize(tooltip),
            };
        },
        customContextMenu(menu) {
            modifyContextMenu(menu);
        },
    };

    window.Blockly.JavaScript.javascriptGenerator.forBlock[type] = generatorCode;
};

const digitOptions = Array.from({ length: 10 }, (_, digit) => [String(digit), String(digit)]);
const countInput = (name = 'COUNT', defaultValue = '1000') => ({
    type: 'input_value',
    name,
    check: 'Number',
    defaultValue,
});

registerOutputBlock({
    type: 'digit_frequency_analysis',
    message0: localize('%1 frequent digit from last %2 digits'),
    args0: [
        {
            type: 'field_dropdown',
            name: 'FREQUENCY_MODE',
            options: [
                [localize('Most'), 'most'],
                [localize('Least'), 'least'],
            ],
        },
        countInput(),
    ],
    tooltip: 'Finds the most or least frequent digit in the selected tick window.',
    meta: 'Digit Frequency Analysis',
    generatorCode: block => [
        `Bot.getMostFrequentDigit(${numberInput(block, 'COUNT', '1000')}, '${block.getFieldValue('FREQUENCY_MODE') || 'most'}')`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutputBlock({
    type: 'even_odd_percentage',
    message0: localize('%1 % of last %2 digits'),
    args0: [
        {
            type: 'field_dropdown',
            name: 'PARITY',
            options: [
                [localize('Even'), 'even'],
                [localize('Odd'), 'odd'],
            ],
        },
        countInput(),
    ],
    tooltip: 'Returns the percentage of even or odd digits in the selected tick window.',
    meta: 'Even/Odd %',
    generatorCode: block => [
        `Bot.getParityPercentage('${block.getFieldValue('PARITY') || 'even'}', ${numberInput(block, 'COUNT', '1000')})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutputBlock({
    type: 'over_under_analysis',
    message0: localize('%1 % %2 in last %3 ticks'),
    args0: [
        {
            type: 'field_dropdown',
            name: 'BARRIER_DIRECTION',
            options: [
                [localize('Over'), 'over'],
                [localize('Under'), 'under'],
            ],
        },
        countInput('BARRIER', '4'),
        countInput(),
    ],
    tooltip: 'Returns the percentage of digits over or under the selected barrier.',
    meta: 'Over/Under Analysis',
    generatorCode: block => [
        `Bot.getBarrierPercentage('${block.getFieldValue('BARRIER_DIRECTION') || 'over'}', ${numberInput(
            block,
            'BARRIER',
            '4'
        )}, ${numberInput(block, 'COUNT', '1000')})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutputBlock({
    type: 'match_differ_analysis',
    message0: localize('%1 % %2 in last %3 ticks'),
    args0: [
        {
            type: 'field_dropdown',
            name: 'MATCH_MODE',
            options: [
                [localize('Match'), 'match'],
                [localize('Differ'), 'differ'],
            ],
        },
        {
            type: 'input_value',
            name: 'DIGIT',
            check: 'Number',
        },
        countInput(),
    ],
    tooltip: 'Returns the percentage of matching or differing digits in the selected tick window.',
    meta: 'Match/Differ Analysis',
    generatorCode: block => [
        `Bot.getDigitPercentage(${numberInput(block, 'DIGIT', '5')}, ${numberInput(
            block,
            'COUNT',
            '1000'
        )}, '${block.getFieldValue('MATCH_MODE') || 'match'}')`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutputBlock({
    type: 'last_n_ticks_direction',
    message0: localize('Last %1 ticks direction %2'),
    args0: [
        countInput('COUNT', '5'),
        {
            type: 'field_dropdown',
            name: 'DIRECTION',
            options: [
                [localize('Rise'), 'rise'],
                [localize('Fall'), 'fall'],
            ],
        },
    ],
    output: 'Boolean',
    tooltip: 'Checks whether the selected number of recent ticks all rose or fell.',
    meta: 'Last N Ticks Direction',
    generatorCode: block => [
        `Bot.checkLastNTicksDirection('${block.getFieldValue('DIRECTION') || 'rise'}', ${numberInput(
            block,
            'COUNT',
            '5'
        )})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutputBlock({
    type: 'rise_fall_percentage',
    message0: localize('%1 % of last %2 ticks'),
    args0: [
        {
            type: 'field_dropdown',
            name: 'DIRECTION',
            options: [
                [localize('Rise'), 'rise'],
                [localize('Fall'), 'fall'],
            ],
        },
        countInput(),
    ],
    tooltip: 'Returns the percentage of rising or falling tick movements.',
    meta: 'Rise/Fall %',
    generatorCode: block => [
        `Bot.getDirectionPercentage('${block.getFieldValue('DIRECTION') || 'rise'}', ${numberInput(
            block,
            'COUNT',
            '1000'
        )})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutputBlock({
    type: 'second_last_digit',
    message0: localize('Second Last Digit'),
    tooltip: 'Returns the last digit of the previous tick.',
    meta: 'Second Last Digit',
    generatorCode: () => ['Bot.getNthLastDigit(2)', generator().ORDER_FUNCTION_CALL],
});

registerOutputBlock({
    type: 'nth_last_digit',
    message0: localize('Get the %1 last digit'),
    args0: [countInput('N', '3')],
    tooltip: 'Returns the last digit of the Nth previous tick.',
    meta: 'Nth Last Digit',
    generatorCode: block => [`Bot.getNthLastDigit(${numberInput(block, 'N', '3')})`, generator().ORDER_FUNCTION_CALL],
});
