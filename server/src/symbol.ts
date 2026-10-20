// Server-side twin of web/lib/symbol.ts. Characters seen in Yahoo-style
// tickers: AAPL, BRK-B, ^GSPC, 0700.HK, EURUSD=X, GC=F, M&M.NS. At least one
// alphanumeric is required so dot-only values like ".." can't act as path
// segments once interpolated into provider URLs or cache keys. The first
// character must be alphanumeric or ^: no real ticker starts with = - & or .,
// and a leading = + - @ is the shape of a spreadsheet formula (CSV injection).
export const SYMBOL_RE = /^(?=.*[A-Z0-9])[A-Z0-9^][A-Z0-9.\-^=&]{0,19}$/;

/** Uppercases and trims; null when the input isn't a plausible ticker. */
export function normalizeSymbol(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}
