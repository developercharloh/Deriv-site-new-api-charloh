type StorageRecord = Record<string, unknown>;

/**
 * Read a JSON object from localStorage without letting stale or corrupt data
 * crash the app during render. Only the invalid key is removed.
 */
export const getLocalStorageRecord = (key: string): StorageRecord => {
    if (typeof window === 'undefined') return {};

    let value: string | null;
    try {
        value = window.localStorage.getItem(key);
    } catch {
        return {};
    }

    if (value === null) return {};

    try {
        const parsed: unknown = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as StorageRecord;
        }
    } catch {
        // Fall through and remove this one corrupt value below.
    }

    try {
        window.localStorage.removeItem(key);
    } catch {
        // Storage can be unavailable in restricted browser modes.
    }
    return {};
};
