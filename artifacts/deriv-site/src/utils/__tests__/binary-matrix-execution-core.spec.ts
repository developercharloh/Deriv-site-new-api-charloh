import { BinaryMatrixExecutionCore } from '@/utils/binary-matrix-execution-core';
import type { BinaryMatrixDecision } from '@/utils/binary-matrix-strategy';

const decision: BinaryMatrixDecision = {
    direction: 0,
    purchaseType: 'DIGITEVEN',
    contractType: 'DIGITEVEN',
    barrier: null,
    blockType: 'apollo_purchase2',
    label: 'EVEN',
    reason: 'test signal',
    scannedDigits: [1, 3, 5, 7],
};

describe('BinaryMatrixExecutionCore', () => {
    const config = {
        initialStake: 0.5,
        martingale: 2,
        takeProfit: 10,
        stopLoss: 50,
    };

    it('updates the next stake only after authoritative settlement', () => {
        const core = new BinaryMatrixExecutionCore(config);

        expect(core.beginPurchase(decision)?.stake).toBe(0.5);
        expect(core.snapshot().currentStake).toBe(0.5);
        expect(core.acceptPurchase('loss-1')).toBe(true);

        expect(core.settle({ contractId: 'loss-1', profit: -0.5, isWin: false })).toMatchObject({
            accepted: true,
            nextStake: 1,
        });
        expect(core.beginPurchase(decision)?.stake).toBe(1);
    });

    it('prevents duplicate or overlapping contract state transitions', () => {
        const core = new BinaryMatrixExecutionCore(config);

        expect(core.beginPurchase(decision)).not.toBeNull();
        expect(core.beginPurchase(decision)).toBeNull();
        expect(core.acceptPurchase('open-1')).toBe(true);
        expect(core.beginPurchase(decision)).toBeNull();
        expect(core.settle({ contractId: 'open-1', profit: -0.5, isWin: false }).accepted).toBe(true);
        expect(core.settle({ contractId: 'open-1', profit: -0.5, isWin: false })).toMatchObject({
            accepted: false,
            duplicate: true,
        });
    });

    it('resets the next stake after a win', () => {
        const core = new BinaryMatrixExecutionCore(config);

        core.beginPurchase(decision);
        core.acceptPurchase('loss-1');
        core.settle({ contractId: 'loss-1', profit: -0.5, isWin: false });
        core.beginPurchase(decision);
        core.acceptPurchase('win-1');
        expect(core.settle({ contractId: 'win-1', profit: 1, isWin: true })).toMatchObject({
            accepted: true,
            nextStake: 0.5,
        });
    });
});