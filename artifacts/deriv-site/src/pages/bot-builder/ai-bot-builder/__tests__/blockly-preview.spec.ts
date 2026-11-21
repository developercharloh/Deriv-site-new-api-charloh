jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
}));

import { validateGeneratedBotXml } from '../blockly-preview';

const validXml = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
    <block type="trade_definition">
        <statement name="TRADE_OPTIONS">
            <block type="trade_definition_market" />
        </statement>
    </block>
    <block type="before_purchase">
        <statement name="BEFOREPURCHASE_STACK">
            <block type="purchase" />
        </statement>
    </block>
    <block type="after_purchase" />
</xml>`;

const availableBlocks = [
    'trade_definition',
    'trade_definition_market',
    'trade_definition_tradetype',
    'trade_definition_contracttype',
    'before_purchase',
    'controls_if',
    'last_digits_condition',
    'apollo_purchase2',
    'math_number',
    'math_number_positive',
    'purchase',
    'after_purchase',
];

const generatedDigitXml = validXml.replace(
    '<block type="purchase" />',
    `<block type="controls_if">
        <mutation elseif="1" />
        <value name="IF0">
            <block type="last_digits_condition">
                <field name="CONDITION">LESS_THAN</field>
                <value name="N"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
                <value name="COMPARE_VALUE"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
            </block>
        </value>
        <statement name="DO0">
            <block type="apollo_purchase2">
                <field name="PURCHASE_LIST">DIGITOVER</field>
                <value name="PREDICTION"><shadow type="math_number_positive"><field name="NUM">4</field></shadow></value>
            </block>
        </statement>
        <value name="IF1">
            <block type="last_digits_condition">
                <field name="CONDITION">GREATER_THAN</field>
                <value name="N"><shadow type="math_number"><field name="NUM">3</field></shadow></value>
                <value name="COMPARE_VALUE"><shadow type="math_number"><field name="NUM">5</field></shadow></value>
            </block>
        </value>
        <statement name="DO1">
            <block type="apollo_purchase2">
                <field name="PURCHASE_LIST">DIGITUNDER</field>
                <value name="PREDICTION"><shadow type="math_number_positive"><field name="NUM">5</field></shadow></value>
            </block>
        </statement>
    </block>`
);

describe('validateGeneratedBotXml', () => {
    beforeEach(() => {
        (window as any).Blockly = {
            Blocks: Object.fromEntries(availableBlocks.map(type => [type, {}])),
            utils: {
                xml: {
                    textToDom: (xml: string) => {
                        const document = new DOMParser().parseFromString(xml, 'application/xml');
                        if (document.getElementsByTagName('parsererror').length) throw new Error('Invalid XML');
                        return document.documentElement;
                    },
                },
            },
        };
    });

    it('accepts a valid Deriv bot document with required root sections', () => {
        expect(validateGeneratedBotXml(validXml).localName).toBe('xml');
    });

    it('accepts a generated Over/Under strategy with strict digit blocks', () => {
        expect(validateGeneratedBotXml(generatedDigitXml).localName).toBe('xml');
    });

    it('rejects an unknown block before preview or loading', () => {
        const xml = validXml.replace('</statement>\n    </block>', '<block type="unknown_signal" /></statement>\n    </block>');

        expect(() => validateGeneratedBotXml(xml)).toThrow('not available in this workspace');
    });

    it('rejects documents missing required top-level sections', () => {
        const xml = validXml.replace('<block type="after_purchase" />', '');

        expect(() => validateGeneratedBotXml(xml)).toThrow('missing a required trade');
    });
});
