import { FAST_EXECUTION_INTERVAL_MS, FastExecutionClock } from '@/utils/fast-execution-clock';

describe('FastExecutionClock', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('opens 35 slots in the first minute window', () => {
        const onSlot = jest.fn();
        const clock = new FastExecutionClock(onSlot);

        clock.start();
        expect(onSlot).toHaveBeenCalledTimes(1);

        // Slot zero is immediate, then slots 1..34 are 1.75 seconds apart.
        // This is 35 purchase slots in [start, start + 60 seconds).
        jest.advanceTimersByTime(34 * FAST_EXECUTION_INTERVAL_MS);
        expect(onSlot).toHaveBeenCalledTimes(35);

        clock.stop();
        jest.advanceTimersByTime(5_000);
        expect(onSlot).toHaveBeenCalledTimes(35);
    });
});