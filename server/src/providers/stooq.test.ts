import { afterEach, describe, expect, it, vi } from "vitest";

// FETCH_TIMEOUT_MS is read once at module load, so the env var must be set
// before the module is imported.
process.env.PROVIDER_FETCH_TIMEOUT_MS = "50";

const { history, quote } = await import("./stooq.js");

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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("history() rejects quickly when the upstream fetch hangs, instead of hanging forever", async () => {
    mockHangingFetch();
    const start = Date.now();
    await expect(history("AAPL")).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("quote() rejects quickly when the upstream fetch hangs, and carries an AbortSignal", async () => {
    const fetchMock = mockHangingFetch();
    const start = Date.now();
    await expect(quote("AAPL")).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
