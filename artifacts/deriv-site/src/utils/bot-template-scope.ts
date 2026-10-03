const RISE_FALL_MASTER_BOT_SCOPE = 'rise-fall-master';
const RISE_FALL_MASTER_BOT_IDENTITIES = new Set(['risefallmaster', 'risefallmasterbot']);
const SMART_OVER_2_BOT_SCOPE = 'smart-over-2';
const SMART_OVER_2_BOT_IDENTITIES = new Set(['smartover2', 'smartover2bot']);

const normalizeIdentity = (identity: unknown) =>
    String(identity ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

export const isRiseFallMasterBotIdentity = (identity: unknown) =>
    RISE_FALL_MASTER_BOT_IDENTITIES.has(normalizeIdentity(identity));

export const getSmartOver2JournalScope = (identity: unknown) => {
    const normalizedIdentity = normalizeIdentity(identity);
    if (RISE_FALL_MASTER_BOT_IDENTITIES.has(normalizedIdentity)) return RISE_FALL_MASTER_BOT_SCOPE;
    if (SMART_OVER_2_BOT_IDENTITIES.has(normalizedIdentity)) return SMART_OVER_2_BOT_SCOPE;
    return null;
};

const isSmartOver2AnalysisJournalEntry = (entry: unknown) => {
    const record =
        entry && typeof entry === 'object' ? (entry as { message?: unknown }) : null;
    const message = typeof entry === 'string' ? entry : typeof record?.message === 'string' ? record.message : '';
    return message.startsWith('Smart Over 2 ·');
};

export const isRiseFallJournalEntry = (entry: unknown) => {
    const record =
        entry && typeof entry === 'object'
            ? (entry as { message?: unknown; extra?: { botTemplateId?: unknown } })
            : null;
    const message = typeof entry === 'string' ? entry : typeof record?.message === 'string' ? record.message : '';

    return (
        record?.extra?.botTemplateId === RISE_FALL_MASTER_BOT_SCOPE ||
        message.startsWith('INDICATORS | ADX:') ||
        message.startsWith('[Volatility Scan]')
    );
};

export const shouldShowJournalEntryForBot = (entry: unknown, identity: unknown) => {
    const activeScope = getSmartOver2JournalScope(identity);
    if (isSmartOver2AnalysisJournalEntry(entry)) {
        return activeScope === RISE_FALL_MASTER_BOT_SCOPE || activeScope === SMART_OVER_2_BOT_SCOPE;
    }
    return activeScope === RISE_FALL_MASTER_BOT_SCOPE || !isRiseFallJournalEntry(entry);
};

export const setWorkspaceBotTemplateIdentity = (workspace: unknown, identity: unknown) => {
    if (!workspace || typeof workspace !== 'object') return;

    (workspace as { __smartOver2JournalScope?: string | null }).__smartOver2JournalScope =
        getSmartOver2JournalScope(identity);
};