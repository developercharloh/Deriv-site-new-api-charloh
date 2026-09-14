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

    it('keeps a 1.75-second safety interval and a 500 ms settlement rest', () => {
        expect(FAST_EXECUTION_INTERVAL_MS).toBe(800);
        expect(FAST_SETTLEMENT_REST_MS).toBe(400);
    });

    it('opens 35 slots in the first minute window', () => {
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

    it('resets the next slot to 500 ms after settlement', () => {
        const onSlot = jest.fn();
        const clock = new FastExecutionClock(onSlot);

        clock.start();
        expect(onSlot).toHaveBeenCalledTimes(1);

        clock.scheduleAfterSettlement();
        jest.advanceTimersByTime(399);
        expect(onSlot).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(1);
        expect(onSlot).toHaveBeenCalledTimes(2);

        clock.stop();
    });
});