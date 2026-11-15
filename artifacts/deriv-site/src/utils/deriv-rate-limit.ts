const RATE_LIMIT_BACKOFF_CAP_MS = 30_000;

export const isDerivRateLimitError = (value: unknown): boolean =>
    /rate[\s_-]*limit|too many requests|request limit exceeded/i.test(String(value ?? ''));

export const getDerivRateLimitBackoffMs = (attempt: number): number => {
    const exponent = Math.min(5, Math.max(0, Math.floor(attempt) - 1));
    return Math.min(1_000 * 2 ** exponent, RATE_LIMIT_BACKOFF_CAP_MS);
};
