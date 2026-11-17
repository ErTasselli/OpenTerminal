// Banco Central do Brasil's SGS time-series API — public JSON, no API key.
// Used for the Brazil macro panel (Selic target, IPCA inflation).

export type SeriesPoint = { date: string; value: number };

/** SGS series codes used by the app. */
export const BCB_SERIES = {
  /** Selic target rate set by Copom, % a.a. */
  selicTarget: 432,
  /** IPCA consumer inflation, trailing 12 months, %. */
  ipca12m: 13522,
} as const;

/** "16/11/2026" -> "2026-11-16" */
function isoDate(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split("/");
  return `${y}-${m}-${d}`;
}

/** Most recent observation of an SGS series, or null when it has none. */
export async function latest(code: number): Promise<SeriesPoint | null> {
  const res = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/1?formato=json`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`bcb ${res.status} for series ${code}`);
  const rows: Array<{ data?: string; valor?: string }> = await res.json();
  const last = Array.isArray(rows) ? rows[rows.length - 1] : undefined;
  // Number("") is 0, so a blank value must be rejected before converting.
  if (!last?.data || !last.valor?.trim()) return null;
  const value = Number(last.valor);
  if (!isFinite(value)) return null;
  return { date: isoDate(last.data), value };
}
