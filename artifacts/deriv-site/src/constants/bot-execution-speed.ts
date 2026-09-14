export type BotExecutionSpeed = 'slow' | 'fast';

export const BOT_EXECUTION_SPEED_KEY = 'dbot_execution_speed';
export const BOT_EXECUTION_SPEED_CHANGED_EVENT = 'dbot-execution-speed-changed';
/**
 * Deriv does not offer a 1-second duration for this synthetic digit market;
 * its supported one-second-equivalent is one broker tick. The FAST scheduler
 * remains wall-clock based and opens one slot every 1.75 seconds. Authoritative
 * settlement resets the next slot to the separate 500 ms rest period.
 */
export const FAST_CONTRACT_DURATION_VALUE = 1;
export const FAST_CONTRACT_DURATION_UNIT = 't';

const FAST_DELAY_MULTIPLIER = 0;
const MINIMUM_FAST_DELAY_MS = 0;

export const getBotExecutionSpeed = (): BotExecutionSpeed => {
    if (typeof window === 'undefined') return 'fast';

    try {
        const storedSpeed = window.localStorage.getItem(BOT_EXECUTION_SPEED_KEY);
        return storedSpeed === 'slow' ? 'slow' : 'fast';
    } catch {
        return 'fast';
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

    // Neither mode adds a wall-clock pause. SLOW yields on the broker tick
    // below, while FAST yields to the event loop and re-arms on its tick path.
    return Math.max(MINIMUM_FAST_DELAY_MS, Math.round(safeSeconds * 1000 * FAST_DELAY_MULTIPLIER));
};

/**
 * SLOW follows the normal event-driven DBot loop: generated sleep calls wait
 * for the next broker tick rather than adding a timer. FAST is paced by the
 * trade engine's 1.75-second wall-clock scheduler with a 500 ms post-settlement
 * rest period.
 */
export const shouldWaitForNextTick = (seconds: number | string | undefined, speed: BotExecutionSpeed): boolean =>
    speed === 'slow' && Number(seconds) > 0;
