import fs from 'fs';
import path from 'path';
import { getSmartOver2RecoveryContractType, shouldShowJournalEntryForBot } from '@/utils/bot-template-scope';

const catalogPath = path.resolve(__dirname, '..', 'index.tsx');
const publicBotsPath = path.resolve(__dirname, '../../../../public/bots');

const readCatalogXmlPaths = (): string[] => {
    const catalog = fs.readFileSync(catalogPath, 'utf8');
    return Array.from(catalog.matchAll(/xmlPath:\s*'([^']+)'/g), match => match[1]);
};

const readCatalogBotSections = (): { id: string; section: string; xmlPath: string }[] => {
    const catalog = fs.readFileSync(catalogPath, 'utf8');
    const start = catalog.indexOf('const BOTS: BotConfig[] = [');
    const end = catalog.indexOf('\n];', start);
    const botDefinitions = catalog.slice(start, end);

    const objectBodies = Array.from(
        botDefinitions.matchAll(/^    \{\s*([\s\S]*?)^    \},?$/gm),
        match => match[1]
    );
    return objectBodies.flatMap(body => {
        const id = body.match(/^\s*id:\s*'([^']+)'/m)?.[1];
        const section = body.match(/^\s*section:\s*'([^']+)'/m)?.[1];
        const xmlPath = body.match(/^\s*xmlPath:\s*'([^']+)'/m)?.[1];
        return id && section && xmlPath ? [{ id, section, xmlPath }] : [];
    });
};

const readCustomBlockTypes = (): Set<string> => {
    const customBlocksPath = path.resolve(__dirname, '../../../external/bot-skeleton/scratch/blocks/Custom');
    const customSources = fs
        .readdirSync(customBlocksPath)
        .filter(fileName => fileName.endsWith('.js'))
        .map(fileName => fs.readFileSync(path.join(customBlocksPath, fileName), 'utf8'));
    const blockTypes = new Set<string>();

    customSources.forEach(source => {
        Array.from(source.matchAll(/window\.Blockly\.Blocks\.([a-zA-Z0-9_]+)\s*=/g), match =>
            blockTypes.add(match[1])
        );
        Array.from(
            source.matchAll(/register(?:OutputBlock|Output|Boolean)\(\s*\{\s*type:\s*'([a-zA-Z0-9_]+)'/g),
            match => blockTypes.add(match[1])
        );
    });

    return blockTypes;
};

describe('Free Bots template catalog', () => {
    it('references unique, existing, well-formed Blockly XML templates', () => {
        const xmlPaths = readCatalogXmlPaths();

        expect(xmlPaths.length).toBeGreaterThan(0);
        expect(new Set(xmlPaths).size).toBe(xmlPaths.length);

        for (const xmlPath of xmlPaths) {
            expect(xmlPath).toMatch(/^\/bots\/[^/]+\.xml$/);

            const templatePath = path.join(publicBotsPath, xmlPath.slice('/bots/'.length));
            expect(fs.existsSync(templatePath)).toBe(true);

            const xml = fs.readFileSync(templatePath, 'utf8');
            const document = new DOMParser().parseFromString(xml, 'application/xml');

            expect(document.querySelector('parsererror')).toBeNull();
            expect(document.documentElement.localName).toBe('xml');
            expect(document.querySelectorAll('block').length).toBeGreaterThan(0);
        }
    });

    it('keeps Blockly bot placement tied to custom blocks and registers Edging pro as a native runner', () => {
        const entries = readCatalogBotSections();
        const customBlockTypes = readCustomBlockTypes();

        expect(entries).toHaveLength(readCatalogXmlPaths().length);
        expect(entries.map(entry => entry.id)).toHaveLength(new Set(entries.map(entry => entry.id)).size);

        for (const entry of entries) {
            const templatePath = path.join(publicBotsPath, entry.xmlPath.slice('/bots/'.length));
            const xml = fs.readFileSync(templatePath, 'utf8');
            const document = new DOMParser().parseFromString(xml, 'application/xml');
            const usesCustomBlock = Array.from(document.querySelectorAll('block[type], shadow[type]')).some(block =>
                customBlockTypes.has(block.getAttribute('type') || '')
            );

            expect(entry.section).toBe(usesCustomBlock ? 'premium' : 'smart-contract');
        }

        const catalogSource = fs.readFileSync(path.join(__dirname, '..', 'index.tsx'), 'utf8');
        expect(catalogSource).toMatch(
            /id: 'edging-pro-engine',\s*section: 'edging',[\s\S]*?nativeRunner: 'edging-pro'/
        );
    });

    it('keeps Rise/Fall journal variables out of the Apex AI template', () => {
        const apexXml = fs.readFileSync(path.join(publicBotsPath, 'Apex_AI.xml'), 'utf8');

        expect(apexXml).not.toMatch(/journal|v_msg|previous direction|indicator candles|model signal/i);
    });

    it('keeps the Rise/Fall-specific journal signature only in its own Free Bot', () => {
        const templatesWithRiseFallJournal = readCatalogXmlPaths().filter(xmlPath => {
            const templatePath = path.join(publicBotsPath, xmlPath.slice('/bots/'.length));
            const xml = fs.readFileSync(templatePath, 'utf8');
            return xml.includes('bp_direct_journal') || xml.includes('INDICATORS | ADX:');
        });

        expect(templatesWithRiseFallJournal).toEqual(['/bots/Rise_Fall_Master_Bot.xml']);
    });

    it('keeps shared Smart Over 2 analysis in its two bots and hides it elsewhere', () => {
        const riseFallRow = {
            message: 'INDICATORS | ADX: 24 | RSI: 51 | MACD Histogram: 0.4',
            extra: { botTemplateId: 'rise-fall-master' },
        };
        const legacySmartOver2Row = {
            message: 'Smart Over 2 · Market: R_25 · Last 4: [3, 4, 5, 6]',
            extra: {},
        };
        const previouslyMisattributedSmartOver2Row = {
            message: 'Smart Over 2 · Market: R_25 · Last 4: [3, 4, 5, 6]',
            extra: { botTemplateId: 'rise-fall-master' },
        };
        const legacyVolatilityScanRow = {
            message: '[Volatility Scan] Entry order submitted · 1HZ25V · DIGITOVER',
            extra: {},
        };
        const otherBotRow = { message: 'Other bot journal entry', extra: { botTemplateId: 'matches-signal' } };

        expect(shouldShowJournalEntryForBot(riseFallRow, 'rise-fall-master')).toBe(true);
        expect(shouldShowJournalEntryForBot(riseFallRow, 'matches-signal')).toBe(false);
        expect(shouldShowJournalEntryForBot(legacySmartOver2Row, 'rise-fall-master')).toBe(true);
        expect(shouldShowJournalEntryForBot(legacySmartOver2Row, 'smart-over-2')).toBe(true);
        expect(shouldShowJournalEntryForBot(legacySmartOver2Row, 'smart-over-2-v2')).toBe(true);
        expect(shouldShowJournalEntryForBot(legacySmartOver2Row, 'smart-over-2-v3')).toBe(true);
        expect(getSmartOver2RecoveryContractType('smart-over-2')).toBe('DIGITUNDER');
        expect(getSmartOver2RecoveryContractType('smart-over-2-v2')).toBe('DIGITOVER');
        expect(getSmartOver2RecoveryContractType('smart-over-2-v3')).toBe('DIGITOVER');
        expect(shouldShowJournalEntryForBot(previouslyMisattributedSmartOver2Row, 'smart-over-2')).toBe(true);
        expect(shouldShowJournalEntryForBot(legacySmartOver2Row, 'matches-signal')).toBe(false);
        expect(shouldShowJournalEntryForBot(legacyVolatilityScanRow, 'smart-over-2')).toBe(false);
        expect(shouldShowJournalEntryForBot(otherBotRow, 'matches-signal')).toBe(true);
    });

    it('uses the recovery-aware purchase block while keeping Over 2 as the normal entry', () => {
        const xml = fs.readFileSync(path.join(publicBotsPath, 'Smart_Over_2_Bot.xml'), 'utf8');
        const document = new DOMParser().parseFromString(xml, 'application/xml');

        expect(document.querySelector('block[type="smart_over2_recovery_gate"]')).not.toBeNull();
        expect(document.querySelector('block[type="smart_over2_recovery_gate"] value[name="COUNT"]')).toBeNull();
        expect(
            document.querySelector(
                'block[type="smart_over2_recovery_gate"] value[name="MARTINGALE"] shadow[type="math_number"] field[name="NUM"]'
            )?.textContent
        ).toBe('1.2');
        expect(document.querySelector('block[type="smart_over2_recovery_purchase"]')).not.toBeNull();
        expect(document.querySelector('block[type="apollo_purchase2"]')).toBeNull();
        expect(
            document.querySelector(
                'block[type="trade_definition_tradeoptions"] value[name="PREDICTION"] shadow[type="math_number_positive"] field[name="NUM"]'
            )?.textContent
        ).toBe('2');
        expect(
            document.querySelector(
                'block[type="trade_definition_tradeoptions"] value[name="AMOUNT"] block[type="variables_get"] field[name="VAR"]'
            )?.textContent
        ).toBe('Stake');
        expect(
            document.querySelector(
                'block[type="trade_definition_tradeoptions"] value[name="PREDICTION"] block[type="variables_get"] field[name="VAR"]'
            )?.textContent
        ).toBe('Over Prediction');
        expect(document.querySelector('block[type="trade_definition"] statement[name="INITIALIZATION"]')).not.toBeNull();
        expect(document.querySelector('block[type="variables_set"] field[name="VAR"]')?.textContent).toBe('Stake');
        expect(document.querySelector('block[type="smart_over2_recovery_settings"]')).not.toBeNull();
        expect(
            document.querySelector(
                'block[type="trade_definition"] statement[name="INITIALIZATION"] block[type="smart_over2_recovery_settings"]'
            )
        ).not.toBeNull();
        expect(
            document.querySelector('block[type="smart_over2_recovery_settings"] field[name="ENTRY_DIGIT_COUNT"]')
                ?.textContent
        ).toBe('4');
        expect(
            document.querySelector('block[type="smart_over2_recovery_settings"] field[name="USE_VIRTUAL_HOOK"]')
                ?.textContent
        ).toBe('TRUE');
        expect(
            document.querySelector('block[type="smart_over2_recovery_settings"] field[name="MAX_VIRTUAL_LOSSES"]')
                ?.textContent
        ).toBe('2');
        expect(
            document.querySelector(
                'block[type="smart_over2_recovery_settings"] field[name="RECOVERY_CONTRACT_TYPE"]'
            )?.textContent
        ).toBe('DIGITUNDER');
        const gateVariableNames = Array.from(
            document.querySelectorAll('block[type="smart_over2_recovery_gate"] field[name="VAR"]')
        ).map(field => field.textContent);
        [
            'Martingale factor',
            'Target Profit',
            'Stop Loss',
            'Use Martingale',
            'Over Prediction',
            'Under Prediction',
        ].forEach(variableName => expect(gateVariableNames).toContain(variableName));
        expect(gateVariableNames).not.toContain('Maximum Virtual Hook losses');
        expect(gateVariableNames).not.toContain('Use Virtual Hook');
        expect(document.querySelector('block[type="smart_over2_recovery_gate"] value[name="USE_VIRTUAL_HOOK"]')).toBeNull();
        expect(document.querySelector('block[type="smart_over2_recovery_gate"] value[name="MAX_VIRTUAL_LOSSES"]')).toBeNull();
    });

    it('includes separate V1, V2, and V3 templates in the Premium Bots catalog', () => {
        const templatesWithGate = readCatalogXmlPaths().filter(xmlPath => {
            const templatePath = path.join(publicBotsPath, xmlPath.slice('/bots/'.length));
            const xml = fs.readFileSync(templatePath, 'utf8');
            return (
                xml.includes('type="smart_over2_entry_gate"') ||
                xml.includes('type="smart_over2_recovery_gate"') ||
                xml.includes('type="smart_over2_v3_entry_gate"')
            );
        });

        expect(templatesWithGate).toEqual([
            '/bots/Smart_Over_2_Bot.xml',
            '/bots/Smart_Over_2_Bot_V2.xml',
            '/bots/Smart_Over_2_Bot_V3.xml',
        ]);

        const catalog = fs.readFileSync(catalogPath, 'utf8');
        expect(catalog).toContain("name: 'Smart Over 2 Bot V1'");
        expect(catalog).toContain("name: 'Smart Over 2 Bot V2'");
        expect(catalog).toContain("name: 'Smart Over 2 Bot V3'");
        expect(catalog).toContain("id: 'smart-over-2-v2',\n        section: 'premium'");
        expect(catalog).toContain("id: 'smart-over-2-v3',\n        section: 'premium'");

        const v2Xml = fs.readFileSync(path.join(publicBotsPath, 'Smart_Over_2_Bot_V2.xml'), 'utf8');
        const v2Document = new DOMParser().parseFromString(v2Xml, 'application/xml');
        expect(v2Document.querySelector('parsererror')).toBeNull();
        expect(v2Document.querySelector('block[type="smart_over2_recovery_settings"]')).not.toBeNull();
        expect(
            v2Document.querySelector(
                'block[type="trade_definition"] statement[name="INITIALIZATION"] block[type="smart_over2_recovery_settings"]'
            )
        ).not.toBeNull();
        expect(
            v2Document.querySelector(
                'block[type="smart_over2_recovery_settings"] field[name="USE_VIRTUAL_HOOK"]'
            )?.textContent
        ).toBe('TRUE');
        expect(
            v2Document.querySelector(
                'block[type="smart_over2_recovery_settings"] field[name="MAX_VIRTUAL_LOSSES"]'
            )?.textContent
        ).toBe('2');
        expect(
            v2Document.querySelector(
                'block[type="smart_over2_recovery_settings"] field[name="RECOVERY_CONTRACT_TYPE"]'
            )?.textContent
        ).toBe('DIGITOVER');
        expect(
            v2Document.querySelector(
                'block[type="smart_over2_recovery_settings"] field[name="ENTRY_DIGIT_COUNT"]'
            )?.textContent
        ).toBe('4');
        expect(v2Document.querySelector('block[type="smart_over2_recovery_gate"] value[name="COUNT"]')).toBeNull();
        expect(
            v2Document.querySelector(
                'block[type="trade_definition_tradeoptions"] value[name="PREDICTION"] block[type="variables_get"] field[name="VAR"]'
            )?.textContent
        ).toBe('Over Prediction');
        expect(v2Document.querySelector('variable[id="smart_over2_var_over_prediction"]')?.textContent).toBe(
            'Over Prediction'
        );
        expect(v2Document.querySelector('variable[id="smart_over2_var_recovery_prediction"]')?.textContent).toBe(
            'Recovery Prediction'
        );
        expect(
            v2Document.querySelector(
                'block[type="smart_over2_recovery_gate"] value[name="RECOVERY_PREDICTION"] block[type="variables_get"] field[name="VAR"]'
            )?.textContent
        ).toBe('Recovery Prediction');

        const v3Xml = fs.readFileSync(path.join(publicBotsPath, 'Smart_Over_2_Bot_V3.xml'), 'utf8');
        const v3Document = new DOMParser().parseFromString(v3Xml, 'application/xml');
        expect(v3Document.querySelector('parsererror')).toBeNull();
        expect(
            v3Document.querySelector(
                'block[type="trade_definition"] statement[name="INITIALIZATION"] block[type="smart_over2_v3_settings"]'
            )
        ).not.toBeNull();
        expect(v3Document.querySelector('block[type="smart_over2_v3_entry_gate"]')).not.toBeNull();
        expect(v3Document.querySelector('block[type="smart_over2_v3_purchase"]')).not.toBeNull();
        expect(v3Document.querySelector('block[type="smart_over2_v3_settlement"]')).not.toBeNull();
        expect(v3Document.querySelector('variable[id*="recovery"]')).toBeNull();
        expect(v3Document.querySelector('[type*="recovery"]')).toBeNull();
        expect(v3Xml).not.toContain('Under Prediction');
        expect(
            v3Document.querySelector(
                'block[type="trade_definition_tradeoptions"] value[name="PREDICTION"] block[type="variables_get"] field[name="VAR"]'
            )?.textContent
        ).toBe('Over Prediction');
        expect(
            v3Document.querySelector('block[type="smart_over2_v3_settings"] field[name="OVER_PREDICTION"]')
                ?.textContent
        ).toBe('2');
        expect(
            v3Document.querySelector('block[type="smart_over2_v3_settings"] field[name="ENTRY_DIGIT_COUNT"]')
                ?.textContent
        ).toBe('4');
        expect(
            v3Document.querySelector('block[type="smart_over2_v3_settings"] field[name="USE_VIRTUAL_HOOK"]')
                ?.textContent
        ).toBe('TRUE');
        expect(
            v3Document.querySelector('block[type="smart_over2_v3_settings"] field[name="MAX_VIRTUAL_LOSSES"]')
                ?.textContent
        ).toBe('2');
    });

    it('recognizes a V2 built-in template filename when choosing the recovery direction', () => {
        expect(getSmartOver2RecoveryContractType('Smart_Over_2_Bot_V2.xml')).toBe('DIGITOVER');
    });
});
