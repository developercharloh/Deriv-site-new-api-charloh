import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../utils';

const generator = () => window.Blockly.JavaScript.javascriptGenerator;
const numberInput = (block, name, fallback) =>
    generator().valueToCode(block, name, generator().ORDER_ATOMIC) || fallback;
const smartOver2JournalScope = block => JSON.stringify(block.workspace?.__smartOver2JournalScope ?? null);
const smartOver2RecoveryContractType = block =>
    JSON.stringify(
        block.getFieldValue?.('RECOVERY_CONTRACT_TYPE') ||
            block.workspace?.__smartOver2RecoveryContractType ||
            'DIGITUNDER'
    );
const analysisColours = () => ({
    colour: window.Blockly.Colours.Base.colour,
    colourSecondary: window.Blockly.Colours.Base.colourSecondary,
    colourTertiary: window.Blockly.Colours.Base.colourTertiary,
});

const registerOutputBlock = ({
    type,
    message0,
    args0 = [],
    message1,
    args1 = [],
    message2,
    args2 = [],
    message3,
    args3 = [],
    message4,
    args4 = [],
    message5,
    args5 = [],
    message6,
    args6 = [],
    message7,
    args7 = [],
    inputsInline = true,
    output = 'Number',
    tooltip,
    generatorCode,
    meta,
    hiddenInputs = [],
}) => {
    window.Blockly.Blocks[type] = {
        init() {
            this.jsonInit({
                message0,
                args0,
                ...(message1 ? { message1, args1 } : {}),
                ...(message2 ? { message2, args2 } : {}),
                ...(message3 ? { message3, args3 } : {}),
                ...(message4 ? { message4, args4 } : {}),
                ...(message5 ? { message5, args5 } : {}),
                ...(message6 ? { message6, args6 } : {}),
                ...(message7 ? { message7, args7 } : {}),
                output,
                outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
                ...analysisColours(),
                tooltip,
                category: window.Blockly.Categories.Tick_Analysis,
            });
            this.setInputsInline(inputsInline);
            if (this.workspace.rendered) {
                hiddenInputs.forEach(inputName => this.getInput(inputName)?.setVisible(false));
            }
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

window.Blockly.Blocks.smart_over2_recovery_settings = {
    init() {
        this.jsonInit({
            message0: localize('Last %1 digits · Virtual Hook %2'),
            args0: [
                {
                    type: 'field_number',
                    name: 'ENTRY_DIGIT_COUNT',
                    value: 4,
                    min: 1,
                    max: 1000,
                    precision: 1,
                },
                { type: 'field_checkbox', name: 'USE_VIRTUAL_HOOK', checked: true },
            ],
            message1: localize('Real recovery after %1 consecutive losses'),
            args1: [
                {
                    type: 'field_number',
                    name: 'MAX_VIRTUAL_LOSSES',
                    value: 2,
                    min: 0,
                    precision: 1,
                },
            ],
            message2: localize('Recovery contract %1'),
            args2: [
                {
                    type: 'field_dropdown',
                    name: 'RECOVERY_CONTRACT_TYPE',
                    options: [
                        [localize('Under'), 'DIGITUNDER'],
                        [localize('Over'), 'DIGITOVER'],
                    ],
                },
            ],
            previousStatement: null,
            nextStatement: null,
            ...analysisColours(),
            tooltip: localize(
                'Set the entry lookback, Virtual Hook options, and recovery contract once at the start of the bot.'
            ),
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('Smart Over 2 Virtual Hook settings'),
            description: localize('Sets whether Virtual Hook is enabled and the consecutive-loss limit.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.smart_over2_recovery_settings = block => {
    const useVirtualHook = block.getFieldValue('USE_VIRTUAL_HOOK') === 'TRUE';
    const maxVirtualLosses = Number(block.getFieldValue('MAX_VIRTUAL_LOSSES'));
    const entryDigitCount = Number(block.getFieldValue('ENTRY_DIGIT_COUNT'));
    return (
        `Bot.configureSmartOver2Recovery(${useVirtualHook}, ` +
        `${Number.isFinite(maxVirtualLosses) ? maxVirtualLosses : 2}, ` +
        `${Number.isFinite(entryDigitCount) ? entryDigitCount : 4}, ` +
        `${smartOver2RecoveryContractType(block)});\n`
    );
};

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

registerOutputBlock({
    type: 'smart_over2_entry_gate',
    message0: localize('Smart Over 2: last %1 digits in range 3–7'),
    args0: [countInput('COUNT', '4')],
    message1: localize('Skip if last 3 are all 7–9 or all 0–2'),
    inputsInline: false,
    output: 'Boolean',
    tooltip: 'Allows Digit Over 2 only when the last X digits are 3–7 inclusive; skips if the latest three are all 7–9 or all 0–2.',
    meta: 'Smart Over 2 Entry Gate',
    generatorCode: block => {
        const journalScope = JSON.stringify(block.workspace?.__smartOver2JournalScope ?? null);
        return [
            `Bot.checkSmartOver2Entry(${numberInput(block, 'COUNT', '4')}, ${journalScope})`,
            generator().ORDER_FUNCTION_CALL,
        ];
    },
});

registerOutputBlock({
    type: 'smart_over2_recovery_gate',
    // Keep the legacy COUNT connection hidden so older saved workspaces still
    // load, but use the Run-once setting as the sole entry-count source.
    message0: localize('Smart Over 2 recovery gate %1'),
    args0: [countInput('COUNT', '4')],
    message1: localize('Analyze %1 ticks'),
    args1: [countInput('ANALYSIS_COUNT', '100')],
    message2: localize('Martingale %1'),
    args2: [countInput('MARTINGALE', '1.2')],
    message3: localize('Use Martingale %1'),
    args3: [{ type: 'input_value', name: 'USE_MARTINGALE', check: 'Boolean' }],
    message4: localize('Over prediction %1 · Recovery prediction %2'),
    args4: [countInput('OVER_PREDICTION', '2'), countInput('RECOVERY_PREDICTION', '5')],
    message5: localize('Target Profit %1 · Stop Loss %2'),
    args5: [
        countInput('TARGET_PROFIT', '0'),
        countInput('STOP_LOSS', '0'),
    ],
    hiddenInputs: ['ANALYSIS_COUNT', 'COUNT'],
    inputsInline: false,
    output: 'Boolean',
    tooltip:
        'Normal entries use the configured Over prediction and entry rules. After a real Over loss, Virtual Hook simulates the template recovery contract using its linked prediction. A virtual win resets the consecutive-loss count but keeps the hook active; after the configured number of consecutive virtual losses, real recovery begins. Real recovery losses continue with Martingale until a win, then normal condition-gated Over entries resume. Configure Virtual Hook settings in Run once at start.',
    meta: 'Smart Over 2 Recovery Gate',
    generatorCode: block => [
        `Bot.checkSmartOver2Recovery(undefined, ` +
            `${numberInput(block, 'ANALYSIS_COUNT', '100')}, ${smartOver2JournalScope(block)}, ` +
            `${numberInput(block, 'MARTINGALE', '1.2')}, ` +
            `${numberInput(block, 'USE_MARTINGALE', 'true')}, ` +
            `${numberInput(block, 'OVER_PREDICTION', '2')}, ` +
            `${numberInput(block, 'RECOVERY_PREDICTION', '5')}, ` +
            `undefined, undefined, ` +
            `${numberInput(block, 'TARGET_PROFIT', '0')}, ` +
            `${numberInput(block, 'STOP_LOSS', '0')}, ` +
            `undefined)`,
        generator().ORDER_FUNCTION_CALL,
    ],
});

window.Blockly.Blocks.smart_over2_recovery_purchase = {
    init() {
        this.jsonInit({
            message0: localize('Smart Over 2: buy normal entry or real recovery'),
            previousStatement: null,
            ...analysisColours(),
            tooltip: localize('Buys the configured Over prediction for a normal entry, or the template recovery contract, using the current stake.'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
        this.setNextStatement(false);
    },
    meta() {
        return {
            display_name: localize('Smart Over 2 recovery purchase'),
            description: localize('Places the contract selected by the Smart Over 2 recovery gate.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.smart_over2_recovery_purchase = block =>
    `Bot.purchaseSmartOver2Recovery(${smartOver2JournalScope(block)});\n`;

window.Blockly.Blocks.smart_over2_recovery_settlement = {
    init() {
        this.jsonInit({
            message0: localize('Smart Over 2: record the result and advance recovery'),
            previousStatement: 'TradeAgain',
            nextStatement: 'TradeAgain',
            ...analysisColours(),
            tooltip: localize('A loss repeats the configured recovery prediction. Any win resets the stake and resumes condition-gated entry predictions.'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('Smart Over 2 recovery settlement'),
            description: localize('Updates the recovery stage using the final result of the last contract.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.smart_over2_recovery_settlement = block =>
    `Bot.completeSmartOver2Recovery(${smartOver2JournalScope(block)});\n`;

window.Blockly.Blocks.smart_over2_v3_settings = {
    init() {
        this.jsonInit({
            message0: localize('Virtual Hook %1'),
            args0: [{ type: 'field_checkbox', name: 'USE_VIRTUAL_HOOK', checked: true }],
            message1: localize('Place a real Over 2 after %1 consecutive virtual losses'),
            args1: [
                {
                    type: 'field_number',
                    name: 'MAX_VIRTUAL_LOSSES',
                    value: 2,
                    min: 0,
                    precision: 1,
                },
            ],
            previousStatement: null,
            nextStatement: null,
            ...analysisColours(),
            tooltip: localize(
                'V3 always checks the latest four digits and uses Virtual Hook until the configured consecutive-loss threshold.'
            ),
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('Smart Over 2 V3 Virtual Hook settings'),
            description: localize('Keeps the four-digit entry window fixed and sets the virtual-loss limit before live Over 2 trades.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.smart_over2_v3_settings = block => {
    const useVirtualHook = block.getFieldValue('USE_VIRTUAL_HOOK') === 'TRUE';
    const maxVirtualLosses = Number(block.getFieldValue('MAX_VIRTUAL_LOSSES'));
    return (
        `Bot.configureSmartOver2V3(${useVirtualHook}, ` +
        `${Number.isFinite(maxVirtualLosses) ? maxVirtualLosses : 2});\n`
    );
};

registerOutputBlock({
    type: 'smart_over2_v3_entry_gate',
    message0: localize('Smart Over 2 V3 · all four latest digits must be 3–6'),
    message1: localize('Martingale %1 · Use Martingale %2'),
    args1: [
        countInput('MARTINGALE', '1.2'),
        { type: 'input_value', name: 'USE_MARTINGALE', check: 'Boolean' },
    ],
    message2: localize('Target Profit %1 · Stop Loss %2'),
    args2: [countInput('TARGET_PROFIT', '5'), countInput('STOP_LOSS', '30')],
    inputsInline: false,
    output: 'Boolean',
    tooltip:
        'Allows a V3 Over 2 attempt only when all four latest digits are 3–6 inclusive. Qualifying entries are simulated until the virtual-loss threshold is reached.',
    meta: 'Smart Over 2 V3 Entry Gate',
    generatorCode: block =>
        `Bot.checkSmartOver2V3Entry(` +
        `${numberInput(block, 'MARTINGALE', '1.2')}, ` +
        `${numberInput(block, 'USE_MARTINGALE', 'true')}, ` +
        `${numberInput(block, 'TARGET_PROFIT', '5')}, ` +
        `${numberInput(block, 'STOP_LOSS', '30')}, ` +
        `${smartOver2JournalScope(block)})`,
});

window.Blockly.Blocks.smart_over2_v3_purchase = {
    init() {
        this.jsonInit({
            message0: localize('Smart Over 2 V3: buy Over 2'),
            previousStatement: null,
            ...analysisColours(),
            tooltip: localize('Places only the queued Over 2 trade after the V3 Virtual Hook allows a real entry.'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
        this.setNextStatement(false);
    },
    meta() {
        return {
            display_name: localize('Smart Over 2 V3 purchase'),
            description: localize('Places the V3 Over 2 trade authorized by its entry gate.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.smart_over2_v3_purchase = block =>
    `Bot.purchaseSmartOver2V3(${smartOver2JournalScope(block)});\n`;

window.Blockly.Blocks.smart_over2_v3_settlement = {
    init() {
        this.jsonInit({
            message0: localize('Smart Over 2 V3: record the Over 2 result'),
            previousStatement: 'TradeAgain',
            nextStatement: 'TradeAgain',
            ...analysisColours(),
            tooltip: localize('Records a live V3 Over 2 settlement and starts a new Virtual Hook cycle.'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('Smart Over 2 V3 settlement'),
            description: localize('Updates V3 stake and session risk state after a live Over 2 result.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.smart_over2_v3_settlement = block =>
    `Bot.completeSmartOver2V3Settlement(${smartOver2JournalScope(block)});\n`;
