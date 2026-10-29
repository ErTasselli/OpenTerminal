// Black-Scholes (European, no dividends) price, implied volatility and Greeks.
// US equity options are American-style, so these are close approximations —
// good enough to read a chain, not to price a book.

export type Greeks = { iv: number; delta: number; gamma: number; theta: number; vega: number };

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const pdf = (x: number) => Math.exp(-0.5 * x * x) / SQRT_2PI;

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function cdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - pdf(x) * poly;
  return x >= 0 ? p : 1 - p;
}

function d1d2(S: number, K: number, T: number, r: number, sigma: number) {
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return { d1, d2: d1 - sigma * Math.sqrt(T) };
}

export function bsPrice(isCall: boolean, S: number, K: number, T: number, r: number, sigma: number): number {
  const { d1, d2 } = d1d2(S, K, T, r, sigma);
  const disc = Math.exp(-r * T);
  return isCall ? S * cdf(d1) - K * disc * cdf(d2) : K * disc * cdf(-d2) - S * cdf(-d1);
}

/** Bisection on volatility; null when the price is outside no-arbitrage bounds. */
export function impliedVol(isCall: boolean, price: number, S: number, K: number, T: number, r: number): number | null {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;
  let lo = 0.01;
  let hi = 5;
  if (price < bsPrice(isCall, S, K, T, r, lo) || price > bsPrice(isCall, S, K, T, r, hi)) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(isCall, S, K, T, r, mid) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Theta is per calendar day, vega per 1 vol point (1%). */
export function greeks(isCall: boolean, S: number, K: number, T: number, r: number, sigma: number): Greeks {
  const { d1, d2 } = d1d2(S, K, T, r, sigma);
  const disc = Math.exp(-r * T);
  const common = -(S * pdf(d1) * sigma) / (2 * Math.sqrt(T));
  const theta = isCall ? common - r * K * disc * cdf(d2) : common + r * K * disc * cdf(-d2);
  return {
    iv: sigma,
    delta: isCall ? cdf(d1) : cdf(d1) - 1,
    gamma: pdf(d1) / (S * sigma * Math.sqrt(T)),
    theta: theta / 365,
    vega: (S * pdf(d1) * Math.sqrt(T)) / 100,
  };
}

/** Greeks for a chain row from its mid (or last) price; null if IV can't be solved. */
export function rowGreeks(
  isCall: boolean,
  row: { bid: number | null; ask: number | null; lastPrice: number | null; strike: number | null },
  S: number,
  T: number,
  r = 0.04
): Greeks | null {
  if (row.strike === null) return null;
  const mid = row.bid && row.ask ? (row.bid + row.ask) / 2 : row.lastPrice;
  if (!mid) return null;
  const iv = impliedVol(isCall, mid, S, row.strike, T, r);
  return iv === null ? null : greeks(isCall, S, row.strike, T, r, iv);
}
