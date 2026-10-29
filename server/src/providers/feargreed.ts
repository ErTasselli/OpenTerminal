import { tfetch } from "../http.js";
// CNN Fear & Greed Index — free, no key. The endpoint rejects requests that
// don't look like a browser, hence the UA/Origin/Referer headers.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type FearGreed = {
  score: number;
  rating: string;
  timestamp: string;
  previousClose: number | null;
  previousWeek: number | null;
  previousMonth: number | null;
  previousYear: number | null;
  history: Array<{ t: number; v: number }>;
};

const num = (x: unknown): number | null => (typeof x === "number" && isFinite(x) ? x : null);

export async function fetchFearGreed(): Promise<FearGreed> {
  const res = await tfetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
    headers: { "User-Agent": UA, Origin: "https://edition.cnn.com", Referer: "https://edition.cnn.com/" },
  });
  if (!res.ok) throw new Error(`fear&greed http ${res.status}`);
  const j: any = await res.json();
  const fg = j?.fear_and_greed;
  const score = num(fg?.score);
  if (score === null) throw new Error("fear&greed: malformed response");
  const history = Array.isArray(j?.fear_and_greed_historical?.data)
    ? j.fear_and_greed_historical.data
        .map((p: any) => ({ t: Number(p.x), v: Number(p.y) }))
        .filter((p: { t: number; v: number }) => isFinite(p.t) && isFinite(p.v))
        .slice(-130)
    : [];
  return {
    score,
    rating: String(fg.rating ?? ""),
    timestamp: String(fg.timestamp ?? ""),
    previousClose: num(fg.previous_close),
    previousWeek: num(fg.previous_1_week),
    previousMonth: num(fg.previous_1_month),
    previousYear: num(fg.previous_1_year),
    history,
  };
}
