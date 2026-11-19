import { DBOT_TABS } from '@/constants/bot-contents';

export const shouldRenderMobileRunPanel = (activeTab: number, quickStrategyOpen: boolean) =>
    !quickStrategyOpen &&
    ![DBOT_TABS.AI_SIGNALS, DBOT_TABS.ADVANCED_DTRADER, DBOT_TABS.TRADING_VIEW].includes(activeTab);
