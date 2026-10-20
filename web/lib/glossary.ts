/**
 * Plain-English explanations behind the "LEARN" tooltips. Original text,
 * written for beginners. Educational only: entries explain what a number
 * measures and why people look at it, never what to buy or sell.
 * Accuracy matters here; changes should be reviewed by a human.
 */
export type GlossaryEntry = { title: string; what: string; why: string; tip?: string };

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // --- quote basics ---
  last: { title: "Last price", what: "The price of the most recent trade.", why: "It is what the stock is worth right now, as agreed by the last buyer and seller." },
  open: { title: "Open", what: "The price of the first trade when the market opened today (9:30 New York time for US stocks).", why: "Comparing the open with the current price shows how the day has gone so far." },
  high: { title: "Day high", what: "The highest price traded today.", why: "Together with the low it shows today's trading range." },
  low: { title: "Day low", what: "The lowest price traded today.", why: "Together with the high it shows today's trading range." },
  prevClose: { title: "Previous close", what: "The last price when the market closed on the previous trading day.", why: "The day's change and % change are measured from this number." },
  bid: { title: "Bid", what: "The highest price a buyer is currently willing to pay.", why: "If you sell immediately with a market order, you get roughly the bid.", tip: "Bid is always a little below ask; the gap is the spread." },
  ask: { title: "Ask", what: "The lowest price a seller is currently willing to accept.", why: "If you buy immediately with a market order, you pay roughly the ask." },
  spread: { title: "Bid-ask spread", what: "The difference between the ask and the bid.", why: "It is a hidden cost: buying at the ask and selling at the bid straight away loses the spread.", tip: "Large, heavily traded stocks usually have tiny spreads; small or illiquid ones can have wide spreads." },
  volume: { title: "Volume", what: "How many shares have traded today.", why: "High volume means many people are trading, so prices are usually more reliable and orders fill easily." },
  avgVolume: { title: "Average volume", what: "The typical number of shares traded per day over the last ~3 months.", why: "Today's volume far above average often means news or unusual interest." },
  shortVolume: { title: "Short volume %", what: "The share of today's reported volume that was sold short (sold by traders who borrowed the shares).", why: "A rough gauge of bearish trading activity. It includes routine market-maker activity, so read it with care." },
  marketCap: { title: "Market capitalization", what: "Share price × number of shares: the total market value of the company.", why: "It tells you how big a company is. 'Large cap' is roughly over $10 billion, 'small cap' under about $2 billion." },
  pe: { title: "P/E ratio", what: "Price ÷ earnings per share over the last 12 months. A P/E of 20 means investors pay $20 for each $1 of yearly profit.", why: "A common way to compare how expensive stocks are relative to their profits.", tip: "Compare within the same industry; fast-growing companies often have higher P/Es. A negative or missing P/E usually means the company had no profit." },
  eps: { title: "EPS (earnings per share)", what: "The company's profit over the last 12 months divided by its number of shares.", why: "It is the 'E' in P/E, and the number companies report each quarter." },
  dividendYield: { title: "Dividend yield", what: "Yearly dividends per share ÷ share price, as a percentage.", why: "It shows how much cash income the stock pays relative to its price. Many growth companies pay none." },
  week52High: { title: "52-week high", what: "The highest price in the last year.", why: "Shows where the current price sits within its yearly range." },
  week52Low: { title: "52-week low", what: "The lowest price in the last year.", why: "Shows where the current price sits within its yearly range." },
  beta: { title: "Beta", what: "How much a stock tends to move compared with the overall market. Beta 1 moves like the market; 1.5 tends to move 50% more; 0.5 about half as much.", why: "A quick measure of how bumpy a stock has been. It is based on the past and can change." },
  sharesOut: { title: "Shares outstanding", what: "The total number of shares the company has issued that investors hold.", why: "Used to compute market cap and EPS. A rising count means each share owns a smaller slice." },
  changePct: { title: "% change", what: "How much the price has moved since the previous close, as a percentage.", why: "Percentages let you compare moves across stocks with very different prices." },

  // --- orders & positions ---
  marketOrder: { title: "Market order", what: "Buy or sell immediately at the best price available.", why: "It fills right away, but you don't control the exact price: you pay the ask or receive the bid." },
  limitOrder: { title: "Limit order", what: "Buy or sell only at your price or better. A buy limit at $95 fills at $95 or less.", why: "You control the price, but the order may never fill if the market doesn't reach it." },
  stopOrder: { title: "Stop order", what: "Becomes a market order once the price reaches your stop. A sell stop below the current price is a 'stop-loss'.", why: "Used to limit losses automatically. In fast markets the fill can be worse than the stop price." },
  position: { title: "Position", what: "The shares you currently own of a stock.", why: "Your profit or loss depends on the size of the position and how far the price moves." },
  avgCost: { title: "Average cost", what: "The average price you paid per share, across all your buys of that stock.", why: "Your unrealized profit is the current price minus this, times your shares." },
  unrealized: { title: "Unrealized P&L", what: "Profit or loss on shares you still own, at today's price.", why: "It is 'on paper': it changes with the price until you sell." },
  realized: { title: "Realized P&L", what: "Profit or loss locked in by shares you have already sold.", why: "Unlike unrealized P&L, it no longer changes with the price." },
  equity: { title: "Account equity", what: "Cash plus the current market value of everything you own.", why: "It is your total account value; compare it with your starting cash to see how you are doing." },
  buyingPower: { title: "Buying power", what: "Cash you can still spend, after setting aside money for open buy orders.", why: "This simulator has no margin, so you can never spend more than you have." },
  paperTrading: { title: "Paper trading", what: "Practising with simulated money and real live prices.", why: "You learn how orders, spreads and risk feel without risking real money.", tip: "Real trading adds things this simulator leaves out: fees, taxes, partial fills and emotions." },

  // --- charts & indicators ---
  candlestick: { title: "Candlestick", what: "One bar showing a period's open, high, low and close. The thick body spans open to close; thin wicks reach the high and low.", why: "Green (close above open) means the price rose during the period, red means it fell." },
  sma: { title: "Simple moving average (SMA)", what: "The average closing price over the last N periods, e.g. SMA50 = last 50 days.", why: "Smooths out noise to show the trend. Price above a rising SMA suggests an uptrend.", tip: "Longer averages (200) react slowly; shorter ones (20) react fast but are noisier." },
  ema: { title: "Exponential moving average (EMA)", what: "A moving average that gives more weight to recent prices.", why: "It reacts to new moves faster than an SMA of the same length." },
  vwap: { title: "VWAP", what: "Volume-weighted average price: the average price paid per share, weighted by how much traded at each price.", why: "Widely used as an intraday benchmark of a 'fair' average price." },
  boll: { title: "Bollinger Bands", what: "A moving average with bands two standard deviations above and below it.", why: "The bands widen when the price is volatile and narrow when it is calm. Touching a band is not by itself a signal." },
  rsi: { title: "RSI (Relative Strength Index)", what: "A 0–100 gauge of how strong recent gains were compared with recent losses (usually over 14 periods).", why: "Above 70 is often called 'overbought' and below 30 'oversold'.", tip: "Strong trends can stay overbought or oversold for a long time; RSI alone is not a buy or sell signal." },
  macd: { title: "MACD", what: "The difference between a fast and a slow EMA (12 and 26), plus a 'signal' line (9-period EMA of MACD).", why: "Used to gauge momentum: MACD crossing its signal line is a commonly watched event." },

  // --- options ---
  call: { title: "Call option", what: "The right, not the obligation, to buy 100 shares at the strike price until expiry.", why: "Calls gain value when the stock rises. The most a buyer can lose is the price paid." },
  put: { title: "Put option", what: "The right, not the obligation, to sell 100 shares at the strike price until expiry.", why: "Puts gain value when the stock falls; they are often used as insurance." },
  strike: { title: "Strike price", what: "The price at which the option lets you buy (call) or sell (put) the shares.", why: "Where the strike sits relative to the stock price drives most of an option's value." },
  expiry: { title: "Expiration", what: "The last day the option can be used. After it, the option is worthless unless exercised.", why: "Options lose time value as expiry approaches (see Theta)." },
  itm: { title: "In the money (ITM)", what: "A call whose strike is below the stock price, or a put whose strike is above it.", why: "ITM options have real (intrinsic) value; shaded rows in the chain are ITM." },
  openInterest: { title: "Open interest", what: "How many option contracts are currently open for this strike and expiry.", why: "Higher open interest usually means easier trading and tighter spreads." },
  iv: { title: "Implied volatility (IV)", what: "The yearly price swing the market is pricing into the option, backed out of its price. IV 30% roughly means a ±30% one-year move is 'one standard deviation'.", why: "High IV makes options expensive; it often rises before events like earnings." },
  delta: { title: "Delta (Δ)", what: "How much the option price moves when the stock moves $1. A delta of 0.50 gains about $0.50.", why: "Also a rough estimate of the chance the option expires in the money. Calls 0 to 1, puts 0 to −1." },
  gamma: { title: "Gamma (Γ)", what: "How much delta changes when the stock moves $1.", why: "High gamma (near the strike, close to expiry) means the option's sensitivity changes very quickly." },
  theta: { title: "Theta (Θ)", what: "How much value the option loses per day from time passing alone. Shown here per calendar day.", why: "Option buyers lose theta every day; it speeds up close to expiry." },
  vega: { title: "Vega", what: "How much the option price changes when implied volatility moves 1 percentage point.", why: "Shows how exposed the option is to changes in expected volatility." },

  // --- market-wide ---
  relativeStrength: { title: "Relative strength (vs SPY)", what: "A sector's return minus the S&P 500's (SPY) return over the same period, in percentage points.", why: "Positive means the sector beat the market; it shows where money has been flowing." },
  vix: { title: "VIX", what: "The market's expected volatility of the S&P 500 over the next 30 days, derived from option prices.", why: "Often called the 'fear gauge': it tends to jump when stocks fall sharply." },
  yieldCurve: { title: "Yield curve", what: "US Treasury interest rates across maturities, from 3 months to 30 years.", why: "It usually slopes upward. When short rates are above long rates ('inverted'), many read it as a recession warning." },
  replay: { title: "Chart replay", what: "Trade a real past chart one candle at a time, without seeing what comes next.", why: "Practises decisions without hindsight: the stock and dates stay hidden until the end." },
  buyHold: { title: "Buy and hold", what: "Buying at the start and doing nothing until the end.", why: "The standard benchmark: active trading only 'worked' if it beat this." },
};

/** UI labels -> glossary keys. Lookups also try the lower-cased label itself. */
const ALIASES: Record<string, string> = {
  "prev close": "prevClose", "avg vol 3m": "avgVolume", "short vol %": "shortVolume", "mkt cap": "marketCap",
  "p/e (ttm)": "pe", "p/e": "pe", "eps (ttm)": "eps", "div yield": "dividendYield", "52w high": "week52High",
  "52w low": "week52Low", "shares out": "sharesOut", "chg%": "changePct", "vol": "volume", "oi · iv": "openInterest",
  "oi": "openInterest", "δ": "delta", "γ": "gamma", "θ/day": "theta", "θ": "theta", "sma20": "sma", "sma50": "sma",
  "sma200": "sma", "ema20": "ema", "calls": "call", "puts": "put", "market": "marketOrder", "limit": "limitOrder",
  "stop": "stopOrder", "avg cost": "avgCost", "unrealized": "unrealized", "realized": "realized", "equity": "equity",
  "buying power": "buyingPower", "simulated": "paperTrading", "expiry": "expiry", "strike": "strike", "qty": "position",
};

export function lookup(termOrLabel: string): GlossaryEntry | null {
  const k = termOrLabel.trim();
  return GLOSSARY[k] ?? GLOSSARY[ALIASES[k.toLowerCase()] ?? ""] ?? GLOSSARY[k.toLowerCase()] ?? null;
}
