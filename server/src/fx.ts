// FX pairs as first-class symbols: searchable from the command palette,
// quotable through /api/quotes and chartable through /api/history, the same
// way crypto tickers are. Symbols use the Yahoo-style "USDCLP=X" form, which
// the web app's symbol validator already accepts. Any combination of two
// currencies in CURRENCIES is a valid pair, crosses included (BRL/CLP...).
//
// Quotes come from TradingView's FX_IDC composite interbank feed, which
// covers the thinly traded LatAm crosses; EUR/USD uses FX:EURUSD, the liquid
// major. USD/ARS is the official rate (not the parallel "blue"/MEP rates),
// USD/CNY is onshore (CNH is offshore) and CLF is Chile's Unidad de Fomento.

export type FxPair = {
  symbol: string;
  pair: string;
  name: string;
  ticker: string;
  base: string;
  quote: string;
};

// [English name, Spanish name] — both are searchable from the palette.
export const CURRENCIES: Record<string, [string, string]> = {
  USD: ["U.S. Dollar", "Dólar estadounidense"],
  EUR: ["Euro", "Euro"],
  GBP: ["British Pound", "Libra esterlina"],
  JPY: ["Japanese Yen", "Yen japonés"],
  CHF: ["Swiss Franc", "Franco suizo"],
  CAD: ["Canadian Dollar", "Dólar canadiense"],
  AUD: ["Australian Dollar", "Dólar australiano"],
  NZD: ["New Zealand Dollar", "Dólar neozelandés"],
  CNY: ["Chinese Yuan", "Yuan chino"],
  CNH: ["Chinese Yuan (offshore)", "Yuan chino (offshore)"],
  HKD: ["Hong Kong Dollar", "Dólar de Hong Kong"],
  SGD: ["Singapore Dollar", "Dólar de Singapur"],
  KRW: ["South Korean Won", "Won surcoreano"],
  TWD: ["Taiwan Dollar", "Dólar taiwanés"],
  INR: ["Indian Rupee", "Rupia india"],
  IDR: ["Indonesian Rupiah", "Rupia indonesia"],
  THB: ["Thai Baht", "Baht tailandés"],
  VND: ["Vietnamese Dong", "Dong vietnamita"],
  PHP: ["Philippine Peso", "Peso filipino"],
  MYR: ["Malaysian Ringgit", "Ringgit malayo"],
  BDT: ["Bangladeshi Taka", "Taka bangladesí"],
  PKR: ["Pakistani Rupee", "Rupia pakistaní"],
  TRY: ["Turkish Lira", "Lira turca"],
  ILS: ["Israeli Shekel", "Séquel israelí"],
  AED: ["UAE Dirham", "Dírham de EAU"],
  SAR: ["Saudi Riyal", "Riyal saudí"],
  ZAR: ["South African Rand", "Rand sudafricano"],
  EGP: ["Egyptian Pound", "Libra egipcia"],
  NGN: ["Nigerian Naira", "Naira nigeriano"],
  SEK: ["Swedish Krona", "Corona sueca"],
  NOK: ["Norwegian Krone", "Corona noruega"],
  DKK: ["Danish Krone", "Corona danesa"],
  PLN: ["Polish Zloty", "Esloti polaco"],
  CZK: ["Czech Koruna", "Corona checa"],
  HUF: ["Hungarian Forint", "Forinto húngaro"],
  RON: ["Romanian Leu", "Leu rumano"],
  CLP: ["Chilean Peso", "Peso chileno"],
  CLF: ["Unidad de Fomento (UF)", "Unidad de Fomento (UF)"],
  ARS: ["Argentine Peso", "Peso argentino"],
  BRL: ["Brazilian Real", "Real brasileño"],
  MXN: ["Mexican Peso", "Peso mexicano"],
  COP: ["Colombian Peso", "Peso colombiano"],
  PEN: ["Peruvian Sol", "Sol peruano"],
  UYU: ["Uruguayan Peso", "Peso uruguayo"],
  PYG: ["Paraguayan Guarani", "Guaraní paraguayo"],
  BOB: ["Bolivian Boliviano", "Boliviano"],
  VES: ["Venezuelan Bolívar", "Bolívar venezolano"],
  CRC: ["Costa Rican Colón", "Colón costarricense"],
  GTQ: ["Guatemalan Quetzal", "Quetzal guatemalteco"],
  DOP: ["Dominican Peso", "Peso dominicano"],
};

/** The board shown by a fresh FX widget. */
export const DEFAULT_FX_SYMBOLS = [
  "USDCLP=X", "EURCLP=X", "EURUSD=X", "USDCNY=X", "USDCNH=X",
  "USDMXN=X", "USDCOP=X", "USDPEN=X", "USDARS=X",
];

const TICKER_OVERRIDES: Record<string, string> = { EURUSD: "FX:EURUSD" };

function makePair(base: string, quote: string): FxPair {
  const code = base + quote;
  return {
    symbol: `${code}=X`,
    pair: `${base}/${quote}`,
    name: `${CURRENCIES[base][0]} / ${CURRENCIES[quote][0]}`,
    ticker: TICKER_OVERRIDES[code] ?? `FX_IDC:${code}`,
    base,
    quote,
  };
}

function pairFromCode(code: string): FxPair | undefined {
  const base = code.slice(0, 3);
  const quote = code.slice(3, 6);
  if (code.length !== 6 || base === quote || !CURRENCIES[base] || !CURRENCIES[quote]) return undefined;
  return makePair(base, quote);
}

/**
 * The FX pair behind a "USDCLP=X"-style symbol, if any. The "=X" suffix is
 * required: a bare six-letter symbol stays a stock ticker everywhere else.
 */
export function fxPairFor(symbol: string): FxPair | undefined {
  const m = /^([A-Z]{6})=X$/.exec(symbol.trim().toUpperCase());
  return m ? pairFromCode(m[1]) : undefined;
}

/** Number of decimals that reads naturally for a rate of this size. */
export function fxDigits(price: number | null): number {
  if (price === null) return 4;
  const abs = Math.abs(price);
  return abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

// Market convention for which side is the base: EUR/x, GBP/USD, AUD/USD,
// NZD/USD, then USD/x for everything else.
const BASE_PRIORITY = ["EUR", "GBP", "AUD", "NZD", "USD"];

function conventional(a: string, b: string): FxPair {
  const ia = BASE_PRIORITY.indexOf(a);
  const ib = BASE_PRIORITY.indexOf(b);
  if (ia === -1 && ib === -1) return makePair(a, b);
  if (ia === -1) return makePair(b, a);
  if (ib === -1) return makePair(a, b);
  return ia < ib ? makePair(a, b) : makePair(b, a);
}

/** Likely pairs for a single currency: against USD and EUR, and in CLP. */
function pairsFor(ccy: string): FxPair[] {
  // The UF is quoted in pesos — that's the pair anyone looking it up wants.
  if (ccy === "CLF") return [makePair("CLF", "CLP"), makePair("USD", "CLF")];
  if (ccy === "USD") return DEFAULT_FX_SYMBOLS.map((s) => fxPairFor(s)!).filter((p) => p.base === "USD" || p.quote === "USD");
  const out: FxPair[] = [];
  out.push(conventional("USD", ccy));
  if (ccy !== "EUR") out.push(conventional("EUR", ccy));
  if (ccy !== "CLP") out.push(makePair(ccy, "CLP"));
  return out;
}

/**
 * Palette matches for free text: a pair in any spelling ("usd/clp",
 * "USDCLP", "usd clp"), a single currency code ("brl") or name in English
 * or Spanish ("real", "peso chileno", "yen").
 */
export function searchFx(query: string): Array<{ symbol: string; name: string; exchange: string; type: string }> {
  const q = fold(query.trim());
  // "UF" is how everyone in Chile names the Unidad de Fomento (ISO: CLF).
  const code = q.replace(/[^A-Z]/g, "") === "UF" ? "CLF" : q.replace(/[^A-Z]/g, "");
  if (code.length < 3) return [];
  const found: FxPair[] = [];

  const exact = pairFromCode(code);
  if (exact) found.push(exact);
  if (code.length === 3 && CURRENCIES[code]) found.push(...pairsFor(code));
  if (q.length >= 3 && !exact) {
    for (const [ccy, names] of Object.entries(CURRENCIES)) {
      if (names.some((n) => fold(n).includes(q)) && ccy !== code) found.push(...pairsFor(ccy));
    }
  }

  const seen = new Set<string>();
  return found
    .filter((p) => !seen.has(p.symbol) && seen.add(p.symbol))
    .slice(0, 8)
    .map((p) => ({ symbol: p.symbol, name: `${p.pair} — ${p.name}`, exchange: "FX", type: "forex" }));
}
