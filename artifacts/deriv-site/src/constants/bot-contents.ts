type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    ALPHA_SCAN_AI: 2,
    CHART: 3,
    AI_SIGNALS: 4,
    FREE_BOTS: 5,
    AI_ANALYSIS: 6,
    D_CIRCLES: 7,
    ADVANCED_DTRADER: 8,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-alpha-scan-ai',
    'id-charts',
    'id-ai-signals',
    'id-free-bots',
    'id-ai-analysis',
    'id-d-circles',
    'id-advanced-dtrader',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
