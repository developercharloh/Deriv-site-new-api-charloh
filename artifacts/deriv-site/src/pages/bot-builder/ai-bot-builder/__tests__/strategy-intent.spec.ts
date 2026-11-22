import {
    inferStrategyIntent,
    validateBlocklyBlocksAvailable,
    validateDigitRuleSupport,
    validateRequiredBotSections,
    validateStrategyMatchesIntent,
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
});
