/**
 * Bare B3 (Brazil) tickers: four letters plus a share-class number — PETR4,
 * VALE3, ITUB4, units/FIIs/BDRs like AUVP11, BPAC11, AAPL34. US listings never
 * contain digits, so this shape is unambiguous for the markets we serve.
 */
const B3_BARE_TICKER = /^[A-Z]{4}\d{1,2}$/;

/**
 * The symbol to send to quote/history/news providers. Yahoo only knows B3
 * listings with the ".SA" suffix, but symbols reach us bare when typed by hand
 * or saved before search results carried the suffix, so add it here.
 */
export function toProviderSymbol(symbol: string): string {
  return B3_BARE_TICKER.test(symbol) ? `${symbol}.SA` : symbol;
}
