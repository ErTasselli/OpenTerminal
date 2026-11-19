import { afterEach, describe, expect, it, vi } from "vitest";

// FETCH_TIMEOUT_MS is read once at module load, so the env var must be set
// before the module is imported.
process.env.PROVIDER_FETCH_TIMEOUT_MS = "50";

const { earningsSurprise } = await import("./nasdaq.js");

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

describe("nasdaq provider fetch timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects quickly when the upstream fetch hangs, instead of hanging forever", async () => {
    mockHangingFetch();
    const start = Date.now();
    await expect(earningsSurprise("AAPL")).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("carries an AbortSignal on the outbound fetch, alongside the existing headers", async () => {
    const fetchMock = mockHangingFetch();
    await expect(earningsSurprise("AAPL")).rejects.toThrow();
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect((opts.headers as Record<string, string>)["User-Agent"]).toBeTruthy();
  });
});
