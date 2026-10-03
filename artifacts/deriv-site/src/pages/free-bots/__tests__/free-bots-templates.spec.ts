import fs from 'fs';
import path from 'path';
import { shouldShowJournalEntryForBot } from '@/utils/bot-template-scope';

const catalogPath = path.resolve(__dirname, '..', 'index.tsx');
const publicBotsPath = path.resolve(__dirname, '../../../../public/bots');

const readCatalogXmlPaths = (): string[] => {
    const catalog = fs.readFileSync(catalogPath, 'utf8');
    return Array.from(catalog.matchAll(/xmlPath:\s*'([^']+)'/g), match => match[1]);
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

    it('hides Rise/Fall Journal rows in other bots without deleting their stored history', () => {
        const riseFallRow = {
            message: 'INDICATORS | ADX: 24 | RSI: 51 | MACD Histogram: 0.4',
            extra: { botTemplateId: 'rise-fall-master' },
        };
        const legacyRiseFallRow = {
            message: 'Smart Over 2 · Market: R_25 · Last 4: [3, 4, 5, 6]',
            extra: {},
        };
        const legacyVolatilityScanRow = {
            message: '[Volatility Scan] Entry order submitted · 1HZ25V · DIGITOVER',
            extra: {},
        };
        const otherBotRow = { message: 'Other bot journal entry', extra: { botTemplateId: 'matches-signal' } };

        expect(shouldShowJournalEntryForBot(riseFallRow, 'rise-fall-master')).toBe(true);
        expect(shouldShowJournalEntryForBot(riseFallRow, 'matches-signal')).toBe(false);
        expect(shouldShowJournalEntryForBot(legacyRiseFallRow, 'matches-signal')).toBe(false);
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