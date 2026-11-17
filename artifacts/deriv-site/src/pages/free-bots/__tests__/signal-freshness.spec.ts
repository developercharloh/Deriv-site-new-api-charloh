import { isSignalFresh } from '../signal-freshness';

describe('Over/Under signal freshness', () => {
    const now = 100_000;

    it('accepts signals that have not reached their own expiry', () => {
        expect(isSignalFresh({ savedAt: now - 1_000, expiresAt: now + 1 }, now)).toBe(true);
    });

    it('rejects a signal at or after its expiry time', () => {
        expect(isSignalFresh({ savedAt: now - 1_000, expiresAt: now }, now)).toBe(false);
        expect(isSignalFresh({ savedAt: now - 1_000, expiresAt: now - 1 }, now)).toBe(false);
    });

    it('rejects stale, missing-timestamp, and future-dated signals', () => {
        expect(isSignalFresh({ savedAt: now - 5 * 60 * 1000 - 1 }, now)).toBe(false);
        expect(isSignalFresh({ savedAt: undefined }, now)).toBe(false);
        expect(isSignalFresh({ savedAt: now + 1 }, now)).toBe(false);
    });
});
