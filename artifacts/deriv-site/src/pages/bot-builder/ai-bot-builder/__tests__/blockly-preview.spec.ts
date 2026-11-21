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
    'before_purchase',
    'purchase',
    'after_purchase',
];

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

    it('rejects an unknown block before preview or loading', () => {
        const xml = validXml.replace('</statement>\n    </block>', '<block type="unknown_signal" /></statement>\n    </block>');

        expect(() => validateGeneratedBotXml(xml)).toThrow('not available in this workspace');
    });

    it('rejects documents missing required top-level sections', () => {
        const xml = validXml.replace('<block type="after_purchase" />', '');

        expect(() => validateGeneratedBotXml(xml)).toThrow('missing a required trade');
    });
});
