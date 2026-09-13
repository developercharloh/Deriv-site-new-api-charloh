import { getBotExecutionSpeed } from '@/constants/bot-execution-speed';

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
        };
        globalState[GATE_KEY] = migrated;
        return migrated;
    }

    if (current) return current;
    const initial: GateState = {
        active: [],
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
    const effectiveSignalKey = signalKey ?? state.latestTickKey;
    if (effectiveSignalKey && state.lastUsedTickKey === effectiveSignalKey) return false;

    const isFast = getBotExecutionSpeed() === 'fast';
    if (!isFast && state.active.length > 0) return false;
    if (
        isFast &&
        state.active.some(lease => lease.signalKey === (effectiveSignalKey ?? null))
    ) {
        return false;
    }

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
    signalKey?: string | null
): void => {
    const state = getState();
    state.active = state.active.filter(lease => {
        if (lease.owner !== owner) return true;
        if (contractId !== undefined && lease.contractId !== null && lease.contractId !== String(contractId)) {
            return true;
        }
        if (signalKey !== undefined && lease.signalKey !== (signalKey ?? null)) return true;
        return false;
    });
};