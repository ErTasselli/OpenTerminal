/**
 * True only in the static GitHub Pages build (`npm run build:static`), where
 * there is no Express backend to proxy through. Data that requires a
 * CORS-blocking upstream (Nasdaq quotes/history, FRED) is unavailable in that
 * build; everything backed by CoinGecko/Binance/TradingView still works
 * because those hosts send permissive CORS headers.
 */
export const IS_STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1";
