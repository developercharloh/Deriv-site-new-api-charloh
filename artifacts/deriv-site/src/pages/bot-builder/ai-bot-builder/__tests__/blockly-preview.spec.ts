jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
}));

import { getBotBuilderBlockCatalog, validateGeneratedBotXml } from '../blockly-preview';
import { ToolboxItems } from '../../toolbox/toolbox-items';
import ReactDomServer from 'react-dom/server';

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

const renderToolboxElement = (node: any): string => {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') {
        return String(node).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    if (Array.isArray(node)) return node.map(renderToolboxElement).join('');

    const element = typeof node.type === 'function' ? node.type(node.props) : node;
    if (element !== node) return renderToolboxElement(element);
    const attributes = Object.entries(node.props || {})
        .filter(([name, value]) => name !== 'children' && value !== undefined && value !== null)
        .map(([name, value]) => ` ${name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
        .join('');
    return `<${node.type}${attributes}>${renderToolboxElement(node.props?.children)}</${node.type}>`;
};

describe('validateGeneratedBotXml', () => {
    beforeEach(() => {
        (window as any).Blockly = {
            Blocks: Object.fromEntries(availableBlocks.map(type => [type, {}])),
            Xml: {
                domToText: (xml: Element) => new XMLSerializer().serializeToString(xml),
            },
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

    it('exports registered blocks and their real toolbox templates for generation', () => {
        const toolbox = new DOMParser().parseFromString(
            `<xml>
                <category id="trade_parameters"><block type="trade_definition"><statement name="TRADE_OPTIONS"><block type="trade_definition_market"/></statement></block></category>
                <category id="indicators"><block type="macd_value"><value name="INPUT"><shadow type="math_number"/></value></block></category>
                <category id="not-used"><block type="unknown_block"/></category>
            </xml>`,
            'application/xml',
        ).documentElement;
        (window as any).Blockly.derivWorkspace = { options: { languageTree: toolbox } };
        (window as any).Blockly.Xml.domToText = (xml: Element) => new XMLSerializer().serializeToString(xml);
        (window as any).Blockly.Blocks.macd_value = {};
        (window as any).Blockly.Blocks.unknown_block = {};

        const catalog = getBotBuilderBlockCatalog();

        expect(catalog).toContain('trade_definition_market');
        expect(catalog).toContain('macd_value');
        expect(catalog).not.toContain('unknown_block');
    });

    it('keeps the full current strategy toolbox catalog within the API request limit', () => {
        console.log('server module', jest.requireMock('react-dom/server'), ReactDomServer);
        (ReactDomServer as any).renderToStaticMarkup.mockImplementation(renderToolboxElement);
        const toolboxMarkup = ToolboxItems();
        const toolbox = new DOMParser().parseFromString(toolboxMarkup, 'text/xml').documentElement;
        console.log(toolboxMarkup.slice(0, 400), toolbox.localName, toolbox.getElementsByTagName('*').length);
        const registeredTypes = Array.from(toolbox.getElementsByTagName('*'))
            .filter(node => node.localName === 'block' || node.localName === 'shadow')
            .map(node => node.getAttribute('type') || '')
            .filter(Boolean);
        (window as any).Blockly.Blocks = Object.fromEntries(registeredTypes.map(type => [type, {}]));
        (window as any).Blockly.derivWorkspace = { options: { languageTree: toolbox } };

        const catalog = getBotBuilderBlockCatalog();

        expect(catalog.length).toBeGreaterThan(0);
        expect(catalog.length).toBeLessThanOrEqual(75000);
        expect(catalog).toContain('trade_definition_market');
        expect(catalog).toContain('last_digits_condition');
        expect(catalog).toContain('macd_value');
        expect(catalog).toContain('controls_if');
    });

    it('verifies that generated fields and input connections load into a real workspace', () => {
        class TestWorkspace {
            blocks: any[] = [];
            getAllBlocks() {
                return this.blocks;
            }
            getBlockById(id: string) {
                return this.blocks.find(block => block.id === id);
            }
            dispose() {}
        }

        (window as any).Blockly.Workspace = TestWorkspace;
        (window as any).Blockly.Events = { disable: jest.fn(), enable: jest.fn() };
        (window as any).Blockly.Xml.domToWorkspace = (xml: Element, workspace: TestWorkspace) => {
            const nodes = Array.from(xml.getElementsByTagName('*')).filter(
                node => node.localName === 'block' || node.localName === 'shadow',
            );
            const supportedFields: Record<string, string[]> = { math_number: ['NUM'] };
            const supportedInputs: Record<string, string[]> = {
                trade_definition: ['TRADE_OPTIONS'],
                before_purchase: ['BEFOREPURCHASE_STACK'],
                after_purchase: ['AFTERPURCHASE_STACK'],
            };
            workspace.blocks = nodes.map(node => ({
                id: node.getAttribute('id'),
                type: node.getAttribute('type'),
                getField: (name: string) => (supportedFields[node.getAttribute('type') || ''] || []).includes(name) ? {} : null,
                getInput: (name: string) => (supportedInputs[node.getAttribute('type') || ''] || []).includes(name) ? {} : null,
                getInputTargetBlock: (name: string) => {
                    const input = Array.from(node.children).find(
                        child =>
                            (child.localName === 'value' || child.localName === 'statement') &&
                            child.getAttribute('name') === name,
                    );
                    return input && Array.from(input.children).some(
                        child => child.localName === 'block' || child.localName === 'shadow',
                    )
                        ? {}
                        : null;
                },
                getNextBlock: () => null,
            }));
        };

        expect(() => validateGeneratedBotXml(validXml, { verifyWorkspace: true })).not.toThrow();

        const invalidFieldXml = validXml.replace(
            '<block type="trade_definition">',
            '<block type="trade_definition"><field name="UNKNOWN">x</field>',
        );
        expect(() => validateGeneratedBotXml(invalidFieldXml, { verifyWorkspace: true })).toThrow(
            'does not support its "UNKNOWN" field',
        );
        expect((window as any).Blockly.Events.disable).toHaveBeenCalled();
        expect((window as any).Blockly.Events.enable).toHaveBeenCalled();
    });
});
