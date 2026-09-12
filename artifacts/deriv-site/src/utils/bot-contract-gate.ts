type ContractGate = {
    owner: object;
    contractId: string | null;
};

const GATE_KEY = '__DERIV_AUTOMATED_CONTRACT_GATE__';

const getGate = (): ContractGate | null =>
    (globalThis as Record<string, unknown>)[GATE_KEY] as ContractGate | null;

const setGate = (gate: ContractGate | null): void => {
    const globalState = globalThis as Record<string, unknown>;
    if (gate) globalState[GATE_KEY] = gate;
    else delete globalState[GATE_KEY];
};

export const tryAcquireBotContractGate = (owner: object): boolean => {
    if (getGate()) return false;
    setGate({ owner, contractId: null });
    return true;
};

export const setBotContractGateContract = (owner: object, contractId: string | number): void => {
    const gate = getGate();
    if (gate?.owner === owner) gate.contractId = String(contractId);
};

export const releaseBotContractGate = (owner: object, contractId?: string | number): void => {
    const gate = getGate();
    if (!gate || gate.owner !== owner) return;
    if (contractId !== undefined && gate.contractId !== null && gate.contractId !== String(contractId)) return;
    setGate(null);
};