// FXMacroData (https://fxmacrodata.com) republishes official macro releases with the
// time the publisher actually announced them. One call per currency returns the latest
// and previous print of every indicator, which is all the calendar needs to fill in
// "actual". USD works without a key (free tier, 15-minute delay); other currencies
// need FXMACRODATA_API_KEY.

const BASE_URL = "https://api.fxmacrodata.com/v1";

export type Release = {
  indicator: string;
  unit: string | null;
  value: number;
  previous: number | null;
  announcedAt: number; // ms since epoch
};

export function apiKey(): string | null {
  return process.env.FXMACRODATA_API_KEY?.trim() || null;
}

/** Currencies we can query right now: USD always, everything else only with a key. */
export function supports(currency: string): boolean {
  return currency.toUpperCase() === "USD" || apiKey() !== null;
}

type RawPoint = { val?: unknown; announcement_datetime?: unknown } | null | undefined;
type RawRow = { indicator?: unknown; unit?: unknown; latest?: RawPoint; previous?: RawPoint };

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** Latest release of every indicator for a currency, keyed by indicator slug. */
export async function latestReleases(currency: string): Promise<Map<string, Release>> {
  const key = apiKey();
  const res = await fetch(`${BASE_URL}/announcements/${currency.toLowerCase()}/latest`, {
    headers: key ? { "X-API-Key": key, Accept: "application/json" } : { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`fxmacrodata ${res.status} for ${currency.toUpperCase()}`);
  const body = (await res.json()) as { data?: RawRow[] };

  const out = new Map<string, Release>();
  for (const row of body.data ?? []) {
    const value = num(row.latest?.val);
    const announced = num(row.latest?.announcement_datetime);
    if (typeof row.indicator !== "string" || value === null || announced === null) continue;
    out.set(row.indicator, {
      indicator: row.indicator,
      unit: typeof row.unit === "string" ? row.unit : null,
      value,
      previous: num(row.previous?.val),
      announcedAt: announced * 1000,
    });
  }
  return out;
}
