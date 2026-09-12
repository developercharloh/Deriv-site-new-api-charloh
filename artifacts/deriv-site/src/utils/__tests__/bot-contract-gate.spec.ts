import {
    releaseBotContractGate,
    setBotContractGateContract,
    tryAcquireBotContractGate,
} from '@/utils/bot-contract-gate';

describe('automated contract gate', () => {
    it('allows only one owner until that owner settles', () => {
        const firstRunner = {};
        const secondRunner = {};

        expect(tryAcquireBotContractGate(firstRunner)).toBe(true);
        setBotContractGateContract(firstRunner, 12345);
        expect(tryAcquireBotContractGate(secondRunner)).toBe(false);

        releaseBotContractGate(firstRunner, 99999);
        expect(tryAcquireBotContractGate(secondRunner)).toBe(false);

        releaseBotContractGate(firstRunner, 12345);
        expect(tryAcquireBotContractGate(secondRunner)).toBe(true);
        releaseBotContractGate(secondRunner);
    });
});