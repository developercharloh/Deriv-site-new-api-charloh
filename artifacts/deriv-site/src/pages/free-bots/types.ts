export type FreeBotSection = 'premium' | 'smart-contract' | 'edging';

export type BotConfig = {
    id:          string;
    section:     FreeBotSection;
    name:        string;
    emoji:       string;
    description: string;
    market:      string;
    strategy:    string;
    params:      { label: string; value: string }[];
    xmlPath?:    string;
    nativeRunner?: 'edging-pro';
    gradient:    string;
    art?:        string;
    category?:   string;
    signalKey?:  string;
    // V2 mode is universal — no per-bot flag needed.
    // Every bot that has an xmlPath automatically supports V2 execution.
};
