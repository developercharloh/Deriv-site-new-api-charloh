type ContractGate = {
    owner: object;
    contractId: string | null;
    signalKey: string | null;
};

const GATE_KEY = '__DERIV_AUTOMATED_CONTRACT_GATE__';

type GateState = {
    active: ContractGate | null;
    latestTickKey: string | null;
    lastUsedTickKey: string | null;
};

const getState = (): GateState => {
    const globalState = globalThis as Record<string, unknown>;
    const current = globalState[GATE_KEY] as GateState | ContractGate | undefined;

    // Migrate the short-lived shape used by the first version of this guard
    // so a hot-reloaded browser cannot retain an incompatible lease.
    if (current && 'owner' in current) {
        const migrated: GateState = {
            active: current,
            latestTickKey: null,
            lastUsedTickKey: null,
        };
        globalState[GATE_KEY] = migrated;
        return migrated;
    }

    if (current) return current;
    const initial: GateState = {
        active: null,
        latestTickKey: null,
        lastUsedTickKey: null,
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
    if (state.active) return false;

    const effectiveSignalKey = signalKey ?? state.latestTickKey;
    if (effectiveSignalKey && state.lastUsedTickKey === effectiveSignalKey) return false;

    state.active = { owner, contractId: null, signalKey: effectiveSignalKey ?? null };
    state.lastUsedTickKey = effectiveSignalKey ?? null;
    return true;
};

export const setBotContractGateContract = (owner: object, contractId: string | number): void => {
    const gate = getState().active;
    if (gate?.owner === owner) gate.contractId = String(contractId);
};

export const releaseBotContractGate = (owner: object, contractId?: string | number): void => {
    const state = getState();
    const gate = state.active;
    if (!gate || gate.owner !== owner) return;
    if (contractId !== undefined && gate.contractId !== null && gate.contractId !== String(contractId)) return;
    state.active = null;
};