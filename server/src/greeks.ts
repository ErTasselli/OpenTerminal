/**
 * Black-Scholes(-Merton) pricing, Greeks and implied volatility for European
 * options. US equity options are American, so for deep ITM puts and calls
 * ahead of a dividend these are approximations; label them as model values.
 *
 * Units returned to the UI:
 *   delta  per $1 in the underlying          gamma per $1
 *   theta  per calendar day (negative = decay) vega  per 1 vol point (1%)
 *   iv     annualized decimal (0.25 = 25%)
 */
export type Right = "call" | "put";
export type Greeks = { iv: number; delta: number; gamma: number; theta: number; vega: number };

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const pdf = (x: number) => Math.exp(-0.5 * x * x) / SQRT_2PI;

/** Standard normal CDF via the Abramowitz-Stegun 7.1.26 erf approximation (abs error < 1.5e-7). */
export function cdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function d1d2(S: number, K: number, T: number, r: number, sigma: number, q: number) {
  const vt = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vt;
  return { d1, d2: d1 - vt };
}

export function bsPrice(right: Right, S: number, K: number, T: number, r: number, sigma: number, q = 0): number {
  const { d1, d2 } = d1d2(S, K, T, r, sigma, q);
  const dfq = Math.exp(-q * T);
  const dfr = Math.exp(-r * T);
  return right === "call" ? S * dfq * cdf(d1) - K * dfr * cdf(d2) : K * dfr * cdf(-d2) - S * dfq * cdf(-d1);
}

export function greeks(right: Right, S: number, K: number, T: number, r: number, sigma: number, q = 0): Greeks {
  const { d1, d2 } = d1d2(S, K, T, r, sigma, q);
  const dfq = Math.exp(-q * T);
  const dfr = Math.exp(-r * T);
  const sqrtT = Math.sqrt(T);
  const gamma = (dfq * pdf(d1)) / (S * sigma * sqrtT);
  const vega = (S * dfq * pdf(d1) * sqrtT) / 100;
  const decay = -(S * dfq * pdf(d1) * sigma) / (2 * sqrtT);
  const thetaYear =
    right === "call"
      ? decay - r * K * dfr * cdf(d2) + q * S * dfq * cdf(d1)
      : decay + r * K * dfr * cdf(-d2) - q * S * dfq * cdf(-d1);
  const delta = right === "call" ? dfq * cdf(d1) : dfq * (cdf(d1) - 1);
  return { iv: sigma, delta, gamma, theta: thetaYear / 365, vega };
}

/**
 * Volatility that reproduces `price`, by bisection (monotonic in sigma, so it
 * can't diverge the way Newton can on deep ITM/OTM strikes). null when the
 * price breaks no-arbitrage bounds or the vol would be outside [0.1%, 500%].
 */
export function impliedVol(right: Right, price: number, S: number, K: number, T: number, r: number, q = 0): number | null {
  if (!(price > 0 && S > 0 && K > 0 && T > 0)) return null;
  const lower = right === "call" ? Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S * Math.exp(-q * T));
  const upper = right === "call" ? S * Math.exp(-q * T) : K * Math.exp(-r * T);
  if (price <= lower || price >= upper) return null;
  let lo = 0.001;
  let hi = 5;
  if (bsPrice(right, S, K, T, r, lo, q) > price || bsPrice(right, S, K, T, r, hi, q) < price) return null;
  for (let i = 0; i < 100 && hi - lo > 1e-6; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(right, S, K, T, r, mid, q) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Expiry label -> expiry instant (16:00 New York, the equity close; EDT/EST
 * approximated as UTC-4 Mar-Oct, UTC-5 otherwise). Accepts ISO "2026-10-16"
 * (Yahoo) and Nasdaq's year-less "Oct 16", read as the next such date on or
 * after today.
 */
export function parseExpiry(label: string, now = new Date()): Date | null {
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label.trim());
  const short = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(label.trim());
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])];
  } else if (short) {
    m = MONTHS.indexOf(short[1].toLowerCase());
    d = Number(short[2]);
    if (m < 0) return null;
    y = short[3] ? Number(short[3]) : now.getUTCFullYear();
    if (!short[3] && Date.UTC(y, m, d, 23, 59) < now.getTime() - 86_400_000) y += 1;
  } else {
    return null;
  }
  const offsetH = m >= 2 && m <= 9 ? 4 : 5;
  const at = new Date(Date.UTC(y, m, d, 16 + offsetH, 0));
  return at.getUTCDate() === d ? at : null; // rejects Feb 30 etc.
}

type Row = { strike: number | null; bid: number | null; ask: number | null; lastPrice: number | null; impliedVolatility?: number | null };

/** Mid when the quote is a sane two-sided market, else the last trade. */
function markPrice(row: Row): number | null {
  const { bid, ask, lastPrice } = row;
  if (bid != null && ask != null && bid > 0 && ask >= bid) return (bid + ask) / 2;
  return lastPrice != null && lastPrice > 0 ? lastPrice : null;
}

const MIN_T = 1 / (365 * 24 * 4); // 15 minutes: avoids infinities on expiry day

/** Attaches `greeks` (or null) to every row; never throws on bad rows. */
export function withGreeks<R extends Row>(
  rows: R[], right: Right, S: number | null, expiry: Date | null, r: number, now = new Date()
): Array<R & { greeks: Greeks | null }> {
  const T = expiry ? Math.max((expiry.getTime() - now.getTime()) / (365 * 86_400_000), MIN_T) : null;
  return rows.map((row) => {
    if (!S || S <= 0 || T === null || !row.strike || row.strike <= 0) return { ...row, greeks: null };
    const given = row.impliedVolatility;
    const mark = markPrice(row);
    const sigma = given && given > 0.001 && given < 5 ? given : mark !== null ? impliedVol(right, mark, S, row.strike, T, r) : null;
    return { ...row, greeks: sigma === null ? null : greeks(right, S, row.strike, T, r, sigma) };
  });
}
