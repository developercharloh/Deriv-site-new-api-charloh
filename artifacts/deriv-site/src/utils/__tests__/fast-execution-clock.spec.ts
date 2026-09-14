import {
    FAST_EXECUTION_INTERVAL_MS,
    FAST_SETTLEMENT_REST_MS,
    FastExecutionClock,
} from '@/utils/fast-execution-clock';

describe('FastExecutionClock', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('keeps an 800 ms safety interval with no settlement rest', () => {
        expect(FAST_EXECUTION_INTERVAL_MS).toBe(800);
        expect(FAST_SETTLEMENT_REST_MS).toBe(0);
    });

    it('opens 75 slots in the first minute window', () => {
        const onSlot = jest.fn();
        const clock = new FastExecutionClock(onSlot);

        clock.start();
        expect(onSlot).toHaveBeenCalledTimes(1);

        // Slot zero is immediate, then slots 1..74 are 800 ms apart.
        // This is 75 purchase slots in [start, start + 60 seconds).
        jest.advanceTimersByTime(74 * FAST_EXECUTION_INTERVAL_MS);
        expect(onSlot).toHaveBeenCalledTimes(75);

        clock.stop();
        jest.advanceTimersByTime(5_000);
        expect(onSlot).toHaveBeenCalledTimes(75);
    });

    it('re-arms the next slot immediately after settlement', async () => {
        const onSlot = jest.fn();
        const clock = new FastExecutionClock(onSlot);

        clock.start();
        expect(onSlot).toHaveBeenCalledTimes(1);

        clock.scheduleAfterSettlement();
        jest.runAllTicks();
        expect(onSlot).toHaveBeenCalledTimes(2);

        clock.stop();
    });
});