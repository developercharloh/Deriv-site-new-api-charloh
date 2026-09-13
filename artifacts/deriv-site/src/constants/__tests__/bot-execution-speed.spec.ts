import {
    BOT_EXECUTION_SPEED_CHANGED_EVENT,
    getBotExecutionDelayMs,
    getBotExecutionSpeed,
    setBotExecutionSpeed,
    shouldWaitForNextTick,
} from '@/constants/bot-execution-speed';

describe('bot execution speed', () => {
    it('preserves the original delay in SLOW mode', () => {
        expect(getBotExecutionDelayMs(1, 'slow')).toBe(1000);
        expect(getBotExecutionDelayMs(5, 'slow')).toBe(5000);
    });

    it('reduces artificial waits in FAST mode without creating a busy loop', () => {
        expect(getBotExecutionDelayMs(1, 'fast')).toBe(100);
        expect(getBotExecutionDelayMs(5, 'fast')).toBe(500);
        expect(getBotExecutionDelayMs(0, 'fast')).toBe(50);
    });

    it('uses a safe one-second fallback for invalid delay values', () => {
        expect(getBotExecutionDelayMs(undefined, 'slow')).toBe(1000);
        expect(getBotExecutionDelayMs('not-a-number', 'fast')).toBe(100);
    });

    it('uses the next market tick as the FAST loop boundary', () => {
        expect(shouldWaitForNextTick(1, 'fast')).toBe(true);
        expect(shouldWaitForNextTick('1', 'fast')).toBe(true);
        expect(shouldWaitForNextTick(5, 'fast')).toBe(false);
        expect(shouldWaitForNextTick(1, 'slow')).toBe(false);
    });

    it('persists the selected side and notifies the existing run panel', () => {
        const listener = jest.fn();
        window.addEventListener(BOT_EXECUTION_SPEED_CHANGED_EVENT, listener);

        setBotExecutionSpeed('fast');
        expect(getBotExecutionSpeed()).toBe('fast');
        expect(listener).toHaveBeenCalledTimes(1);

        setBotExecutionSpeed('slow');
        expect(getBotExecutionSpeed()).toBe('slow');
        expect(listener).toHaveBeenCalledTimes(2);
        window.removeEventListener(BOT_EXECUTION_SPEED_CHANGED_EVENT, listener);
    });
});