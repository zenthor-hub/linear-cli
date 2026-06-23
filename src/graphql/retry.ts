/** HTTP statuses worth retrying: rate limiting and transient server errors. */
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface BackoffConfig {
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseDelayMs: 500, maxDelayMs: 10_000 };

/**
 * Compute the delay before the next retry.
 *
 * A valid `Retry-After` header (seconds) wins; otherwise fall back to capped
 * exponential backoff: base * 2^attempt.
 */
export function computeBackoffMs(
  attempt: number,
  retryAfterHeader: string | null,
  config: BackoffConfig = DEFAULT_BACKOFF,
): number {
  const retryAfterSeconds = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, config.maxDelayMs);
  }
  const exponential = config.baseDelayMs * 2 ** attempt;
  return Math.min(exponential, config.maxDelayMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
