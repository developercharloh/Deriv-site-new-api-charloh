import {
    BOT_EXECUTION_SPEED_CHANGED_EVENT,
    getBotExecutionDelayMs,
    getBotExecutionSpeed,
    setBotExecutionSpeed,
    shouldWaitForNextTick,
} from '@/constants/bot-execution-speed';

describe('bot execution speed', () => {
    it('does not add a wall-clock delay in either execution mode', () => {
        expect(getBotExecutionDelayMs(1, 'slow')).toBe(0);
        expect(getBotExecutionDelayMs(5, 'slow')).toBe(0);
        expect(getBotExecutionDelayMs(1, 'fast')).toBe(0);
    });

    it('removes artificial waits in FAST mode', () => {
        expect(getBotExecutionDelayMs(1, 'fast')).toBe(0);
        expect(getBotExecutionDelayMs(5, 'fast')).toBe(0);
        expect(getBotExecutionDelayMs(0, 'fast')).toBe(0);
    });

    it('uses a safe zero-delay fallback for invalid values', () => {
        expect(getBotExecutionDelayMs(undefined, 'slow')).toBe(0);
        expect(getBotExecutionDelayMs('not-a-number', 'fast')).toBe(0);
    });

    it('uses the broker tick only for SLOW generated sleep calls', () => {
        expect(shouldWaitForNextTick(1, 'fast')).toBe(false);
        expect(shouldWaitForNextTick('1', 'fast')).toBe(false);
        expect(shouldWaitForNextTick(5, 'fast')).toBe(false);
        expect(shouldWaitForNextTick(1, 'slow')).toBe(true);
        expect(shouldWaitForNextTick(5, 'slow')).toBe(true);
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