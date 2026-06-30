export type BotConfig = {
    id:          string;
    name:        string;
    emoji:       string;
    description: string;
    market:      string;
    strategy:    string;
    params:      { label: string; value: string }[];
    xmlPath:     string;
    gradient:    string;
    signalKey?:  string;
    // V2 mode is universal — no per-bot flag needed.
    // Every bot that has an xmlPath automatically supports V2 execution.
};
