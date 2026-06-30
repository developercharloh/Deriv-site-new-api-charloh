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
    CHART: 2,
    LDP_TOOL: 3,
    FREE_BOTS: 4,
    AI_ANALYSIS: 5,
    D_CIRCLES: 6,
    ADVANCED_DTRADER: 7,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-charts',
    'id-ldp-tool',
    'id-free-bots',
    'id-ai-analysis',
    'id-d-circles',
    'id-advanced-dtrader',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
