type StorageRecord = Record<string, unknown>;

/**
 * Read a JSON value from localStorage without allowing stale or corrupt data
 * to crash the app. Only the invalid key is removed.
 */
export const getLocalStorageJson = <T>(
    key: string,
    fallback: T,
    isValid: (value: unknown) => value is T
): T => {
    if (typeof window === 'undefined') return fallback;

    let value: string | null;
    try {
        value = window.localStorage.getItem(key);
    } catch {
        return fallback;
    }

    if (value === null) return fallback;

    try {
        const parsed: unknown = JSON.parse(value);
        if (isValid(parsed)) return parsed;
    } catch {
        // Fall through and remove this one corrupt value below.
    }

    try {
        window.localStorage.removeItem(key);
    } catch {
        // Storage can be unavailable in restricted browser modes.
    }
    return fallback;
};

/**
 * Read a JSON object from localStorage without letting stale or corrupt data
 * crash the app during render. Only the invalid key is removed.
 */
export const getLocalStorageRecord = (key: string): StorageRecord => {
    return getLocalStorageJson(
        key,
        {},
        (value): value is StorageRecord => !!value && typeof value === 'object' && !Array.isArray(value)
    );
};
