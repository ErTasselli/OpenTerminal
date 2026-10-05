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
