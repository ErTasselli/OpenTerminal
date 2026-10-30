type Entry = { value: unknown; expires: number };

// Caps the number of distinct keys each cache can hold. Keys are derived from
// caller-controlled input (symbols, search queries, etc.), so without a cap a
// remote caller could grow these maps without bound.
const MAX_STORE_ENTRIES = 1000;
const MAX_STALE_ENTRIES = 1000;

// Evicts the least-recently-used entry (Map iteration order = insertion order,
// and both `set` below re-insert on touch) until `map` is back under `max`.
function evictLru<V>(map: Map<string, V>, max: number): void {
  while (map.size > max) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

const store = new Map<string, Entry>();

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    store.delete(key);
    return undefined;
  }
  // Re-insert to mark as most-recently-used.
  store.delete(key);
  store.set(key, e);
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  store.delete(key);
  store.set(key, { value, expires: Date.now() + ttlMs });
  evictLru(store, MAX_STORE_ENTRIES);
}

// Stale entries are kept around so provider outages can fall back to last-known data.
// Bounded and LRU-evicted for the same reason as `store` above.
const staleStore = new Map<string, unknown>();

export function staleSet(key: string, value: unknown): void {
  staleStore.delete(key);
  staleStore.set(key, value);
  evictLru(staleStore, MAX_STALE_ENTRIES);
}

export function staleGet<T>(key: string): T | undefined {
  if (!staleStore.has(key)) return undefined;
  const value = staleStore.get(key) as T;
  staleStore.delete(key);
  staleStore.set(key, value);
  return value;
}

// In-flight loads, so N concurrent misses on one key share one upstream call
// instead of each fanning out to the providers (a cache stampede).
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const load = (async () => {
    try {
      const value = await fn();
      cacheSet(key, value, ttlMs);
      staleSet(key, value);
      return value;
    } catch (err) {
      const stale = staleGet<T>(key);
      if (stale !== undefined) return stale;
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, load);
  return load;
}

export function cacheStore(key: string, value: unknown, ttlMs: number): void {
  cacheSet(key, value, ttlMs);
  staleSet(key, value);
}

