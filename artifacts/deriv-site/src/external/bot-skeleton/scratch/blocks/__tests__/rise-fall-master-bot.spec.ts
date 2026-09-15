import fs from 'fs';
import path from 'path';

import * as BlocklyNamespace from 'blockly';
import * as BlocklyJavaScriptNamespace from 'blockly/javascript';

jest.mock('../../utils', () => ({
    modifyContextMenu: jest.fn(),
    runIrreversibleEvents: (callback: () => void) => callback(),
}));

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values: Record<string, string> = {}) =>
        text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`),
    useTranslations: () => ({
        localize: (text: string, values: Record<string, string> = {}) =>
            text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`),
        currentLang: 'EN',
    }),
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => i18n_default_text,
    getAllowedLanguages: () => ({ EN: 'English' }),
    initializeI18n: () => undefined,
}));

describe('Rise/Fall Master Bot XML', () => {
    let Blockly: typeof BlocklyNamespace.default;
    let javascriptGenerator: typeof BlocklyJavaScriptNamespace.javascriptGenerator;
    const dependentFieldNames = [
        'MARKET_LIST',
        'SUBMARKET_LIST',
        'SYMBOL_LIST',
        'TRADETYPECAT_LIST',
        'TRADETYPE_LIST',
        'TYPE_LIST',
        'DURATIONTYPE_LIST',
        'PURCHASE_LIST',
    ];

    beforeAll(async () => {
        Blockly = (BlocklyNamespace.default ?? BlocklyNamespace) as typeof BlocklyNamespace.default;
        javascriptGenerator = BlocklyJavaScriptNamespace.javascriptGenerator;

        Blockly.Colours = {
            Base: {
                colour: '#4c97ff',
                colourSecondary: '#3373cc',
                colourTertiary: '#2855a6',
            },
            RootBlock: {
                colour: '#0f6b78',
                colourSecondary: '#0b4d56',
                colourTertiary: '#08343a',
            },
            Special1: {
                colour: '#8b5cf6',
                colourSecondary: '#6d28d9',
                colourTertiary: '#4c1d95',
            },
            Special2: {
                colour: '#f59e0b',
                colourSecondary: '#d97706',
                colourTertiary: '#92400e',
            },
            Special3: {
                colour: '#10b981',
                colourSecondary: '#059669',
                colourTertiary: '#047857',
            },
            Special4: {
                colour: '#ef4444',
                colourSecondary: '#dc2626',
                colourTertiary: '#991b1b',
            },
        };
        Blockly.Categories = {
            Indicators: 'Indicators',
            Before_Purchase: 'Before Purchase',
            Tick_Analysis: 'Tick Analysis',
            Logic: 'Logic',
            Text: 'Text',
            Math: 'Math',
            Lists: 'Lists',
            Variables: 'Variables',
            Functions: 'Functions',
            Advanced: 'Advanced',
            Binary: 'Binary',
            Tools: 'Tools',
            After_Purchase: 'After Purchase',
            During_Purchase: 'During Purchase',
            Trade_Definition: 'Trade Definition',
        };
        Blockly.JavaScript = {
            ...BlocklyJavaScriptNamespace,
            javascriptGenerator,
        } as typeof Blockly.JavaScript;
        window.Blockly = Blockly;
        (Blockly.Block.prototype as any).initSvg = jest.fn();
        (Blockly.Block.prototype as any).renderEfficiently = jest.fn();
        (Blockly.Block.prototype as any).queueRender = jest.fn();

        await import('blockly/blocks');
        await import('../index');
    });

    const readFieldValues = (xml: Document, name: string): string[] =>
        Array.from(xml.getElementsByTagName('field'))
            .filter(field => field.getAttribute('name') === name)
            .map(field => field.textContent?.trim() ?? '');

    const removeDependentFields = (xml: Document): Document => {
        const importDom = xml.cloneNode(true) as Document;
        Array.from(importDom.getElementsByTagName('field'))
            .filter(field => dependentFieldNames.includes(field.getAttribute('name') ?? ''))
            .forEach(field => field.parentNode?.removeChild(field));
        return importDom;
    };

    const setDropdownOptions = (block: any, fieldName: string, options: string[][], value: string): void => {
        const field = block.getField(fieldName);
        field.menuGenerator_ = options;
        field.setValue(value);
    };

    const restoreDependentSelections = (workspace: BlocklyNamespace.Workspace): void => {
        const marketBlock = workspace.getBlockById('td_mkt');
        const tradeTypeBlock = workspace.getBlockById('td_tt');
        const contractTypeBlock = workspace.getBlockById('td_ct');
        const durationBlock = workspace.getBlockById('td_opts');

        expect(marketBlock).toBeDefined();
        expect(tradeTypeBlock).toBeDefined();
        expect(contractTypeBlock).toBeDefined();
        expect(durationBlock).toBeDefined();

        // These options represent the active-symbol response used by the editor.
        // Restore each child only after its parent options have been hydrated.
        setDropdownOptions(marketBlock, 'MARKET_LIST', [['Synthetic Indices', 'synthetic_index']], 'synthetic_index');
        setDropdownOptions(
            marketBlock,
            'SUBMARKET_LIST',
            [['Random Indices', 'random_index']],
            'random_index'
        );
        setDropdownOptions(
            marketBlock,
            'SYMBOL_LIST',
            [['Volatility 100 (1s) Index', '1HZ100V']],
            '1HZ100V'
        );
        setDropdownOptions(tradeTypeBlock, 'TRADETYPECAT_LIST', [['Rise/Fall', 'callput']], 'callput');
        setDropdownOptions(tradeTypeBlock, 'TRADETYPE_LIST', [['Rise/Fall', 'callput']], 'callput');

        // Contracts-for supplies contract type and duration options after the
        // trade type has been restored. Purchase options depend on both values.
        setDropdownOptions(contractTypeBlock, 'TYPE_LIST', [['Both', 'both']], 'both');
        setDropdownOptions(durationBlock, 'DURATIONTYPE_LIST', [['Ticks', 't']], 't');
        workspace
            .getAllBlocks(false)
            .filter(block => block.type === 'purchase' || block.type === 'payout')
            .forEach(block => {
                setDropdownOptions(
                    block,
                    'PURCHASE_LIST',
                    [
                        ['Rise', 'CALL'],
                        ['Fall', 'PUT'],
                    ],
                    block.id === 'bp_put' ? 'PUT' : 'CALL'
                );
            });
    };

    it('imports and generates the live indicator and safety gate', () => {
        const xmlPath = path.resolve(__dirname, '../../../../../../public/bots/Rise_Fall_Master_Bot.xml');
        const xmlText = fs.readFileSync(xmlPath, 'utf8');
        const sourceDom = Blockly.utils.xml.textToDom(xmlText);
        const importDom = removeDependentFields(sourceDom);

        const workspace = new Blockly.Workspace();
        expect(() => Blockly.Xml.domToWorkspace(importDom, workspace)).not.toThrow();

        const blockTypes = new Set(workspace.getAllBlocks(false).map(block => block.type));
        [
            'indicator_ready',
            'no_active_contract',
            'consecutive_loss_gate',
            'payout_gate',
            'session_risk_gate',
            'model_confidence_gate',
            'models_agree',
            'adx_value',
            'atr_value',
            'ichimoku_value',
            'stochastic_value',
            'macd_value',
            'rsi_value',
            'bollinger_value',
            'bollinger_squeeze',
        ].forEach(type => expect(blockTypes).toContain(type));

        javascriptGenerator.init(workspace);
        (Blockly.JavaScript as any).variableDB_ = (javascriptGenerator as any).nameDB_;
        const gateBlock = workspace.getBlockById('bp_gate_if');
        expect(gateBlock).toBeDefined();
        const gateCondition = gateBlock!.getInputTargetBlock('IF0');
        expect(gateCondition).toBeDefined();
        const generatedResult = javascriptGenerator.blockToCode(gateCondition!);
        const generated = Array.isArray(generatedResult) ? generatedResult[0] : generatedResult;
        expect(generated).toContain('Bot.canOpenNewContract()');
        expect(generated).toContain('Bot.getModelConfidence');
        expect(generated).toContain('Bot.getIchimokuValue');
        expect(generated).toContain('Bot.isBollingerSqueeze');

        workspace.dispose();
    });

    it('uses the balanced Adaptive Momentum profile', () => {
        const xmlPath = path.resolve(__dirname, '../../../../../../public/bots/Rise_Fall_Master_Bot.xml');
        const xmlText = fs.readFileSync(xmlPath, 'utf8');
        const sourceDom = Blockly.utils.xml.textToDom(xmlText);
        const workspace = new Blockly.Workspace();

        expect(() => Blockly.Xml.domToWorkspace(removeDependentFields(sourceDom), workspace)).not.toThrow();

        const signalBlock = workspace.getBlockById('bp_adaptive_signal');
        expect(signalBlock?.getInputTargetBlock('WARMUP')?.getFieldValue('NUM')).toBe(30);
        expect(signalBlock?.getInputTargetBlock('SHORT_WINDOW')?.getFieldValue('NUM')).toBe(6);
        expect(signalBlock?.getInputTargetBlock('LONG_WINDOW')?.getFieldValue('NUM')).toBe(14);
        expect(signalBlock?.getInputTargetBlock('CONFIDENCE')?.getFieldValue('NUM')).toBe(55);

        const noContractGate = workspace.getBlockById('bp_no_contract');
        const lossGate = workspace.getBlockById('bp_loss_gate');
        const payoutGate = workspace.getBlockById('bp_payout_gate');
        const payoutBlock = payoutGate?.getInputTargetBlock('PAYOUT');
        expect(payoutBlock).toBeDefined();
        setDropdownOptions(payoutBlock, 'PURCHASE_LIST', [['Rise', 'CALL'], ['Fall', 'PUT']], 'CALL');
        expect(noContractGate?.type).toBe('no_active_contract');
        expect(lossGate?.getInputTargetBlock('MAX_LOSSES')?.getFieldValue('NUM')).toBe(3);
        expect(payoutBlock?.type).toBe('payout');
        expect(payoutBlock?.getFieldValue('PURCHASE_LIST')).toBe('CALL');
        expect(payoutGate?.getInputTargetBlock('REQUIRED_WIN_RATE')?.getFieldValue('NUM')).toBe(62.5);

        workspace.dispose();
    });

    it('imports the reusable Adaptive Momentum preset with its safety gates', () => {
        const xmlPath = path.resolve(__dirname, '../../../../../../src/xml/adaptive_momentum.xml');
        const sourceDom = Blockly.utils.xml.textToDom(fs.readFileSync(xmlPath, 'utf8'));
        const workspace = new Blockly.Workspace();

        expect(() => Blockly.Xml.domToWorkspace(removeDependentFields(sourceDom), workspace)).not.toThrow();
        expect(workspace.getBlockById('adaptive_signal_block')?.type).toBe('adaptive_momentum_signal');
        expect(workspace.getBlockById('adaptive_no_active_contract')?.type).toBe('no_active_contract');
        expect(workspace.getBlockById('adaptive_consecutive_loss_gate')?.getInputTargetBlock('MAX_LOSSES')?.getFieldValue('NUM')).toBe(3);
        expect(workspace.getBlockById('adaptive_payout_gate')?.getInputTargetBlock('REQUIRED_WIN_RATE')?.getFieldValue('NUM')).toBe(62.5);
        expect(workspace.getBlockById('adaptive_signal_block')?.getInputTargetBlock('CONFIDENCE')?.getFieldValue('NUM')).toBe(55);

        workspace.dispose();
    });

    it('preserves saved market and contract selections after live option hydration', () => {
        const xmlPath = path.resolve(__dirname, '../../../../../../public/bots/Rise_Fall_Master_Bot.xml');
        const xmlText = fs.readFileSync(xmlPath, 'utf8');
        const sourceDom = Blockly.utils.xml.textToDom(xmlText);
        const savedSelections = Object.fromEntries(
            dependentFieldNames.map(name => [name, readFieldValues(sourceDom, name)])
        );

        // Keep the complete strategy structure, but let the focused regression
        // exercise the same post-import restoration used when API dropdowns
        // were empty at the moment Blockly created the blocks.
        const importDom = removeDependentFields(sourceDom);

        const workspace = new Blockly.Workspace();
        expect(() => Blockly.Xml.domToWorkspace(importDom, workspace)).not.toThrow();

        restoreDependentSelections(workspace);

        expect(workspace.getBlockById('td_mkt')?.getFieldValue('MARKET_LIST')).toBe(savedSelections.MARKET_LIST[0]);
        expect(workspace.getBlockById('td_mkt')?.getFieldValue('SUBMARKET_LIST')).toBe(
            savedSelections.SUBMARKET_LIST[0]
        );
        expect(workspace.getBlockById('td_mkt')?.getFieldValue('SYMBOL_LIST')).toBe(savedSelections.SYMBOL_LIST[0]);
        expect(workspace.getBlockById('td_tt')?.getFieldValue('TRADETYPECAT_LIST')).toBe(
            savedSelections.TRADETYPECAT_LIST[0]
        );
        expect(workspace.getBlockById('td_tt')?.getFieldValue('TRADETYPE_LIST')).toBe(
            savedSelections.TRADETYPE_LIST[0]
        );
        expect(workspace.getBlockById('td_ct')?.getFieldValue('TYPE_LIST')).toBe(savedSelections.TYPE_LIST[0]);
        expect(workspace.getBlockById('td_opts')?.getFieldValue('DURATIONTYPE_LIST')).toBe(
            savedSelections.DURATIONTYPE_LIST[0]
        );

        const restoredPurchases = workspace
            .getAllBlocks(false)
            .filter(block => block.type === 'purchase' || block.type === 'payout')
            .map(block => block.getFieldValue('PURCHASE_LIST'));
        expect(restoredPurchases).toEqual(savedSelections.PURCHASE_LIST);

        workspace.dispose();
    });

    it('preserves digit contract settings instead of defaulting to callput values', () => {
        const xmlPath = path.resolve(__dirname, '../../../../../../public/bots/Over_Under_Manual_Trading_Bot.xml');
        const xmlText = fs.readFileSync(xmlPath, 'utf8');
        const sourceDom = Blockly.utils.xml.textToDom(xmlText);
        const savedSelections = Object.fromEntries(
            dependentFieldNames.map(name => [name, readFieldValues(sourceDom, name)])
        );
        const importDom = removeDependentFields(sourceDom);

        const workspace = new Blockly.Workspace();
        expect(() => Blockly.Xml.domToWorkspace(importDom, workspace)).not.toThrow();

        const marketBlock = workspace.getBlockById('ou_mkt');
        const tradeTypeBlock = workspace.getBlockById('ou_tt');
        const contractTypeBlock = workspace.getBlockById('ou_ct');
        const durationBlock = workspace.getBlockById('ou_to');

        expect(marketBlock).toBeDefined();
        expect(tradeTypeBlock).toBeDefined();
        expect(contractTypeBlock).toBeDefined();
        expect(durationBlock).toBeDefined();

        // Put a different digit purchase first to ensure a default selection
        // cannot accidentally pass this regression.
        setDropdownOptions(marketBlock, 'MARKET_LIST', [['Synthetic Indices', 'synthetic_index']], 'synthetic_index');
        setDropdownOptions(
            marketBlock,
            'SUBMARKET_LIST',
            [['Random Indices', 'random_index']],
            'random_index'
        );
        setDropdownOptions(
            marketBlock,
            'SYMBOL_LIST',
            [['Volatility 75 Index', '1HZ75V']],
            '1HZ75V'
        );
        setDropdownOptions(tradeTypeBlock, 'TRADETYPECAT_LIST', [['Digits', 'digits']], 'digits');
        setDropdownOptions(tradeTypeBlock, 'TRADETYPE_LIST', [['Over/Under', 'overunder']], 'overunder');
        setDropdownOptions(contractTypeBlock, 'TYPE_LIST', [['Both', 'both']], 'both');
        setDropdownOptions(durationBlock, 'DURATIONTYPE_LIST', [['Ticks', 't']], 't');

        workspace
            .getAllBlocks(false)
            .filter(block => block.getField?.('PURCHASE_LIST'))
            .forEach((block, index) => {
                setDropdownOptions(
                    block,
                    'PURCHASE_LIST',
                    [
                        ['Under', 'DIGITUNDER'],
                        ['Over', 'DIGITOVER'],
                    ],
                    savedSelections.PURCHASE_LIST[index]
                );
            });

        expect(marketBlock?.getFieldValue('MARKET_LIST')).toBe(savedSelections.MARKET_LIST[0]);
        expect(marketBlock?.getFieldValue('SUBMARKET_LIST')).toBe(savedSelections.SUBMARKET_LIST[0]);
        expect(marketBlock?.getFieldValue('SYMBOL_LIST')).toBe(savedSelections.SYMBOL_LIST[0]);
        expect(tradeTypeBlock?.getFieldValue('TRADETYPECAT_LIST')).toBe(savedSelections.TRADETYPECAT_LIST[0]);
        expect(tradeTypeBlock?.getFieldValue('TRADETYPE_LIST')).toBe(savedSelections.TRADETYPE_LIST[0]);
        expect(contractTypeBlock?.getFieldValue('TYPE_LIST')).toBe(savedSelections.TYPE_LIST[0]);
        expect(durationBlock?.getFieldValue('DURATIONTYPE_LIST')).toBe(savedSelections.DURATIONTYPE_LIST[0]);

        const restoredPurchases = workspace
            .getAllBlocks(false)
            .filter(block => block.getField?.('PURCHASE_LIST'))
            .map(block => block.getFieldValue('PURCHASE_LIST'));
        expect(restoredPurchases).toEqual(savedSelections.PURCHASE_LIST);

        workspace.dispose();
    });
});
