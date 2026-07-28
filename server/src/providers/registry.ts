export type ProviderStats = {
  name: string;
  ok: number;
  failed: number;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  lastError: string | null;
  lastSuccess: string | null;
};

const stats = new Map<string, ProviderStats>();

function getStats(name: string): ProviderStats {
  let s = stats.get(name);
  if (!s) {
    s = { name, ok: 0, failed: 0, lastLatencyMs: null, avgLatencyMs: null, lastError: null, lastSuccess: null };
    stats.set(name, s);
  }
  return s;
}

/** Run fn while recording latency/health for the named provider. */
export async function tracked<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const s = getStats(provider);
  const t0 = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    s.ok++;
    s.lastLatencyMs = ms;
    s.avgLatencyMs = s.avgLatencyMs === null ? ms : Math.round(s.avgLatencyMs * 0.8 + ms * 0.2);
    s.lastSuccess = new Date().toISOString();
    return result;
  } catch (err) {
    s.failed++;
    s.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

/** Try each provider in order; return the first success. */
export async function withFallback<T>(attempts: Array<[string, () => Promise<T>]>): Promise<T> {
  let lastErr: unknown = new Error("no providers configured");
  for (const [name, fn] of attempts) {
    try {
      return await tracked(name, fn);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export function allStats(): ProviderStats[] {
  return [...stats.values()];
}
