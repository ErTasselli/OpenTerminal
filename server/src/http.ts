/** Default ceiling for one upstream call. Free public endpoints occasionally
 * hang instead of failing; without a bound, a hung provider holds the caller's
 * request open (and, via the cache's single-flight, everyone waiting on it). */
export const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * `fetch` with a timeout. Callers that pass their own `signal` keep it.
 * Resolves `globalThis.fetch` per call so tests can stub it.
 */
export function httpFetch(url: string | URL, init: RequestInit = {}, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<Response> {
  return globalThis.fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}
