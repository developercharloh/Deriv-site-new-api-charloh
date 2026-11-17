import fs from 'fs';
import path from 'path';
import { parseXmlV2Config } from '@/utils/xml-v2-parser';
import { applyOverUnderPreset, type OverUnderPreset } from '../over-under-preset';

const templatePath = path.resolve(__dirname, '../../../../public/bots/OverUnder_Signal_Bot.xml');
const template = fs.readFileSync(templatePath, 'utf8');

const readField = (xml: string, blockId: string, fieldName: string): string | null => {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const block = Array.from(document.getElementsByTagName('block'))
        .find(candidate => candidate.getAttribute('id') === blockId);
    return block
        ? Array.from(block.getElementsByTagName('field'))
            .find(candidate => candidate.getAttribute('name') === fieldName)?.textContent ?? null
        : null;
};

describe('standalone Over/Under presets', () => {
    it.each([
        [{ direction: 'UNDER', barrier: 6 }, 'DIGITUNDER', 'UNDER', '6'],
        [{ direction: 'UNDER', barrier: 5 }, 'DIGITUNDER', 'UNDER', '5'],
        [{ direction: 'OVER', barrier: 4 }, 'DIGITOVER', 'OVER', '4'],
        [{ direction: 'OVER', barrier: 5 }, 'DIGITOVER', 'OVER', '5'],
    ] as Array<[OverUnderPreset, string, string, string]>)(
        'configures %s as a single-direction trade at its barrier',
        (preset, type, direction, barrier) => {
            const configured = applyOverUnderPreset(template, preset);

            expect(readField(configured, 'ou_contracttype', 'TYPE_LIST')).toBe(type);
            expect(readField(configured, 'ou_dir_text_val', 'TEXT')).toBe(direction);
            expect(readField(configured, 'ou_barrier_num', 'NUM')).toBe(barrier);
            expect(readField(configured, 'ou_ep_num', 'NUM')).toBe(barrier);

            expect(parseXmlV2Config(configured)).toMatchObject({
                contractKind: type,
                direction,
                barrier: Number(barrier),
                entryPoint: Number(barrier),
            });
        },
    );

    it('rejects barriers outside the single-digit range', () => {
        expect(() => applyOverUnderPreset(template, { direction: 'UNDER', barrier: 6.5 })).toThrow(
            'Invalid Over/Under digit barrier: 6.5',
        );
        expect(() => applyOverUnderPreset(template, { direction: 'OVER', barrier: 10 })).toThrow(
            'Invalid Over/Under digit barrier: 10',
        );
    });
});
