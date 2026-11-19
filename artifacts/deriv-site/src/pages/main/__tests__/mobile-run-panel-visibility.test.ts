import { DBOT_TABS } from '@/constants/bot-contents';
import { shouldRenderMobileRunPanel } from '../mobile-run-panel-visibility';

describe('mobile Run panel visibility', () => {
    it('keeps the Run panel visible on the AI Analysis tab', () => {
        expect(shouldRenderMobileRunPanel(DBOT_TABS.AI_ANALYSIS, false)).toBe(true);
    });

    it('does not duplicate the quick-strategy Run panel', () => {
        expect(shouldRenderMobileRunPanel(DBOT_TABS.AI_ANALYSIS, true)).toBe(false);
    });

    it.each([DBOT_TABS.AI_SIGNALS, DBOT_TABS.ADVANCED_DTRADER, DBOT_TABS.TRADING_VIEW])(
        'keeps the panel hidden for tab %s',
        activeTab => {
            expect(shouldRenderMobileRunPanel(activeTab, false)).toBe(false);
        },
    );
});
