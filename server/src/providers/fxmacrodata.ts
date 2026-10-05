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

// Header-safe key: printable ASCII, no spaces. Anything else is refused before the
// request so a runtime header error (whose message can quote the value) never happens.
const KEY_PATTERN = /^[!-~]+$/;

function headers(): Record<string, string> {
  const key = apiKey();
  if (key !== null && !KEY_PATTERN.test(key)) throw new Error("fxmacrodata key has characters not allowed in a header");
  return key ? { "X-API-Key": key, Accept: "application/json" } : { Accept: "application/json" };
}

async function getJson(url: string, label: string): Promise<unknown> {
  let res: Response;
  try {
    // redirect: "manual" keeps the key on api.fxmacrodata.com; fetch would otherwise
    // re-send X-API-Key to wherever a redirect points.
    res = await fetch(url, { headers: headers(), redirect: "manual" });
  } catch (err) {
    throw new Error(`fxmacrodata request failed for ${label} (${err instanceof Error ? err.name : "error"})`);
  }
  if (res.status !== 200) throw new Error(`fxmacrodata ${res.status} for ${label}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`fxmacrodata returned non-JSON for ${label}`);
  }
}

function toRelease(row: RawRow): Release | null {
  const value = num(row?.latest?.val);
  const announced = num(row?.latest?.announcement_datetime);
  if (typeof row?.indicator !== "string" || value === null || announced === null) return null;
  return {
    indicator: row.indicator,
    unit: typeof row.unit === "string" ? row.unit : null,
    value,
    previous: num(row.previous?.val),
    announcedAt: announced * 1000,
  };
}

/** Latest release of every indicator for a currency, keyed by indicator slug. */
export async function latestReleases(currency: string): Promise<Map<string, Release>> {
  const label = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(label)) throw new Error(`fxmacrodata: not a currency code: ${label}`);
  const body = await getJson(`${BASE_URL}/announcements/${label.toLowerCase()}/latest`, label);
  const rows = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) throw new Error(`fxmacrodata returned an unexpected body for ${label}`);

  const out = new Map<string, Release>();
  for (const row of rows as RawRow[]) {
    const release = toRelease(row);
    if (release) out.set(release.indicator, release);
  }
  return out;
}
