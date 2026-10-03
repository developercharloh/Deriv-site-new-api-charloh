const RISE_FALL_MASTER_BOT_SCOPE = 'rise-fall-master';
const RISE_FALL_MASTER_BOT_IDENTITIES = new Set(['risefallmaster', 'risefallmasterbot']);

const normalizeIdentity = (identity: unknown) =>
    String(identity ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

const isRiseFallMasterBot = (identity: unknown) =>
    RISE_FALL_MASTER_BOT_IDENTITIES.has(normalizeIdentity(identity));

export const isRiseFallJournalEntry = (entry: unknown) => {
    const record =
        entry && typeof entry === 'object'
            ? (entry as { message?: unknown; extra?: { botTemplateId?: unknown } })
            : null;
    const message = typeof entry === 'string' ? entry : typeof record?.message === 'string' ? record.message : '';

    return (
        record?.extra?.botTemplateId === RISE_FALL_MASTER_BOT_SCOPE ||
        message.startsWith('Smart Over 2 ·') ||
        message.startsWith('INDICATORS | ADX:')
    );
};

export const shouldShowJournalEntryForBot = (entry: unknown, identity: unknown) =>
    isRiseFallMasterBot(identity) || !isRiseFallJournalEntry(entry);

export const setWorkspaceBotTemplateIdentity = (workspace: unknown, identity: unknown) => {
    if (!workspace || typeof workspace !== 'object') return;

    const normalizedIdentity = normalizeIdentity(identity);
    (workspace as { __smartOver2JournalScope?: string | null }).__smartOver2JournalScope =
        RISE_FALL_MASTER_BOT_IDENTITIES.has(normalizedIdentity) ? RISE_FALL_MASTER_BOT_SCOPE : null;
};