import {
    inferStrategyIntent,
    validateBlocklyBlocksAvailable,
    validateDigitRuleSupport,
    validateAiGeneratedBlocks,
    validateRequiredBotSections,
    validateStrategyBlockDefinitions,
    validateStrategyMatchesIntent,
    buildBotScaffold,
} from '../../../../../../api-server/src/routes/openai/strategy-intent';

const requestedStrategy =
    'Build a bot for Over four when the last four digits are below digit four, and Under five when the last three digits are over five.';

const xml = (
    secondThreshold = 5,
    firstPrediction = 4,
    secondPrediction = 5,
    firstPurchase = 'DIGITOVER',
    secondPurchase = 'DIGITUNDER'
) => `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true">
  <block type="trade_definition_tradetype">
    <field name="TRADETYPECAT_LIST">digits</field>
    <field name="TRADETYPE_LIST">overunder</field>
  </block>
  <block type="trade_definition_contracttype"><field name="TYPE_LIST">both</field></block>
  <block type="last_digits_condition">
    <field name="CONDITION">LESS_THAN</field>
    <value name="N"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
    <value name="COMPARE_VALUE"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
  </block>
  <block type="apollo_purchase2">
    <field name="PURCHASE_LIST">${firstPurchase}</field>
    <value name="PREDICTION"><shadow type="math_number"><field name="NUM">${firstPrediction}</field></shadow></value>
  </block>
  <block type="last_digits_condition">
    <field name="CONDITION">GREATER_THAN</field>
    <value name="N"><shadow type="math_number"><field name="NUM">3</field></shadow></value>
    <value name="COMPARE_VALUE"><shadow type="math_number"><field name="NUM">${secondThreshold}</field></shadow></value>
  </block>
  <block type="apollo_purchase2">
    <field name="PURCHASE_LIST">${secondPurchase}</field>
    <value name="PREDICTION"><shadow type="math_number"><field name="NUM">${secondPrediction}</field></shadow></value>
  </block>
</xml>`;

describe('AI strategy intent validation', () => {
    it('requires the trade, purchase, and settlement blocks at the XML root', () => {
        const completeBot = `<xml is_dbot="true">
            <block type="trade_definition"/>
            <block type="before_purchase"><statement name="BEFOREPURCHASE_STACK"><block type="purchase"/></statement></block>
            <block type="after_purchase"/>
        </xml>`;
        expect(() => validateRequiredBotSections(completeBot)).not.toThrow();

        const nestedRoots = `<xml is_dbot="true">
            <block type="before_purchase">
                <statement name="BEFOREPURCHASE_STACK">
                    <block type="trade_definition"/>
                    <block type="after_purchase"/>
                    <block type="purchase"/>
                </statement>
            </block>
        </xml>`;
        expect(() => validateRequiredBotSections(nestedRoots)).toThrow('missing required bot sections');
    });

    it('explains which required bot section is missing so generation can retry accurately', () => {
        const missingPurchase = `<xml is_dbot="true">
            <block type="trade_definition"/>
            <block type="before_purchase"/>
            <block type="after_purchase"/>
        </xml>`;
        expect(() => validateRequiredBotSections(missingPurchase)).toThrow(
            'no purchase block was included',
        );

        const missingSettlement = `<xml is_dbot="true">
            <block type="trade_definition"/>
            <block type="before_purchase"><statement name="BEFOREPURCHASE_STACK"><block type="purchase"/></statement></block>
        </xml>`;
        expect(() => validateRequiredBotSections(missingSettlement)).toThrow(
            'after_purchase=0',
        );
    });

    it('detects requested digit contracts and strict digit rules', () => {
        expect(inferStrategyIntent(requestedStrategy)).toEqual({
            digitTradeTypes: ['DIGITOVER', 'DIGITUNDER'],
            digitContracts: [
                { type: 'DIGITOVER', prediction: 4 },
                { type: 'DIGITUNDER', prediction: 5 },
            ],
            digitRules: [
                { count: 4, condition: 'LESS_THAN', threshold: 4 },
                { count: 3, condition: 'GREATER_THAN', threshold: 5 },
            ],
            usesDigitOverUnder: true,
        });
    });

    it('recognizes a concise Over bot request as a Digit Over contract', () => {
        expect(inferStrategyIntent('Create over 3 bot on volatility 10 1s')).toEqual({
            digitTradeTypes: ['DIGITOVER'],
            digitContracts: [{ type: 'DIGITOVER', prediction: 3 }],
            digitRules: [],
            usesDigitOverUnder: true,
        });
    });

    it('accepts XML that preserves the requested contracts and comparisons', () => {
        expect(() => validateStrategyMatchesIntent(requestedStrategy, xml())).not.toThrow();
        expect(() => validateDigitRuleSupport(xml())).not.toThrow();
    });

    it('rejects a strategy that changes a strict threshold', () => {
        expect(() => validateStrategyMatchesIntent(requestedStrategy, xml(6))).toThrow(
            'digit conditions must match',
        );
    });

    it('rejects a strategy with the wrong purchase barrier or branch mapping', () => {
        expect(() => validateStrategyMatchesIntent(requestedStrategy, xml(5, 3))).toThrow(
            'wrong prediction barrier',
        );
        expect(() =>
            validateStrategyMatchesIntent(
                requestedStrategy,
                xml(5, 4, 5, 'DIGITUNDER', 'DIGITOVER'),
            ),
        ).toThrow('wrong prediction barrier');
    });

    it('rejects a strategy that silently switches to another contract family', () => {
        const wrongContract = xml().replace('>digits</field>', '>callput</field>').replace('>overunder</field>', '>risefall</field>');
        expect(() => validateStrategyMatchesIntent(requestedStrategy, wrongContract)).toThrow(
            'requested digit Over/Under',
        );
    });

    it('rejects blocks and shadow blocks missing from the active toolbox catalog', () => {
        const catalog = '<xml><block type="trade_definition"/><shadow type="math_number"/></xml>';
        expect(() =>
            validateBlocklyBlocksAvailable(
                '<xml><block type="trade_definition"/><shadow type="invented_shadow"/></xml>',
                catalog,
            ),
        ).toThrow('not in the active Bot Builder toolbox: invented_shadow');
    });

    it('builds a complete root scaffold from the active toolbox templates', () => {
        const catalog = `<xml>
            <category>
                <block type="trade_definition"><statement name="TRADE_OPTIONS"><block type="trade_definition_market"/></statement></block>
                <block type="trade_definition_tradeoptions"><value name="AMOUNT"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block>
                <block type="before_purchase"/>
                <block type="after_purchase"/>
            </category>
        </xml>`;

        const scaffold = buildBotScaffold(catalog);
        expect(scaffold).toContain('is_dbot="true"');
        expect(scaffold).toContain('<block type="trade_definition">');
        expect(scaffold).toContain('<statement name="SUBMARKET"><block type="trade_definition_tradeoptions">');
        expect(scaffold).toContain('<block type="before_purchase"/>');
        expect(scaffold).toContain('<block type="after_purchase"/>');
    });

    it('validates and recognizes safe AI-generated purchase blocks', () => {
        const customPurchase = {
            type: 'ai_digit_under',
            message: 'Buy %1 with prediction %2',
            tooltip: 'Places the selected one-tick contract.',
            method: 'purchase',
            outputType: 'Statement',
            arguments: [
                {
                    kind: 'dropdown',
                    name: 'CONTRACT',
                    check: null,
                    defaultValue: 'DIGITUNDER',
                    options: [
                        { label: 'Under', value: 'DIGITUNDER' },
                        { label: 'Over', value: 'DIGITOVER' },
                    ],
                },
                { kind: 'number', name: 'PREDICTION', check: null, defaultValue: 6, options: [] },
            ],
            bindings: [
                { source: 'field', name: 'CONTRACT' },
                { source: 'field', name: 'PREDICTION' },
            ],
        } as const;
        const xml = `<xml is_dbot="true">
            <block type="trade_definition"/>
            <block type="before_purchase">
                <statement name="BEFOREPURCHASE_STACK"><block type="ai_digit_under"/></statement>
            </block>
            <block type="after_purchase"/>
        </xml>`;
        const definitions = validateAiGeneratedBlocks([customPurchase]);

        expect(() => validateRequiredBotSections(xml, definitions)).not.toThrow();
        expect(() =>
            validateStrategyBlockDefinitions(xml, definitions, [
                'trade_definition',
                'before_purchase',
                'after_purchase',
            ]),
        ).not.toThrow();
        expect(() => validateRequiredBotSections(xml)).toThrow('missing required bot sections');
    });

    it('rejects custom block code, unsafe operations, and unapproved dropdown values', () => {
        const safeBlock = {
            type: 'ai_last_digit_test',
            message: 'Latest digit',
            tooltip: 'Checks the latest digit.',
            method: 'getLastDigit',
            outputType: 'Number',
            arguments: [],
            bindings: [],
        };

        expect(validateAiGeneratedBlocks([safeBlock])).toHaveLength(1);
        expect(() =>
            validateAiGeneratedBlocks([{ ...safeBlock, method: 'eval', outputType: 'Number' }]),
        ).toThrow('unsupported operation');

        const malformedXml = '<xml><block type="ai_not_defined"/></xml>';
        expect(() => validateStrategyBlockDefinitions(malformedXml, [], [])).toThrow(
            'missing definitions for AI-generated blocks',
        );
    });

    it('checks requested digit rules and barriers when they use AI-created blocks', () => {
        const customCondition = {
            type: 'ai_last_digits_condition',
            message: 'Check %1 digits %2 %3',
            tooltip: 'Checks a condition across recent digits.',
            method: 'checkLastDigitsCondition',
            outputType: 'Boolean',
            arguments: [
                {
                    kind: 'dropdown',
                    name: 'CONDITION',
                    check: null,
                    defaultValue: 'GREATER_THAN',
                    options: [{ label: 'over', value: 'GREATER_THAN' }, { label: 'below', value: 'LESS_THAN' }],
                },
                { kind: 'number', name: 'COUNT', check: null, defaultValue: 3, options: [] },
                { kind: 'number', name: 'THRESHOLD', check: null, defaultValue: 5, options: [] },
            ],
            bindings: [
                { source: 'field', name: 'CONDITION' },
                { source: 'field', name: 'COUNT' },
                { source: 'field', name: 'THRESHOLD' },
            ],
        } as const;
        const customPurchase = {
            type: 'ai_digit_under',
            message: 'Buy %1 at %2',
            tooltip: 'Places a one-tick digit contract.',
            method: 'purchase',
            outputType: 'Statement',
            arguments: [
                {
                    kind: 'dropdown',
                    name: 'CONTRACT',
                    check: null,
                    defaultValue: 'DIGITUNDER',
                    options: [{ label: 'Under', value: 'DIGITUNDER' }, { label: 'Over', value: 'DIGITOVER' }],
                },
                { kind: 'number', name: 'PREDICTION', check: null, defaultValue: 6, options: [] },
            ],
            bindings: [
                { source: 'field', name: 'CONTRACT' },
                { source: 'field', name: 'PREDICTION' },
            ],
        } as const;
        const xml = `<xml is_dbot="true">
            <block type="trade_definition"><statement name="TRADE_OPTIONS">
                <block type="trade_definition_market"><next>
                    <block type="trade_definition_tradetype">
                        <field name="TRADETYPECAT_LIST">digits</field>
                        <field name="TRADETYPE_LIST">overunder</field>
                        <next><block type="trade_definition_contracttype">
                            <field name="TYPE_LIST">DIGITUNDER</field>
                        </block></next>
                    </block>
                </next></block>
            </statement></block>
            <block type="before_purchase"><statement name="BEFOREPURCHASE_STACK">
                <block type="ai_last_digits_condition">
                    <field name="CONDITION">GREATER_THAN</field>
                    <field name="COUNT">3</field>
                    <field name="THRESHOLD">5</field>
                    <next><block type="ai_digit_under">
                        <field name="CONTRACT">DIGITUNDER</field>
                        <field name="PREDICTION">6</field>
                    </block></next>
                </block>
            </statement></block>
            <block type="after_purchase"/>
        </xml>`;
        const definitions = validateAiGeneratedBlocks([customCondition, customPurchase]);

        expect(() =>
            validateStrategyMatchesIntent('Under 6 when the last 3 digits are over 5', xml, definitions),
        ).not.toThrow();
    });
});
