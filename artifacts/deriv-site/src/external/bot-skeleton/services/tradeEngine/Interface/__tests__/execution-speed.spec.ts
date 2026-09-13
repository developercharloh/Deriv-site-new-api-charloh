import Observer from '@/external/bot-skeleton/utils/observer';
import { sleep } from '../index';

describe('DBot execution speed at the interpreter boundary', () => {
    afterEach(() => {
        window.localStorage.removeItem('dbot_execution_speed');
        jest.useRealTimers();
    });

    it('FAST yields without waiting for another market tick', async () => {
        jest.useFakeTimers();
        window.localStorage.setItem('dbot_execution_speed', 'fast');
        const observer = new Observer();
        let resolved = false;

        const pending = sleep(observer, 1).then(() => {
            resolved = true;
        });

        jest.runOnlyPendingTimers();
        await pending;
        expect(resolved).toBe(true);
    });

    it('SLOW preserves the original one-second delay', async () => {
        jest.useFakeTimers();
        window.localStorage.setItem('dbot_execution_speed', 'slow');
        const observer = new Observer();
        let resolved = false;

        const pending = sleep(observer, 1).then(() => {
            resolved = true;
        });

        jest.advanceTimersByTime(999);
        await Promise.resolve();
        expect(resolved).toBe(false);

        jest.advanceTimersByTime(1);
        jest.advanceTimersByTime(0);
        await pending;
        expect(resolved).toBe(true);
    });
});