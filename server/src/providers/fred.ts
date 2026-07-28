// FRED (Federal Reserve Economic Data) publishes a public CSV endpoint with
// no API key required — used here for Treasury yields and VIX close.

export type SeriesPoint = { date: string; value: number };

export async function series(seriesId: string, lastN = 260): Promise<SeriesPoint[]> {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`);
  if (!res.ok) throw new Error(`fred ${res.status} for ${seriesId}`);
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1); // drop header row
  const points: SeriesPoint[] = [];
  for (const line of lines) {
    const [date, raw] = line.split(",");
    const value = Number(raw);
    if (!date || !isFinite(value)) continue;
    points.push({ date, value });
  }
  return points.slice(-lastN);
}

export async function latest(seriesId: string): Promise<SeriesPoint | null> {
  const points = await series(seriesId, 5);
  return points.length > 0 ? points[points.length - 1] : null;
}
