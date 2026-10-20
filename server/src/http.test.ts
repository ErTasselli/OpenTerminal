import { afterEach, describe, expect, it, vi } from "vitest";
import { httpFetch } from "./http.js";

afterEach(() => vi.unstubAllGlobals());

/** A fetch that never answers on its own, only when its signal aborts. */
function hangingFetch() {
  return vi.fn((_url: unknown, init: RequestInit = {}) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })
  );
}

describe("httpFetch", () => {
  it("aborts a hung upstream after the timeout instead of waiting forever", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const started = Date.now();
    await expect(httpFetch("https://example.invalid", {}, 50)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("keeps a caller-supplied signal instead of replacing it", async () => {
    const f = hangingFetch();
    vi.stubGlobal("fetch", f);
    const ctl = new AbortController();
    const p = httpFetch("https://example.invalid", { signal: ctl.signal }, 10_000);
    ctl.abort(new Error("caller cancelled"));
    await expect(p).rejects.toThrow("caller cancelled");
    expect(f.mock.calls[0][1]?.signal).toBe(ctl.signal);
  });

  it("passes headers and options through untouched", async () => {
    const f = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", f);
    await httpFetch("https://example.invalid", { headers: { "User-Agent": "x" }, redirect: "manual" });
    expect(f.mock.calls[0][1]).toMatchObject({ headers: { "User-Agent": "x" }, redirect: "manual" });
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
