import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FETCH_TIMEOUT_MS is read once at module load, so the env var must be set
// before the module is imported.
process.env.PROVIDER_FETCH_TIMEOUT_MS = "50";

// stooq.ts keeps module-level cooldown state (cooldownUntil/consecutiveFailures)
// shared across every call site. That state must not leak between tests, so
// every test below resets the module registry and re-imports stooq fresh,
// matching this repo's convention for isolating other providers' timing-
// sensitive state (see finnhub.test.ts, binance.test.ts, etc.).
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A fetch mock that never resolves on its own — only rejects once the caller's AbortSignal fires. */
function mockHangingFetch() {
  const fetchMock = vi.fn((_url: string, opts?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = opts?.signal;
      if (!signal) return; // no signal means it would hang forever — the bug this guards against
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("stooq provider fetch timeout", () => {
  it("history() rejects quickly when the upstream fetch hangs, instead of hanging forever", async () => {
    mockHangingFetch();
    const { history } = await import("./stooq.js");
    const start = Date.now();
    await expect(history("AAPL")).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("quote() rejects quickly when the upstream fetch hangs, and carries an AbortSignal", async () => {
    const fetchMock = mockHangingFetch();
    const { quote } = await import("./stooq.js");
    const start = Date.now();
    await expect(quote("AAPL")).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});

/** A fetch mock whose promise rejects immediately, as if the connection itself failed (timeout/DNS/refused). */
function mockUnreachableFetch() {
  return vi.fn(() => Promise.reject(new Error("fetch failed: connect ETIMEDOUT")));
}

function mockOkFetch(body: string) {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(body),
    } as unknown as Response)
  );
}

const HISTORY_CSV = "Date,Open,High,Low,Close,Volume\n2024-01-02,100,101,99,100.5,1000\n";
const QUOTE_CSV = "Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,240102,160000,100,101,99,100.5,1000\n";

describe("stooq provider cooldown", () => {
  it("fails fast without a second network attempt while cooling down after a connection failure", async () => {
    vi.useFakeTimers();
    const fetchMock = mockUnreachableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { history } = await import("./stooq.js");

    await expect(history("AAPL")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(history("AAPL")).rejects.toThrow(/cooling down/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second network attempt was made
  });

  it("shares the cooldown across quote() and history() (one host, one circuit)", async () => {
    vi.useFakeTimers();
    const fetchMock = mockUnreachableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { history, quote } = await import("./stooq.js");

    await expect(history("AAPL")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(quote("AAPL")).rejects.toThrow(/cooling down/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // quote() didn't attempt a network call either
  });

  it("backs off further on consecutive failures, capped at 5 minutes", async () => {
    vi.useFakeTimers();
    const fetchMock = mockUnreachableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { history } = await import("./stooq.js");

    await expect(history("AAPL")).rejects.toThrow(); // failure #1 -> ~30s cooldown
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000); // cooldown #1 elapsed
    await expect(history("AAPL")).rejects.toThrow(); // failure #2 -> ~60s cooldown
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000); // only 30s of the 60s cooldown elapsed
    await expect(history("AAPL")).rejects.toThrow(/cooling down/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // still cooling down, no new attempt

    await vi.advanceTimersByTimeAsync(30_000); // now the full 60s has elapsed
    await expect(history("AAPL")).rejects.toThrow(); // failure #3 -> ~90s cooldown
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resets the failure count and clears the cooldown after a success", async () => {
    vi.useFakeTimers();
    const fetchMock = mockUnreachableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { history } = await import("./stooq.js");

    await expect(history("AAPL")).rejects.toThrow(); // failure #1 -> ~30s cooldown
    await vi.advanceTimersByTimeAsync(30_000);

    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(HISTORY_CSV) } as unknown as Response)
    );
    await expect(history("AAPL")).resolves.toBeInstanceOf(Array); // success resets the counter

    fetchMock.mockImplementation(() => Promise.reject(new Error("fetch failed: connect ETIMEDOUT")));
    await expect(history("AAPL")).rejects.toThrow(); // failure after a success -> back to ~30s, not ~60s
    const callsAfterSecondFailure = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(30_000); // if the counter had reset, 30s is enough to clear this cooldown
    await expect(history("AAPL")).rejects.not.toThrow(/cooling down/);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterSecondFailure); // a real attempt was made, not a fail-fast
  });

  it("does not trigger the cooldown on a reachable-but-bad-status response", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve("") } as unknown as Response)
    );
    vi.stubGlobal("fetch", fetchMock);
    const { history, quote } = await import("./stooq.js");

    await expect(history("AAPL")).rejects.toThrow("stooq 503");
    await expect(quote("AAPL")).rejects.toThrow("stooq 503"); // not a fail-fast "cooling down" error
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("quote() still parses a normal successful response correctly (healthy behavior unchanged)", async () => {
    const fetchMock = mockOkFetch(QUOTE_CSV);
    vi.stubGlobal("fetch", fetchMock);
    const { quote } = await import("./stooq.js");

    await expect(quote("AAPL")).resolves.toMatchObject({ source: "stooq", price: 100.5 });
  });
});
