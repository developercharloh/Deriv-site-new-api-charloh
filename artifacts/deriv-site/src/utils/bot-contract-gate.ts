type ContractGate = {
    owner: object;
    contractId: string | null;
    signalKey: string | null;
};

const GATE_KEY = '__DERIV_AUTOMATED_CONTRACT_GATE__';

type GateState = {
    active: ContractGate[];
    latestTickKey: string | null;
    lastUsedTickKey: string | null;
    immediateReentryKey: string | null;
};

const getState = (): GateState => {
    const globalState = globalThis as Record<string, unknown>;
    const current = globalState[GATE_KEY] as GateState | ContractGate | undefined;

    // Migrate the short-lived shape used by the first version of this guard
    // so a hot-reloaded browser cannot retain an incompatible lease.
    if (current && 'owner' in current) {
        const migrated: GateState = {
            active: [current],
            latestTickKey: null,
            lastUsedTickKey: null,
            immediateReentryKey: null,
        };
        globalState[GATE_KEY] = migrated;
        return migrated;
    }

    if (current) return current as GateState;
    const initial: GateState = {
        active: [],
        latestTickKey: null,
        lastUsedTickKey: null,
        immediateReentryKey: null,
    };
    globalState[GATE_KEY] = initial;
    return initial;
};

export const markBotTick = (symbol: string | null | undefined, epoch: string | number | null | undefined): void => {
    if (epoch === null || epoch === undefined || epoch === '') return;
    getState().latestTickKey = `${symbol ?? 'unknown'}:${String(epoch)}`;
};

export const tryAcquireBotContractGate = (owner: object, signalKey?: string | null): boolean => {
    const state = getState();
    const effectiveSignalKey = signalKey ?? state.latestTickKey;
    if (effectiveSignalKey && state.lastUsedTickKey === effectiveSignalKey) {
        // FAST may re-enter exactly once from the broker's settlement message,
        // without waiting for another tick. The token is consumed here so a
        // repeated trade_again loop still cannot buy twice on that tick.
        if (state.immediateReentryKey !== effectiveSignalKey) return false;
        state.immediateReentryKey = null;
    }

    // FAST removes artificial loop delays, but it must still wait for the
    // current contract to settle before acquiring the next lease. This keeps
    // martingale/result handling ordered and prevents overlapping contracts.
    if (state.active.length > 0) return false;

    state.active.push({ owner, contractId: null, signalKey: effectiveSignalKey ?? null });
    state.lastUsedTickKey = effectiveSignalKey ?? null;
    return true;
};

export const setBotContractGateContract = (
    owner: object,
    contractId: string | number,
    signalKey?: string | null
): void => {
    const gate = getState().active.find(
        lease =>
            lease.owner === owner &&
            lease.contractId === null &&
            (signalKey === undefined || lease.signalKey === (signalKey ?? null))
    );
    if (gate) gate.contractId = String(contractId);
};

export const releaseBotContractGate = (
    owner: object,
    contractId?: string | number,
    signalKey?: string | null,
    allowImmediateReentry = false
): void => {
    const state = getState();
    const releasedLease = state.active.find(lease => {
        if (lease.owner !== owner) return false;
        if (contractId !== undefined && lease.contractId !== null && lease.contractId !== String(contractId)) {
            return false;
        }
        if (signalKey !== undefined && lease.signalKey !== (signalKey ?? null)) return false;
        return true;
    });

    state.active = state.active.filter(lease => {
        if (lease.owner !== owner) return true;
        if (contractId !== undefined && lease.contractId !== null && lease.contractId !== String(contractId)) {
            return true;
        }
        if (signalKey !== undefined && lease.signalKey !== (signalKey ?? null)) return true;
        return false;
    });

    if (allowImmediateReentry && releasedLease?.signalKey) {
        state.immediateReentryKey = releasedLease.signalKey;
    }
};