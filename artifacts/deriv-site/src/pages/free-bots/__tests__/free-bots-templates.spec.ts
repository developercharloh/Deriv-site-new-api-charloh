import fs from 'fs';
import path from 'path';
import { shouldShowJournalEntryForBot } from '@/utils/bot-template-scope';

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

    return Array.from(
        botDefinitions.matchAll(/id:\s*'([^']+)',\s*section:\s*'([^']+)'[\s\S]*?xmlPath:\s*'([^']+)'/g),
        match => ({ id: match[1], section: match[2], xmlPath: match[3] })
    );
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

    it('groups bots with registered custom blocks as premium and leaves edging empty', () => {
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

        expect(entries.filter(entry => entry.section === 'edging')).toHaveLength(0);
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
        expect(shouldShowJournalEntryForBot(previouslyMisattributedSmartOver2Row, 'smart-over-2')).toBe(true);
        expect(shouldShowJournalEntryForBot(legacySmartOver2Row, 'matches-signal')).toBe(false);
        expect(shouldShowJournalEntryForBot(legacyVolatilityScanRow, 'smart-over-2')).toBe(false);
        expect(shouldShowJournalEntryForBot(otherBotRow, 'matches-signal')).toBe(true);
    });

    it('keeps Smart Over 2 configured for the gated Over 2 contract', () => {
        const xml = fs.readFileSync(path.join(publicBotsPath, 'Smart_Over_2_Bot.xml'), 'utf8');
        const document = new DOMParser().parseFromString(xml, 'application/xml');

        expect(document.querySelector('block[type="smart_over2_entry_gate"]')).not.toBeNull();
        expect(
            document.querySelector(
                'block[type="smart_over2_entry_gate"] value[name="COUNT"] shadow[type="math_number"]'
            )
        ).not.toBeNull();
        expect(document.querySelector('block[type="smart_over2_entry_gate"] field[name="NUM"]')?.textContent).toBe(
            '4'
        );
        expect(document.querySelector('block[type="apollo_purchase2"] field[name="PURCHASE_LIST"]')?.textContent).toBe(
            'DIGITOVER'
        );
        expect(document.querySelector('block[type="apollo_purchase2"] field[name="NUM"]')?.textContent).toBe('2');
    });

    it('does not place the Smart Over 2 gate in other free-bot templates', () => {
        const templatesWithGate = readCatalogXmlPaths().filter(xmlPath => {
            const templatePath = path.join(publicBotsPath, xmlPath.slice('/bots/'.length));
            return fs.readFileSync(templatePath, 'utf8').includes('type="smart_over2_entry_gate"');
        });

        expect(templatesWithGate).toEqual(['/bots/Smart_Over_2_Bot.xml']);
    });
});