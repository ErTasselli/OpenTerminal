/**
 * Bare B3 (Brazil) tickers: four letters plus a share-class number — PETR4,
 * VALE3, ITUB4, units/FIIs/BDRs like AUVP11, BPAC11, AAPL34. US listings never
 * contain digits, so this shape is unambiguous for the markets we serve.
 */
const B3_BARE_TICKER = /^[A-Z]{4}\d{1,2}$/;

/**
 * Yahoo exchange suffixes of the non-US listings the app serves (kept in step
 * with EXCHANGE_SUFFIX in providers/tradingview.ts). Single letters like ".L"
 * (London) and ".T" (Tokyo) are listed explicitly so US share classes such as
 * BRK.B or BF.B are not mistaken for foreign listings.
 */
const NON_US_SUFFIX = /\.(SA|BA|MI|PA|AS|BR|LS|DE|L|MC|SW|ST|CO|HE|OL|TO|AX|HK|T|NS|BO)$/;

/**
 * The symbol to send to quote/history/news providers. Yahoo only knows B3
 * listings with the ".SA" suffix, but symbols reach us bare when typed by hand
 * or saved before search results carried the suffix, so add it here.
 */
export function toProviderSymbol(symbol: string): string {
  return B3_BARE_TICKER.test(symbol) ? `${symbol}.SA` : symbol;
}

/** A B3 listing, bare (PETR4) or suffixed (PETR4.SA). */
export function isB3Symbol(symbol: string): boolean {
  return toProviderSymbol(symbol).endsWith(".SA");
}

/** PETR4.SA / PETR4 -> PETR4: the ticker as Brazilian investors and news write it. */
export function b3Ticker(symbol: string): string {
  return symbol.replace(/\.SA$/, "");
}

/**
 * A security listed on a non-US exchange (Yahoo suffix, or a bare B3 ticker).
 * US-only datasets — options chains, earnings history, SEC/FINRA filings —
 * cannot have it, so routes can say so instead of reporting an outage.
 * Indexes and FX pairs are not "foreign listings": Yahoo serves options on
 * ^SPX and ^VIX, for instance.
 */
export function isForeignListing(symbol: string): boolean {
  return NON_US_SUFFIX.test(toProviderSymbol(symbol));
}

/**
 * Whether this is a US-listed security, i.e. something Nasdaq's API can
 * possibly serve. False for foreign listings, Yahoo FX pairs/futures
 * ("BRLUSD=X", "GC=F") and indexes ("^BVSP", "^GSPC" — Nasdaq's quote API
 * serves none of them), so callers can skip a request that is certain to fail
 * instead of paying its latency on every lookup.
 */
export function isUsListing(symbol: string): boolean {
  const s = toProviderSymbol(symbol);
  return !isForeignListing(s) && !s.includes("=") && !s.startsWith("^");
}
