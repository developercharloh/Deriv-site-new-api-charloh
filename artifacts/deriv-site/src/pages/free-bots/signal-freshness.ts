import type { BotSignal } from '@/utils/bot-patch';

export const SIGNAL_TTL_MS = 5 * 60 * 1000;

export function isSignalFresh(
    signal: Pick<BotSignal, 'savedAt' | 'expiresAt'>,
    now = Date.now(),
): boolean {
    const savedAt = signal.savedAt;
    if (!Number.isFinite(savedAt) || savedAt! > now || now - savedAt! > SIGNAL_TTL_MS) {
        return false;
    }
    if (signal.expiresAt !== undefined) {
        return Number.isFinite(signal.expiresAt) && signal.expiresAt! > now;
    }
    return true;
}
