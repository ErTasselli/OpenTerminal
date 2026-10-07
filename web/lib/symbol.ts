// Characters seen in Yahoo-style tickers: AAPL, BRK-B, ^GSPC, 0700.HK,
// EURUSD=X, GC=F, M&M.NS. Commas are excluded because the quote endpoints
// take comma-separated symbol lists, and at least one alphanumeric is required
// so dot-only values like ".." can't act as path segments.
const SYMBOL_RE = /^(?=.*[A-Z0-9])[A-Z0-9.\-^=&]{1,20}$/;

/** Uppercases and trims free-text ticker input; null when it isn't a plausible symbol. */
export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

/** Encodes symbols for a `?symbols=` query, keeping the comma separator literal. */
export function symbolsParam(symbols: string[]): string {
  return symbols.map(encodeURIComponent).join(",");
}
