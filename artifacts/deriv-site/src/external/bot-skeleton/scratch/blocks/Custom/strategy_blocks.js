import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

const generator = () => window.Blockly.JavaScript.javascriptGenerator;
const valueCode = (block, name, fallback) =>
    generator().valueToCode(block, name, generator().ORDER_ATOMIC) || fallback;
const numberInput = name => ({
    type: 'input_value',
    name,
    check: 'Number',
});
const arrayInput = (name = 'INPUT') => ({
    type: 'input_value',
    name,
    check: 'Array',
});
const stringInput = (name = 'INPUT') => ({
    type: 'input_value',
    name,
    check: 'String',
});
const dropdown = (name, options) => ({
    type: 'field_dropdown',
    name,
    options: options.map(([label, value]) => [localize(label), value]),
});
const colours = () => ({
    colour: window.Blockly.Colours.Base.colour,
    colourSecondary: window.Blockly.Colours.Base.colourSecondary,
    colourTertiary: window.Blockly.Colours.Base.colourTertiary,
});

const registerOutput = ({
    type,
    message0,
    args0 = [],
    output = 'Number',
    category = window.Blockly.Categories.Indicators,
    tooltip,
    meta,
    generatorCode,
}) => {
    window.Blockly.Blocks[type] = {
        init() {
            this.jsonInit({
                message0: localize(message0),
                args0,
                output,
                outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
                ...colours(),
                tooltip: localize(tooltip),
                category,
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

const registerBoolean = options => registerOutput({ ...options, output: 'Boolean' });

registerOutput({
    type: 'aroon_value',
    message0: 'Aroon %1 from %2 periods using %3',
    args0: [
        dropdown('COMPONENT', [['Up', 'up'], ['Down', 'down'], ['Oscillator', 'oscillator']]),
        numberInput('PERIOD'),
        arrayInput(),
    ],
    tooltip: 'Returns the latest Aroon Up, Aroon Down, or oscillator value from candle data.',
    meta: 'Aroon value',
    generatorCode: block => [
        `Bot.getAroonValue(${valueCode(block, 'INPUT', '[]')}, ${valueCode(block, 'PERIOD', '25')}, '${block.getFieldValue(
            'COMPONENT'
        ) || 'up'}')`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutput({
    type: 'ichimoku_value',
    message0: 'Ichimoku %1 from %2 with %3 / %4 / %5 periods',
    args0: [
        dropdown('COMPONENT', [
            ['Conversion line', 'conversion'],
            ['Base line', 'base'],
            ['Span A', 'spanA'],
            ['Span B', 'spanB'],
            ['Cloud top', 'cloudTop'],
            ['Cloud bottom', 'cloudBottom'],
            ['Close', 'close'],
        ]),
        arrayInput(),
        numberInput('CONVERSION_PERIODS', 9),
        numberInput('BASE_PERIODS', 26),
        numberInput('SPAN_PERIODS', 52),
    ],
    tooltip: 'Returns an Ichimoku Cloud component from candle data.',
    meta: 'Ichimoku Cloud value',
    generatorCode: block => [
        `Bot.getIchimokuValue(${valueCode(block, 'INPUT', '[]')}, ${valueCode(
            block,
            'CONVERSION_PERIODS',
            '9'
        )}, ${valueCode(block, 'BASE_PERIODS', '26')}, ${valueCode(block, 'SPAN_PERIODS', '52')}, '${block.getFieldValue(
            'COMPONENT'
        ) || 'cloudTop'}')`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutput({
    type: 'adx_value',
    message0: 'ADX %1 from %2 periods using %3',
    args0: [
        dropdown('COMPONENT', [['ADX', 'adx'], ['DI+', 'plusDi'], ['DI-', 'minusDi']]),
        numberInput('PERIOD'),
        arrayInput(),
    ],
    tooltip: 'Returns ADX or directional index values from candle data.',
    meta: 'ADX value',
    generatorCode: block => [
        `Bot.getAdxValue(${valueCode(block, 'INPUT', '[]')}, ${valueCode(block, 'PERIOD', '14')}, '${block.getFieldValue(
            'COMPONENT'
        ) || 'adx'}')`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutput({
    type: 'atr_value',
    message0: 'ATR from %1 periods using %2',
    args0: [arrayInput(), numberInput('PERIOD')],
    tooltip: 'Returns the average true range from candle data.',
    meta: 'ATR value',
    generatorCode: block => [
        `Bot.getAtrValue(${valueCode(block, 'INPUT', '[]')}, ${valueCode(block, 'PERIOD', '14')})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutput({
    type: 'stochastic_value',
    message0: 'Stochastic %1 from %2 periods, signal %3, using %4',
    args0: [
        dropdown('COMPONENT', [['%K', 'k'], ['%D', 'd']]),
        numberInput('PERIOD', 14),
        numberInput('SIGNAL_PERIOD', 3),
        arrayInput(),
    ],
    tooltip: 'Returns the Stochastic %K or %D value from candle data.',
    meta: 'Stochastic value',
    generatorCode: block => [
        `Bot.getStochasticValue(${valueCode(block, 'INPUT', '[]')}, ${valueCode(
            block,
            'PERIOD',
            '14'
        )}, ${valueCode(block, 'SIGNAL_PERIOD', '3')}, '${block.getFieldValue('COMPONENT') || 'k'}')`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutput({
    type: 'macd_value',
    message0: 'MACD %1 from %2, periods %3 / %4 / %5',
    args0: [
        dropdown('COMPONENT', [['Histogram', 'histogram'], ['MACD', 'macd'], ['Signal', 'signal']]),
        arrayInput(),
        numberInput('FAST_PERIOD', 12),
        numberInput('SLOW_PERIOD', 26),
        numberInput('SIGNAL_PERIOD', 9),
    ],
    tooltip: 'Returns a current MACD line, signal line, or histogram value.',
    meta: 'MACD value',
    generatorCode: block => [
        `Bot.getMacdValue(${valueCode(block, 'INPUT', '[]')}, ${valueCode(
            block,
            'FAST_PERIOD',
            '12'
        )}, ${valueCode(block, 'SLOW_PERIOD', '26')}, ${valueCode(block, 'SIGNAL_PERIOD', '9')}, '${block.getFieldValue(
            'COMPONENT'
        ) || 'histogram'}')`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutput({
    type: 'rsi_value',
    message0: 'RSI from %1 periods using %2',
    args0: [arrayInput(), numberInput('PERIOD')],
    tooltip: 'Returns the latest RSI value from a price list.',
    meta: 'RSI value',
    generatorCode: block => [
        `Bot.getRsiValue(${valueCode(block, 'INPUT', '[]')}, ${valueCode(block, 'PERIOD', '14')})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutput({
    type: 'bollinger_value',
    message0: 'Bollinger %1 from %2, period %3, multipliers %4 / %5',
    args0: [
        dropdown('COMPONENT', [
            ['Upper band', 'upper'],
            ['Middle band', 'middle'],
            ['Lower band', 'lower'],
            ['%B', 'percentB'],
            ['Bandwidth', 'width'],
        ]),
        arrayInput(),
        numberInput('PERIOD', 20),
        numberInput('UP_MULTIPLIER', 2),
        numberInput('DOWN_MULTIPLIER', 2),
    ],
    tooltip: 'Returns a Bollinger Band component, percent B, or normalized bandwidth.',
    meta: 'Bollinger strategy value',
    generatorCode: block => [
        `Bot.getBollingerValue(${valueCode(block, 'INPUT', '[]')}, ${valueCode(
            block,
            'PERIOD',
            '20'
        )}, ${valueCode(block, 'UP_MULTIPLIER', '2')}, ${valueCode(block, 'DOWN_MULTIPLIER', '2')}, '${block.getFieldValue(
            'COMPONENT'
        ) || 'middle'}')`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerBoolean({
    type: 'macd_cross',
    message0: 'MACD %1 cross using %2, periods %3 / %4 / %5',
    args0: [
        dropdown('DIRECTION', [['Bullish', 'bullish'], ['Bearish', 'bearish']]),
        arrayInput(),
        numberInput('FAST_PERIOD', 12),
        numberInput('SLOW_PERIOD', 26),
        numberInput('SIGNAL_PERIOD', 9),
    ],
    tooltip: 'Checks whether MACD has just crossed its signal line.',
    meta: 'MACD crossover',
    generatorCode: block => [
        `Bot.isMacdCross(${valueCode(block, 'INPUT', '[]')}, ${valueCode(
            block,
            'FAST_PERIOD',
            '12'
        )}, ${valueCode(block, 'SLOW_PERIOD', '26')}, ${valueCode(block, 'SIGNAL_PERIOD', '9')}, '${block.getFieldValue(
            'DIRECTION'
        ) || 'bullish'}')`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerBoolean({
    type: 'rsi_cross',
    message0: 'RSI crosses %1 %2 using period %3 and %4',
    args0: [
        dropdown('DIRECTION', [['above', 'above'], ['below', 'below']]),
        numberInput('LEVEL'),
        numberInput('PERIOD'),
        arrayInput(),
    ],
    tooltip: 'Checks whether RSI has crossed a configured level.',
    meta: 'RSI crossover',
    generatorCode: block => [
        `Bot.isRsiCross(${valueCode(block, 'INPUT', '[]')}, ${valueCode(
            block,
            'PERIOD',
            '14'
        )}, ${valueCode(block, 'LEVEL', '50')}, '${block.getFieldValue('DIRECTION') || 'above'}')`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerBoolean({
    type: 'bollinger_squeeze',
    message0: 'Bollinger squeeze below width %1, period %2, multipliers %3 / %4, using %5',
    args0: [
        numberInput('MAX_WIDTH'),
        numberInput('PERIOD'),
        numberInput('UP_MULTIPLIER'),
        numberInput('DOWN_MULTIPLIER'),
        arrayInput(),
    ],
    tooltip: 'Checks whether normalized Bollinger bandwidth is below the configured threshold.',
    meta: 'Bollinger squeeze',
    generatorCode: block => [
        `Bot.isBollingerSqueeze(${valueCode(block, 'INPUT', '[]')}, ${valueCode(
            block,
            'PERIOD',
            '20'
        )}, ${valueCode(block, 'UP_MULTIPLIER', '2')}, ${valueCode(block, 'DOWN_MULTIPLIER', '2')}, ${valueCode(
            block,
            'MAX_WIDTH',
            '0.02'
        )})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerBoolean({
    type: 'indicator_ready',
    message0: '%1 has period %2 plus %3 extra values in %4',
    args0: [
        dropdown('INDICATOR', [['Indicator', 'indicator'], ['Ichimoku', 'ichimoku'], ['ADX', 'adx']]),
        numberInput('PERIOD'),
        numberInput('EXTRA'),
        arrayInput(),
    ],
    tooltip: 'Returns false until enough input history is available for an indicator.',
    meta: 'Indicator history ready',
    generatorCode: block => [
        `Bot.isIndicatorReady(${valueCode(block, 'INPUT', '[]')}, ${valueCode(block, 'PERIOD', '14')}, ${valueCode(
            block,
            'EXTRA',
            '0'
        )})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerBoolean({
    type: 'no_active_contract',
    message0: 'No contract is open',
    category: window.Blockly.Categories.Before_Purchase,
    tooltip: 'Allows a purchase only when there are no unsettled contracts.',
    meta: 'No active contract',
    generatorCode: () => ['Bot.canOpenNewContract()', generator().ORDER_FUNCTION_CALL],
});

registerBoolean({
    type: 'consecutive_loss_gate',
    message0: 'Fewer than %1 consecutive losses',
    args0: [numberInput('MAX_LOSSES', 3)],
    category: window.Blockly.Categories.Before_Purchase,
    tooltip: 'Blocks new purchases after the configured consecutive-loss limit.',
    meta: 'Consecutive loss gate',
    generatorCode: block => [
        `(Bot.getConsecutiveLosses() < ${valueCode(block, 'MAX_LOSSES', '3')})`,
        generator().ORDER_RELATIONAL,
    ],
});

registerBoolean({
    type: 'payout_gate',
    message0: 'Payout %1 for stake %2 supports required win rate %3',
    args0: [numberInput('PAYOUT'), numberInput('STAKE'), numberInput('REQUIRED_WIN_RATE')],
    category: window.Blockly.Categories.Before_Purchase,
    tooltip: 'Allows a purchase only when stake divided by payout is below the required win rate.',
    meta: 'Payout break-even gate',
    generatorCode: block => [
        `Bot.isPayoutAcceptable(${valueCode(block, 'STAKE', '0')}, ${valueCode(block, 'PAYOUT', '0')}, ${valueCode(
            block,
            'REQUIRED_WIN_RATE',
            '56'
        )})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerBoolean({
    type: 'session_risk_gate',
    message0: 'Session risk is below loss %1 and trade limit %2',
    args0: [numberInput('MAX_LOSS', 1), numberInput('MAX_TRADES', 10)],
    category: window.Blockly.Categories.Before_Purchase,
    tooltip: 'Blocks new purchases after the session loss or trade-count limit.',
    meta: 'Session risk gate',
    generatorCode: block => [
        `(Bot.getTotalProfit(false) > -Math.abs(${valueCode(block, 'MAX_LOSS', '1')}) && Bot.getTotalRuns() < ${valueCode(
            block,
            'MAX_TRADES',
            '10'
        )})`,
        generator().ORDER_RELATIONAL,
    ],
});

registerBoolean({
    type: 'model_confidence_gate',
    message0: 'Model confidence from %1 / %2 is at least %3%',
    args0: [numberInput('BULLISH_SCORE'), numberInput('BEARISH_SCORE'), numberInput('MINIMUM_CONFIDENCE')],
    category: window.Blockly.Categories.Before_Purchase,
    tooltip: 'Allows a model-confirmed trade only when confidence reaches the configured threshold.',
    meta: 'Model confidence gate',
    generatorCode: block => [
        `(Bot.getModelConfidence(${valueCode(block, 'BULLISH_SCORE', '0')}, ${valueCode(
            block,
            'BEARISH_SCORE',
            '0'
        )}) >= ${valueCode(block, 'MINIMUM_CONFIDENCE', '60')})`,
        generator().ORDER_RELATIONAL,
    ],
});

registerBoolean({
    type: 'models_agree',
    message0: 'Primary model is directional: %1 (secondary %2)',
    args0: [stringInput('PRIMARY'), stringInput('SECONDARY')],
    category: window.Blockly.Categories.Before_Purchase,
    tooltip: 'Allows a directional primary model signal. The secondary signal is informational and cannot veto the primary direction.',
    meta: 'Primary model direction gate',
    generatorCode: block => [
        `(${valueCode(block, 'PRIMARY', "''")} !== 'WAIT')`,
        generator().ORDER_RELATIONAL,
    ],
});

registerOutput({
    type: 'model_signal',
    message0: 'Model signal from bullish %1 and bearish %2, edge %3',
    args0: [numberInput('BULLISH_SCORE', 0), numberInput('BEARISH_SCORE', 0), numberInput('MINIMUM_EDGE', 10)],
    output: 'String',
    category: window.Blockly.Categories.Indicators,
    tooltip: 'Returns CALL, PUT, or WAIT from two directional model scores.',
    meta: 'Model signal',
    generatorCode: block => [
        `Bot.getModelSignal(${valueCode(block, 'BULLISH_SCORE', '0')}, ${valueCode(
            block,
            'BEARISH_SCORE',
            '0'
        )}, ${valueCode(block, 'MINIMUM_EDGE', '10')})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

registerOutput({
    type: 'model_confidence',
    message0: 'Model confidence from bullish %1 and bearish %2',
    args0: [numberInput('BULLISH_SCORE', 0), numberInput('BEARISH_SCORE', 0)],
    category: window.Blockly.Categories.Indicators,
    tooltip: 'Returns directional separation as a confidence percentage.',
    meta: 'Model confidence',
    generatorCode: block => [
        `Bot.getModelConfidence(${valueCode(block, 'BULLISH_SCORE', '0')}, ${valueCode(
            block,
            'BEARISH_SCORE',
            '0'
        )})`,
        generator().ORDER_FUNCTION_CALL,
    ],
});