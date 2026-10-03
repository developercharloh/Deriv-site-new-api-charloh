const RISE_FALL_MASTER_BOT_SCOPE = 'rise-fall-master';
const RISE_FALL_MASTER_BOT_IDENTITIES = new Set(['risefallmaster', 'risefallmasterbot']);

const normalizeIdentity = (identity: unknown) =>
    String(identity ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

export const setWorkspaceBotTemplateIdentity = (workspace: unknown, identity: unknown) => {
    if (!workspace || typeof workspace !== 'object') return;

    const normalizedIdentity = normalizeIdentity(identity);
    (workspace as { __smartOver2JournalScope?: string | null }).__smartOver2JournalScope =
        RISE_FALL_MASTER_BOT_IDENTITIES.has(normalizedIdentity) ? RISE_FALL_MASTER_BOT_SCOPE : null;
};