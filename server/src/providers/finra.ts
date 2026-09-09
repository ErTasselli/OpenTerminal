// FINRA Reg SHO daily short-sale-volume file — free, no key, one file per
// trading day covering every US-listed symbol. We fetch and parse the whole
// day's file once (the route layer caches it), then look symbols up from it.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type ShortVolumeRow = {
  date: string; // YYYYMMDD
  shortVolume: number;
  shortExemptVolume: number;
  totalVolume: number;
};

function fmtDate(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function fetchDay(dateStr: string): Promise<Map<string, ShortVolumeRow> | null> {
  const res = await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${dateStr}.txt`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) return null;
  const text = await res.text();
  const lines = text.trim().split("\n");
  const map = new Map<string, ShortVolumeRow>();
  for (const line of lines.slice(1)) {
    const [date, symbol, shortVolStr, shortExemptStr, totalVolStr] = line.split("|");
    if (!symbol) continue;
    const shortVolume = Number(shortVolStr);
    const shortExemptVolume = Number(shortExemptStr);
    const totalVolume = Number(totalVolStr);
    if (!isFinite(shortVolume) || !isFinite(totalVolume)) continue;
    map.set(symbol, { date, shortVolume, shortExemptVolume: isFinite(shortExemptVolume) ? shortExemptVolume : 0, totalVolume });
  }
  return map;
}

/**
 * Most recent published trading day's short-volume file, symbol -> row.
 * FINRA publishes the prior session's file the next morning and has no file
 * at all for weekends/holidays, so we walk back up to 7 days to find one.
 */
export async function latestDay(): Promise<Map<string, ShortVolumeRow>> {
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const data = await fetchDay(fmtDate(d));
    if (data) return data;
  }
  throw new Error("finra: no short volume file found in the last 7 days");
}
