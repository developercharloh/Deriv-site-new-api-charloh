export type BotExecutionSpeed = 'slow' | 'fast';

export const BOT_EXECUTION_SPEED_KEY = 'dbot_execution_speed';
export const BOT_EXECUTION_SPEED_CHANGED_EVENT = 'dbot-execution-speed-changed';

const FAST_DELAY_MULTIPLIER = 0.1;
const MINIMUM_FAST_DELAY_MS = 50;

export const getBotExecutionSpeed = (): BotExecutionSpeed => {
    if (typeof window === 'undefined') return 'slow';

    try {
        return window.localStorage.getItem(BOT_EXECUTION_SPEED_KEY) === 'fast' ? 'fast' : 'slow';
    } catch {
        return 'slow';
    }
};

export const setBotExecutionSpeed = (speed: BotExecutionSpeed) => {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(BOT_EXECUTION_SPEED_KEY, speed);
        window.dispatchEvent(new CustomEvent(BOT_EXECUTION_SPEED_CHANGED_EVENT, { detail: speed }));
    } catch {
        // Storage can be unavailable in private browsing contexts. The running
        // bot still uses SLOW safely when no persisted preference is available.
    }
};

export const getBotExecutionDelayMs = (
    seconds: number | string | undefined,
    speed: BotExecutionSpeed
): number => {
    const numericSeconds = Number(seconds);
    const safeSeconds = Number.isFinite(numericSeconds) ? Math.max(0, numericSeconds) : 1;

    if (speed === 'fast') {
        return Math.max(MINIMUM_FAST_DELAY_MS, Math.round(safeSeconds * 1000 * FAST_DELAY_MULTIPLIER));
    }

    return Math.round(safeSeconds * 1000);
};

/**
 * The generated DBot loop calls sleep(1) when it has not produced trade
 * options for the current cycle. FAST mode should advance from that point on
 * the next market tick, rather than polling the same tick on a timer.
 */
export const shouldWaitForNextTick = (seconds: number | string | undefined, speed: BotExecutionSpeed): boolean =>
    speed === 'fast' && Number(seconds) === 1;
