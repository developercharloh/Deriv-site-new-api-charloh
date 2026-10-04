type ContractGate = {
    owner: object;
    contractId: string | null;
    signalKey: string | null;
};

type ContractGateWaiter = {
    owner: object;
    signalKey: string | null;
    isValid: () => boolean;
    resolve: (acquired: boolean) => void;
};

const GATE_KEY = '__DERIV_AUTOMATED_CONTRACT_GATE__';

type GateState = {
    active: ContractGate[];
    waiting: ContractGateWaiter[];
    latestTickKey: string | null;
    lastUsedTickKey: string | null;
    immediateReentryKey: string | null;
    sessionIds: WeakMap<object, string>;
    nextSessionId: number;
};

const getState = (): GateState => {
    const globalState = globalThis as Record<string, unknown>;
    const current = globalState[GATE_KEY] as GateState | ContractGate | undefined;

    // Migrate the short-lived shape used by the first version of this guard
    // so a hot-reloaded browser cannot retain an incompatible lease.
    if (current && 'owner' in current) {
        const migrated: GateState = {
            active: [current],
            waiting: [],
            latestTickKey: null,
            lastUsedTickKey: null,
            immediateReentryKey: null,
            sessionIds: new WeakMap(),
            nextSessionId: 0,
        };
        globalState[GATE_KEY] = migrated;
        return migrated;
    }

    if (current) {
        const state = current as GateState;
        // Preserve the gate across hot reloads while adding session tracking
        // to the state created by an older module version.
        state.waiting ??= [];
        state.sessionIds ??= new WeakMap();
        state.nextSessionId ??= 0;
        return state;
    }
    const initial: GateState = {
        active: [],
        waiting: [],
        latestTickKey: null,
        lastUsedTickKey: null,
        immediateReentryKey: null,
        sessionIds: new WeakMap(),
        nextSessionId: 0,
    };
    globalState[GATE_KEY] = initial;
    return initial;
};

export const getBotContractSessionId = (owner: object): string => {
    const state = getState();
    const existingSessionId = state.sessionIds.get(owner);
    if (existingSessionId) return existingSessionId;

    const sessionId = `session-${state.nextSessionId}`;
    state.nextSessionId += 1;
    state.sessionIds.set(owner, sessionId);
    return sessionId;
};

export const markBotTick = (symbol: string | null | undefined, epoch: string | number | null | undefined): void => {
    if (epoch === null || epoch === undefined || epoch === '') return;
    getState().latestTickKey = `${symbol ?? 'unknown'}:${String(epoch)}`;
};

export const tryAcquireBotContractGate = (
    owner: object,
    signalKey?: string | null,
    allowOverlappingContracts = false,
): boolean => {
    const state = getState();
    const effectiveSignalKey = signalKey ?? state.latestTickKey;
    // A clock-paced FAST engine may have several one-second contracts in
    // flight while the broker is delivering the previous settlement. Other
    // bot runners must still be excluded from the shared account stream.
    if (state.active.some(lease => lease.owner !== owner)) return false;
    if (!allowOverlappingContracts && state.active.length > 0) return false;

    if (!allowOverlappingContracts && effectiveSignalKey && state.lastUsedTickKey === effectiveSignalKey) {
        // FAST may re-enter once from the authoritative settlement event.
        // Consume the token only when this owner actually acquires the gate;
        // a competing runner must not burn it while the account is busy.
        if (state.immediateReentryKey !== effectiveSignalKey) return false;
        state.immediateReentryKey = null;
    }

    state.active.push({ owner, contractId: null, signalKey: effectiveSignalKey ?? null });
    state.lastUsedTickKey = effectiveSignalKey ?? null;
    return true;
};

const grantNextBotContractGate = (): void => {
    const state = getState();
    while (state.active.length === 0 && state.waiting.length > 0) {
        const waiter = state.waiting.shift();
        if (!waiter) return;

        let isValid = false;
        try {
            isValid = waiter.isValid();
        } catch {
            isValid = false;
        }
        if (!isValid || !tryAcquireBotContractGate(waiter.owner, waiter.signalKey, false)) {
            waiter.resolve(false);
            continue;
        }

        waiter.resolve(true);
    }
};

/**
 * Acquire a gate immediately when possible, otherwise join the shared FIFO.
 * A waiter is revalidated immediately before it receives the lease so an
 * expired signal cannot become a purchase after another bot settles.
 */
export const requestBotContractGate = (
    owner: object,
    signalKey?: string | null,
    isValid: () => boolean = () => true,
    onQueued?: () => void,
): Promise<boolean> => {
    const state = getState();
    try {
        if (!isValid()) return Promise.resolve(false);
    } catch {
        return Promise.resolve(false);
    }

    if (state.waiting.length === 0 && tryAcquireBotContractGate(owner, signalKey, false)) {
        return Promise.resolve(true);
    }

    // A runner with an existing lease must never queue behind itself. That
    // would hold up all other sessions while its current contract is open.
    if (state.active.some(lease => lease.owner === owner)) return Promise.resolve(false);

    // If there is no owner and no older waiter, the failed immediate attempt
    // was a duplicate signal key and must remain rejected.
    if (state.active.length === 0 && state.waiting.length === 0) return Promise.resolve(false);
    if (state.waiting.some(waiter => waiter.owner === owner)) return Promise.resolve(false);

    onQueued?.();
    return new Promise(resolve => {
        state.waiting.push({
            owner,
            signalKey: signalKey ?? null,
            isValid,
            resolve,
        });
        grantNextBotContractGate();
    });
};

export const cancelQueuedBotContractGate = (owner: object): number => {
    const state = getState();
    const cancelled = state.waiting.filter(waiter => waiter.owner === owner);
    state.waiting = state.waiting.filter(waiter => waiter.owner !== owner);
    cancelled.forEach(waiter => waiter.resolve(false));
    grantNextBotContractGate();
    return cancelled.length;
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
    allowFastRearm = false,
): boolean => {
    const state = getState();
    if (contractId === undefined && signalKey === undefined) {
        cancelQueuedBotContractGate(owner);
    }
    const releasedLease = state.active.find(lease => {
        if (lease.owner !== owner) return false;
        if (contractId !== undefined && lease.contractId !== null && lease.contractId !== String(contractId)) {
            return false;
        }
        // SLOW can settle a contract whose Redux tick key was unavailable at
        // purchase time. In that case OpenContract passes null; the contract
        // id and owner are still authoritative, so null must not block release.
        if (signalKey !== undefined && signalKey !== null && lease.signalKey !== signalKey) return false;
        return true;
    });

    state.active = state.active.filter(lease => {
        if (lease.owner !== owner) return true;
        if (contractId !== undefined && lease.contractId !== null && lease.contractId !== String(contractId)) {
            return true;
        }
        if (signalKey !== undefined && signalKey !== null && lease.signalKey !== signalKey) return true;
        return false;
    });

    if (allowFastRearm && releasedLease?.signalKey) {
        // The contract has already settled and its result has already updated
        // the next stake. Permit exactly one immediate re-entry, including
        // same-tick settlement, without permitting overlapping contracts.
        state.immediateReentryKey = releasedLease.signalKey;
        grantNextBotContractGate();
        return true;
    }

    grantNextBotContractGate();
    return false;
};