import { getBotExecutionDelayMs } from '@/constants/bot-execution-speed';

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
});