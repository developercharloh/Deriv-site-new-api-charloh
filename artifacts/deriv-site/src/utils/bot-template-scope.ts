const RISE_FALL_MASTER_BOT_SCOPE = 'rise-fall-master';
const RISE_FALL_MASTER_BOT_IDENTITIES = new Set(['risefallmaster', 'risefallmasterbot']);
const SMART_OVER_2_BOT_SCOPE = 'smart-over-2';
const SMART_OVER_2_BOT_V2_IDENTITIES = new Set(['smartover2v2', 'smartover2botv2']);
const SMART_OVER_2_BOT_IDENTITIES = new Set([
    'smartover2',
    'smartover2bot',
    'smartover2v1',
    'smartover2botv1',
    ...SMART_OVER_2_BOT_V2_IDENTITIES,
]);

const normalizeIdentity = (identity: unknown) =>
    String(identity ?? '')
        .trim()
        .replace(/\.xml$/i, '')
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

export const getSmartOver2RecoveryContractType = (identity: unknown) => {
    const normalizedIdentity = normalizeIdentity(identity);
    if (!SMART_OVER_2_BOT_IDENTITIES.has(normalizedIdentity)) return null;
    return SMART_OVER_2_BOT_V2_IDENTITIES.has(normalizedIdentity) ? 'DIGITOVER' : 'DIGITUNDER';
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

    const recoveryContractType = getSmartOver2RecoveryContractType(identity);
    (workspace as { __smartOver2JournalScope?: string | null }).__smartOver2JournalScope =
        getSmartOver2JournalScope(identity);
    (workspace as { __smartOver2RecoveryContractType?: string | null }).__smartOver2RecoveryContractType =
        recoveryContractType;

    if (!recoveryContractType) return;

    const blocks =
        (workspace as {
            getAllBlocks?: (ordered?: boolean) => Array<{
                type?: string;
                getField?: (name: string) => { getValue?: () => string; setValue?: (value: string) => void } | null;
            }>;
        }).getAllBlocks?.(false) ?? [];
    blocks
        .filter(block => block.type === 'smart_over2_recovery_settings')
        .forEach(block => {
            const field = block.getField?.('RECOVERY_CONTRACT_TYPE');
            if (field?.getValue?.() !== recoveryContractType) field?.setValue?.(recoveryContractType);
        });
};
