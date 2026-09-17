import fs from 'fs';
import path from 'path';

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
});