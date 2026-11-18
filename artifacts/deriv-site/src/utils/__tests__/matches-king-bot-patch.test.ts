import fs from 'node:fs';
import path from 'node:path';
import { configureMatchesKingBotXml, patchBotXml } from '@/utils/bot-patch';

describe('Matches King signal bot patching', () => {
    const xmlPath = path.join(__dirname, '../../../public/bots/Matches_King.xml');

    it('passes the selected market, digit range, risk settings, and Virtual Hook into Bot #19', () => {
        const source = fs.readFileSync(xmlPath, 'utf8');
        const doc = patchBotXml(source, '1HZ10V', [], 1);
        configureMatchesKingBotXml(doc, {
            stake: 1.25,
            takeProfit: 25,
            stopLoss: 40,
            martingale: 1.8,
            digits: [6, 7, 8],
            useVirtualHook: false,
            virtualLossThreshold: 4,
        });

        const field = (name: string) => Array.from(doc.getElementsByTagName('field'))
            .find(item => item.getAttribute('name') === name)?.textContent;
        expect(field('SYMBOL_LIST')).toBe('1HZ10V');
        expect(field('DIGIT_COUNT')).toBe('3');
        expect([field('DIGIT_1'), field('DIGIT_2'), field('DIGIT_3')]).toEqual(['6', '7', '8']);
        expect(field('STAKE')).toBe('1.25');
        expect(field('TAKE_PROFIT')).toBe('25');
        expect(field('STOP_LOSS')).toBe('40');
        expect(field('MARTINGALE')).toBe('1.8');
        expect(field('USE_VIRTUAL_HOOK')).toBe('FALSE');
        expect(field('VIRTUAL_LOSS_THRESHOLD')).toBe('4');
        expect(field('INITIAL_ENTRY_MODE')).toBeUndefined();
    });

    it('rejects a digit count outside the supported range', () => {
        const doc = new DOMParser().parseFromString(
            fs.readFileSync(xmlPath, 'utf8'),
            'text/xml',
        );
        expect(() => configureMatchesKingBotXml(doc, {
            stake: 0.5,
            takeProfit: 10,
            stopLoss: 30,
            martingale: 2,
            digits: [],
            useVirtualHook: true,
            virtualLossThreshold: 2,
        })).toThrow('Matches King needs between 1 and 10 match digits.');
    });
});
