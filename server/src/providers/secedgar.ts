// SEC EDGAR — insider transactions (Form 4), straight from the primary source.
// Free, no key, no rate-limit games (SEC just asks for an identifying User-Agent
// and stays under ~10 req/s, both trivially satisfied here).
import { XMLParser } from "fast-xml-parser";
import { mapWithConcurrency } from "../concurrency.js";

// SEC rejects requests whose User-Agent doesn't look like "<app/company> <contact-email>" —
// a bare product name or URL gets a flat 403, so this exact shape matters. SEC uses it to
// reach whoever's operating a deployment if their traffic misbehaves, so self-hosters should
// set SEC_EDGAR_CONTACT to their own email; this default is just enough to pass the check
// without baking anyone's real contact info into source.
export const SEC_UA = `OpenTerminal ${process.env.SEC_EDGAR_CONTACT ?? "admin@example.com"}`;
const parser = new XMLParser({ ignoreAttributes: false });

const FETCH_TIMEOUT_MS = Number(process.env.PROVIDER_FETCH_TIMEOUT_MS) || 9000;

async function edgarFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": SEC_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`sec edgar ${res.status} for ${url}`);
  return res.json();
}

const TICKER_MAP_TTL = 86_400_000; // 24h — company_tickers.json is a multi-MB file, refresh rarely.

// Kept in its own module-level slot rather than the shared, size-capped cache in
// cache.ts: that cache evicts least-recently-used entries once ~1000 distinct keys
// are in play (every other route's per-symbol/per-query cache key included), which
// would otherwise force this multi-MB file to be re-fetched well before its TTL.
let tickerMapEntry: { map: Map<string, string>; expires: number } | null = null;

async function fetchTickerMap(): Promise<Map<string, string>> {
  if (tickerMapEntry && Date.now() < tickerMapEntry.expires) return tickerMapEntry.map;
  const data = await edgarFetch("https://www.sec.gov/files/company_tickers.json");
  const map = new Map<string, string>();
  for (const row of Object.values(data) as Array<{ ticker: string; cik_str: number }>) {
    map.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  }
  tickerMapEntry = { map, expires: Date.now() + TICKER_MAP_TTL };
  return map;
}

/** Ticker -> zero-padded 10-digit CIK, from SEC's full company list (cached, refreshed periodically). */
export async function resolveCik(symbol: string): Promise<string | null> {
  const tickerMap = await fetchTickerMap();
  return tickerMap.get(symbol.toUpperCase()) ?? null;
}

export type InsiderTransaction = {
  filingDate: string; // ISO
  transactionDate: string; // ISO
  ownerName: string;
  ownerTitle: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  transactionCode: string;
  acquiredDisposed: "A" | "D" | null;
  shares: number | null;
  pricePerShare: number | null;
  value: number | null;
  sharesOwnedAfter: number | null;
};

type FilingRef = { accessionNumber: string; filingDate: string; primaryDocument: string };

async function recentForm4Filings(cik: string, limit: number): Promise<FilingRef[]> {
  const data = await edgarFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const recent = data?.filings?.recent;
  if (!recent) return [];
  const out: FilingRef[] = [];
  for (let i = 0; i < recent.form.length && out.length < limit; i++) {
    if (recent.form[i] !== "4") continue;
    out.push({
      accessionNumber: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
      primaryDocument: recent.primaryDocument[i],
    });
  }
  return out;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

async function parseForm4(cik: string, filing: FilingRef): Promise<InsiderTransaction[]> {
  const accessionNoDashes = filing.accessionNumber.replace(/-/g, "");
  // primaryDocument is the XSLT-rendered viewer path (e.g. "xslF345X06/form4.xml") —
  // the raw data XML sits at the accession folder root under its own filename.
  const filename = filing.primaryDocument.split("/").pop();
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDashes}/${filename}`;
  const res = await fetch(url, { headers: { "User-Agent": SEC_UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return [];
  const xml = await res.text();
  const doc = parser.parse(xml)?.ownershipDocument;
  if (!doc) return [];

  const owner = doc.reportingOwner;
  const ownerName: string = owner?.reportingOwnerId?.rptOwnerName ?? "Unknown";
  const rel = owner?.reportingOwnerRelationship ?? {};
  const isDirector = rel.isDirector === "1" || rel.isDirector === true;
  const isOfficer = rel.isOfficer === "1" || rel.isOfficer === true;
  const isTenPercentOwner = rel.isTenPercentOwner === "1" || rel.isTenPercentOwner === true;
  const ownerTitle: string | null = rel.officerTitle || null;

  // Open-market buys/sells only (nonDerivativeTable) — grants/option exercises live in
  // derivativeTable and are routine compensation, not the signal people watch this for.
  const raw = doc.nonDerivativeTable?.nonDerivativeTransaction;
  if (!raw) return [];
  const rows = Array.isArray(raw) ? raw : [raw];

  return rows.map((r: any): InsiderTransaction => {
    const shares = num(r.transactionAmounts?.transactionShares?.value);
    const price = num(r.transactionAmounts?.transactionPricePerShare?.value);
    return {
      filingDate: filing.filingDate,
      transactionDate: r.transactionDate?.value ?? filing.filingDate,
      ownerName,
      ownerTitle,
      isDirector,
      isOfficer,
      isTenPercentOwner,
      transactionCode: r.transactionCoding?.transactionCode ?? "?",
      acquiredDisposed: r.transactionAmounts?.transactionAcquiredDisposedCode?.value ?? null,
      shares,
      pricePerShare: price,
      value: shares !== null && price !== null ? shares * price : null,
      sharesOwnedAfter: num(r.postTransactionAmounts?.sharesOwnedFollowingTransaction?.value),
    };
  });
}

// Bounds how many of a single request's Form 4 filings are fetched from
// sec.gov at once, so one call to insiderTransactions() can't burst past the
// ~10 req/s SEC asks callers to stay under (see file header).
const SEC_FETCH_CONCURRENCY = 5;

/** Most recent open-market insider transactions for a symbol, newest first. */
export async function insiderTransactions(symbol: string, filingLimit = 20): Promise<InsiderTransaction[]> {
  const cik = await resolveCik(symbol);
  if (!cik) return [];
  const filings = await recentForm4Filings(cik, filingLimit);
  const parsed = await mapWithConcurrency(filings, SEC_FETCH_CONCURRENCY, (f) => parseForm4(cik, f).catch(() => []));
  return parsed.flat().sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
}
