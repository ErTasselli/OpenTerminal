import { afterEach, describe, expect, it, vi } from "vitest";
import { latest } from "./bcb.js";

afterEach(() => vi.unstubAllGlobals());

describe("bcb.latest", () => {
  it("returns the last observation with an ISO date", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ data: "16/11/2026", valor: "13.75" }] });
    vi.stubGlobal("fetch", fetchMock);
    expect(await latest(432)).toEqual({ date: "2026-11-16", value: 13.75 });
    expect(fetchMock.mock.calls[0][0]).toContain("bcdata.sgs.432/dados/ultimos/1");
  });

  it("returns null for an empty or non-numeric series", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    expect(await latest(432)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{ data: "16/11/2026", valor: "" }] }));
    expect(await latest(432)).toBeNull();
  });

  it("throws on HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(latest(432)).rejects.toThrow("bcb 503");
  });
});
