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

window.Blockly.Blocks.adaptive_session_stop = {
    init() {
        this.jsonInit({
            message0: localize('Stop strategy at %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'REASON',
                    options: [
                        [localize('take-profit reached'), 'take_profit'],
                        [localize('stop-loss reached'), 'stop_loss'],
                        [localize('session risk limit reached'), 'session_risk_limit'],
                    ],
                },
            ],
            previousStatement: null,
            nextStatement: null,
            ...analysisColours(),
            tooltip: 'Stops the adaptive momentum strategy when its session profit or loss limit is reached.',
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('Stop at risk limit'),
            description: localize('Stops the bot when the configured adaptive strategy risk limit is reached.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.adaptive_session_stop = block =>
    `Bot.logAdaptiveSessionStop('${block.getFieldValue('REASON') || 'session_risk_limit'}');\nBot.stop();\n`;

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
                [localize('Second most'), 'second_most'],
                [localize('Least'), 'least'],
                [localize('Second least'), 'second_least'],
            ],
        },
        countInput(),
    ],
    tooltip: 'Finds the most, second most, least, or second least frequent digit in the selected tick window.',
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
    type: 'signal_confidence',
    message0: localize('Signal confidence for %1 over last %2 ticks'),
    args0: [
        {
            type: 'input_value',
            name: 'SIGNAL',
            check: 'String',
        },
        countInput('COUNT', '60'),
    ],
    tooltip: 'Returns how often the predicted CALL or PUT direction matched recent tick movement.',
    meta: 'Signal Confidence',
    generatorCode: block => [
        `Bot.getSignalConfidence(${numberInput(block, 'SIGNAL', "''")}, ${numberInput(block, 'COUNT', '60')})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutputBlock({
    type: 'adaptive_momentum_signal',
    message0: localize('Adaptive momentum: warm-up %1, short %2, long %3, confidence %4%'),
    args0: [
        countInput('WARMUP', '30'),
        countInput('SHORT_WINDOW', '8'),
        countInput('LONG_WINDOW', '20'),
        countInput('CONFIDENCE', '60'),
    ],
    output: 'String',
    tooltip:
        'Returns CALL, PUT, or WAIT. It requires enough history, compares short and long tick direction, and only signals when the configured confidence threshold is met.',
    meta: 'Adaptive Momentum Signal',
    generatorCode: block => [
        `Bot.getAdaptiveMomentumSignal(${numberInput(block, 'WARMUP', '30')}, ${numberInput(
            block,
            'SHORT_WINDOW',
            '8'
        )}, ${numberInput(block, 'LONG_WINDOW', '20')}, ${numberInput(block, 'CONFIDENCE', '60')})`,
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
