import { FAST_EXECUTION_INTERVAL_MS, FastExecutionClock } from '@/utils/fast-execution-clock';

describe('FastExecutionClock', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('uses a 500 ms FAST interval', () => {
        expect(FAST_EXECUTION_INTERVAL_MS).toBe(500);
    });

    it('opens 120 slots in the first minute window', () => {
        const onSlot = jest.fn();
        const clock = new FastExecutionClock(onSlot);

        clock.start();
        expect(onSlot).toHaveBeenCalledTimes(1);

        // Slot zero is immediate, then slots 1..119 are 500 ms apart.
        // This is 120 purchase slots in [start, start + 60 seconds).
        jest.advanceTimersByTime(119 * FAST_EXECUTION_INTERVAL_MS);
        expect(onSlot).toHaveBeenCalledTimes(120);

        clock.stop();
        jest.advanceTimersByTime(5_000);
        expect(onSlot).toHaveBeenCalledTimes(120);
    });
});