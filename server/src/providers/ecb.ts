import { httpFetch } from "../http.js";

// ECB Statistical Data Warehouse (SDW) — public CSV endpoint, no API key
// required. Mirrors the FRED provider's shape for euro-area macro data.
//
// Unlike FRED, every ECB dataflow has a different column layout (dimension
// columns vary per flow), so TIME_PERIOD/OBS_VALUE are located by header name
// rather than fixed index.

export type SeriesPoint = { date: string; value: number };

export async function series(flowRef: string, key: string, lastN = 260): Promise<SeriesPoint[]> {
  const url = `https://data-api.ecb.europa.eu/service/data/${flowRef}/${key}?format=csvdata&lastNObservations=${lastN}`;
  const res = await httpFetch(url);
  if (!res.ok) throw new Error(`ecb ${res.status} for ${flowRef}/${key}`);
  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",");
  const timeIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");
  if (timeIdx === -1 || valueIdx === -1) return [];

  const points: SeriesPoint[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = cols[timeIdx];
    const raw = cols[valueIdx];
    // Number("") is 0, not NaN — ECB rows for a provisional/missing
    // observation leave OBS_VALUE empty, so the blank check must come first
    // or a missing point silently becomes a real zero.
    if (!date || !raw) continue;
    const value = Number(raw);
    if (!isFinite(value)) continue;
    points.push({ date, value });
  }
  return points.slice(-lastN);
}

export async function latest(flowRef: string, key: string): Promise<SeriesPoint | null> {
  const points = await series(flowRef, key, 5);
  return points.length > 0 ? points[points.length - 1] : null;
}
