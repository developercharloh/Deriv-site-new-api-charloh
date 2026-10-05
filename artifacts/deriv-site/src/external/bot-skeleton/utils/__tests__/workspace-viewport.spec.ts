import { isMobileBlocklyViewport } from '@/external/bot-skeleton/utils/workspace';

describe('isMobileBlocklyViewport', () => {
    it('uses a narrow viewport when the device store still reports desktop', () => {
        expect(isMobileBlocklyViewport(false, 390)).toBe(true);
        expect(isMobileBlocklyViewport(false, 767)).toBe(true);
    });

    it('keeps desktop layout at tablet-width and desktop viewports', () => {
        expect(isMobileBlocklyViewport(false, 768)).toBe(false);
        expect(isMobileBlocklyViewport(false, 1280)).toBe(false);
    });

    it('respects the device store on wider touch devices', () => {
        expect(isMobileBlocklyViewport(true, 1024)).toBe(true);
    });
});
