import { afterEach, describe, expect, it, vi } from "vitest";
import { latestReleases, supports } from "./fxmacrodata.js";
import { fxmdActual } from "./econcalendar.js";
import type { Release } from "./fxmacrodata.js";

const CPI_ANNOUNCED = Date.parse("2026-09-11T12:30:00Z");

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function releases(...rows: Release[]): Map<string, Release> {
  return new Map(rows.map((r) => [r.indicator, r]));
}

describe("fxmacrodata provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("parses latest/previous rows and skips indicators without a dated print", async () => {
    vi.stubEnv("FXMACRODATA_API_KEY", "");
    const fetchMock = mockFetchOnce({
      currency: "USD",
      data: [
        {
          indicator: "inflation",
          unit: "%YoY",
          latest: { date: "2026-08-31", val: 3.4, announcement_datetime: CPI_ANNOUNCED / 1000 },
          previous: { date: "2026-07-31", val: 3.3, announcement_datetime: 1786537800 },
        },
        { indicator: "afe_dollar_index", unit: "Index", latest: null, previous: null },
        { indicator: "gdp", unit: "USD bn", latest: { val: null, announcement_datetime: 1790000000 } },
      ],
    });

    const out = await latestReleases("usd");
    expect(fetchMock).toHaveBeenCalledWith("https://api.fxmacrodata.com/v1/announcements/usd/latest", {
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
    expect([...out.keys()]).toEqual(["inflation"]);
    expect(out.get("inflation")).toEqual({
      indicator: "inflation",
      unit: "%YoY",
      value: 3.4,
      previous: 3.3,
      announcedAt: CPI_ANNOUNCED,
    });
  });

  it("sends the API key when one is configured", async () => {
    vi.stubEnv("FXMACRODATA_API_KEY", "test-key");
    const fetchMock = mockFetchOnce({ data: [] });
    await latestReleases("EUR");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.fxmacrodata.com/v1/announcements/eur/latest");
    expect(fetchMock.mock.calls[0][1].headers["X-API-Key"]).toBe("test-key");
  });

  it("throws with the currency on a non-OK response", async () => {
    mockFetchOnce({}, false, 401);
    await expect(latestReleases("gbp")).rejects.toThrow("fxmacrodata 401 for GBP");
  });

  it("does not follow redirects, so the key never leaves api.fxmacrodata.com", async () => {
    vi.stubEnv("FXMACRODATA_API_KEY", "secret-key-123");
    const fetchMock = mockFetchOnce({}, false, 302);
    await expect(latestReleases("usd")).rejects.toThrow("fxmacrodata 302 for USD");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("trims the key and never puts it in an error message", async () => {
    vi.stubEnv("FXMACRODATA_API_KEY", "  secret-key-123 ");
    const fetchMock = mockFetchOnce({ data: [] });
    await latestReleases("usd");
    expect(fetchMock.mock.calls[0][1].headers["X-API-Key"]).toBe("secret-key-123");

    vi.stubEnv("FXMACRODATA_API_KEY", "secret-key-123\nInjected: 1");
    const refused = mockFetchOnce({ data: [] });
    const error = await latestReleases("usd").catch((e: Error) => e);
    expect(refused).not.toHaveBeenCalled();
    expect(String(error)).not.toContain("secret-key-123");

    vi.stubEnv("FXMACRODATA_API_KEY", "secret-key-123");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("bad header value secret-key-123")));
    const failed = await latestReleases("usd").catch((e: Error) => e);
    expect(String(failed)).toBe("Error: fxmacrodata request failed for USD (TypeError)");
  });

  it("rejects bodies that are not the documented shape", async () => {
    for (const body of [{ detail: "upstream failure" }, { data: "rows" }, null, [1, 2]]) {
      mockFetchOnce(body);
      await expect(latestReleases("usd")).rejects.toThrow("fxmacrodata returned an unexpected body for USD");
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => JSON.parse("<html>") }));
    await expect(latestReleases("usd")).rejects.toThrow("fxmacrodata returned non-JSON for USD");
  });

  it("only queries three-letter currency codes", async () => {
    const fetchMock = mockFetchOnce({ data: [] });
    await expect(latestReleases("usd/../x")).rejects.toThrow("not a currency code");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only queries non-USD currencies when a key is set", () => {
    vi.stubEnv("FXMACRODATA_API_KEY", "");
    expect(supports("USD")).toBe(true);
    expect(supports("EUR")).toBe(false);
    vi.stubEnv("FXMACRODATA_API_KEY", "test-key");
    expect(supports("EUR")).toBe(true);
  });
});

describe("calendar actuals from fxmacrodata", () => {
  const cpi: Release = { indicator: "inflation", unit: "%YoY", value: 3.4, previous: 3.3, announcedAt: CPI_ANNOUNCED };

  it("fills the actual when the release was announced at the event time", () => {
    const event = new Date("2026-09-11T12:30:00Z");
    expect(fxmdActual("CPI y/y", "USD", event, releases(cpi))).toBe("3.4%");
    expect(fxmdActual("Final CPI y/y", "EUR", event, releases(cpi))).toBe("3.4%");
  });

  it("ignores a print from a previous release cycle", () => {
    const nextMonth = new Date("2026-10-14T12:30:00Z");
    expect(fxmdActual("CPI y/y", "USD", nextMonth, releases(cpi))).toBeNull();
  });

  it("ignores a series whose unit does not match the event", () => {
    const event = new Date("2026-09-11T12:30:00Z");
    const levelCpi: Release = { ...cpi, unit: "Index" };
    expect(fxmdActual("CPI y/y", "USD", event, releases(levelCpi))).toBeNull();
  });

  it("formats rates, claims and the payrolls change the way Forex Factory does", () => {
    const at = Date.parse("2026-10-02T12:30:00Z");
    const event = new Date(at);
    const data = releases(
      { indicator: "policy_rate", unit: "%", value: 4, previous: 3.75, announcedAt: at },
      { indicator: "initial_jobless_claims", unit: "Persons", value: 197_000, previous: 197_000, announcedAt: at },
      { indicator: "non_farm_payrolls", unit: "Persons", value: 159_044_000, previous: 159_015_000, announcedAt: at }
    );
    expect(fxmdActual("Federal Funds Rate", "USD", event, data)).toBe("4.00%");
    expect(fxmdActual("Unemployment Claims", "USD", event, data)).toBe("197K");
    expect(fxmdActual("Non-Farm Employment Change", "USD", event, data)).toBe("29K");
  });

  it("returns null for unmatched titles and missing data", () => {
    const event = new Date("2026-09-11T12:30:00Z");
    expect(fxmdActual("ISM Services PMI", "USD", event, releases(cpi))).toBeNull();
    expect(fxmdActual("CPI y/y", "USD", event, undefined)).toBeNull();
    expect(fxmdActual("Unemployment Rate", "CHF", event, releases(cpi))).toBeNull();
  });
});
