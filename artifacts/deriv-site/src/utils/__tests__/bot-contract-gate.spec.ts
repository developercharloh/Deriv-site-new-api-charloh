import {
    markBotTick,
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

    it('does not allow a second purchase on the same tick after settlement', () => {
        const firstRunner = {};
        const secondRunner = {};

        markBotTick('R_25', 100);
        expect(tryAcquireBotContractGate(firstRunner)).toBe(true);
        setBotContractGateContract(firstRunner, 54321);
        releaseBotContractGate(firstRunner, 54321);

        expect(tryAcquireBotContractGate(secondRunner)).toBe(false);

        markBotTick('R_25', 101);
        expect(tryAcquireBotContractGate(secondRunner)).toBe(true);
        releaseBotContractGate(secondRunner);
    });
});