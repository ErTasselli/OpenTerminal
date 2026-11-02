<div align="center">

# OpenTerminal

**A Terminal‑style workspace for the rest of us — built entirely on free, public market data.**

Dark. Dense. Keyboard‑driven. Zero paid API keys, zero subscriptions.

[![Stack](https://img.shields.io/badge/stack-Next.js%20%2B%20Express%20%2B%20TypeScript-orange)](#tech-stack)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![No API Key Required](https://img.shields.io/badge/data-no%20API%20key%20required-brightgreen)](#data-sources)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg)](#contributing)

<a href="https://trendshift.io/repositories/215916?utm_source=trendshift-badge&utm_medium=badge&utm_campaign=badge-trendshift-215916" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/215916/daily?language=TypeScript" alt="ErTasselli%2FOpenTerminal | Trendshift" width="250" height="55"/></a>

<br/>

<img src="docs/screenshots/dashboard.png" alt="OpenTerminal dashboard — live chart, quote panel, watchlist, news and macro indexes" width="100%" />

<sub>⭐ If this is useful to you, consider starring the repo — it genuinely helps other people find it.</sub>

</div>

<br/>

## Why OpenTerminal?

Real trading terminals cost **$2,000+ a month**. Most retail dashboards either lock the good stuff behind a paywall or run on a single flaky data source that breaks the moment you actually need it.

OpenTerminal takes a different approach: it stitches together several **free, publicly documented (or reverse‑engineered but widely used) market data endpoints** — the same ones that power major finance sites' own front ends — into one fast, keyboard‑first, widget‑based dashboard that runs entirely on your machine. Every data endpoint has an automatic fallback chain, so a single provider hiccup never takes the whole app down.

No signup. No credit card. No rate‑limited demo tier. Clone it, `npm install`, and you have a live terminal in under a minute.

<br/>

## ✨ Features

- 🖥️ **Widget-based workspace** — drag, resize, add, and remove panels (`react-grid-layout`); your layout is saved locally and restored on reload
- ⌘K **global command palette** — instantly search stocks, ETFs, and crypto and jump straight to them
- 📈 **Professional charting** (via [`lightweight-charts`](https://github.com/tradingview/lightweight-charts)) — candlesticks, bars, line, area, volume, 8 timeframes (1D → MAX), and SMA / EMA / VWAP / Bollinger Bands / RSI / MACD indicators, each with a live hover legend showing OHLC, volume, and every active indicator's value under your cursor
- 💹 **Quote panel** — last / bid / ask / OHLC, volume, market cap, P/E, EPS, dividend yield, 52‑week range, beta, shares outstanding
- ⚡ **Optional Schwab real‑time feed** — bring your own Charles Schwab developer app to use real‑time quotes, price history, option chains, symbol search, movers, market hours, and streaming level‑one quotes; without it, the public providers below work exactly as before
- 📰 **News feed** — aggregated and de‑duplicated from multiple RSS sources, per‑symbol or global
- 🔎 **Full‑market screener** — filter by sector, market cap, % change, and volume across the entire US equity market, sortable on every column
- 🗺️ **Live sector heatmap** — treemap sized by market cap, colored by daily % change, refreshing every few seconds
- ⛓️ **Options chain** — calls and puts side‑by‑side with strike, bid/ask, volume, open interest, and ITM highlighting
- 🪙 **Crypto board** — top assets with 7‑day sparklines, BTC/ETH dominance, and full OHLCV charting for any listed coin
- 🏦 **Macro dashboard** — live US Treasury yield curve, VIX, and major index/commodity proxies
- 💼 **Portfolio tracker** — log buy/sell transactions, track average cost, realized & unrealized P&L (persisted in SQLite)
- 📅 **Calendar** — economic events (Fed, ECB, CPI, NFP and more) with consensus forecast, previous reading and, for the major US/EU releases, the actual outcome; plus a per‑watchlist earnings calendar with click‑through history showing forecast vs. actual EPS for the last several quarters and the stock's next‑day price move
- 🤖 **AI assistant** (optional) — ask questions about the symbol you're looking at, powered by Claude, fully context‑aware of the terminal's current data
- ⚡ **Near real‑time updates** — quotes and indexes refresh every second with a subtle flash on change, so you always know what just moved
- ⌨️ **Keyboard shortcuts** everywhere — `⌘K` to search, `⌥1`–`⌥9` to add any widget

<br/>

## 📸 A closer look

### Charting

Candlesticks, bars, line, or area — 8 timeframes, six technical indicators, and a live legend under your cursor showing OHLC, volume, and every active indicator's value for the candle you're pointing at.

<img src="docs/screenshots/chart.png" alt="Candlestick chart with SMA/RSI/MACD indicators and hover legend" width="100%" />

<br/>

### Live sector heatmap

The whole US equity market as a treemap — sized by market cap, colored by daily % change, refreshing every few seconds so nothing you're watching ever goes stale.

<img src="docs/screenshots/heatmap.png" alt="Live sector heatmap of the US equity market" width="100%" />

<br/>

### Crypto

Top assets with 7‑day sparklines and BTC/ETH dominance — click through to full OHLCV candlestick charting for any listed coin, same charting engine as stocks.

<img src="docs/screenshots/crypto.png" alt="Crypto board with sparklines and dominance" width="100%" />

<br/>

### News

Headlines aggregated and de‑duplicated across multiple sources, filterable per‑symbol or global, so you're never digging through five tabs to catch up.

<img src="docs/screenshots/news.png" alt="Per-symbol and global news feed, aggregated and de-duplicated" width="100%" />

<br/>

## 🗂️ Data sources

No paid API, no keys, and no single point of failure — every endpoint has a fallback chain, and results are cached with a stale‑on‑error fallback so a temporary outage never blanks out the UI. (An optional Schwab feed, described below, can use your own brokerage credentials.)

| Data | Primary source | Fallback |
|---|---|---|
| Quotes (stocks/ETFs) | Nasdaq public quote API | Yahoo Finance → Stooq |
| Fundamentals (P/E, EPS, beta, div yield) | TradingView scanner API | — |
| Historical candles | Nasdaq chart API | Yahoo Finance → Stooq |
| Symbol search | TradingView symbol search | Yahoo Finance |
| Full‑market screener / heatmap | TradingView scanner API (live, whole US market) | — |
| Options chain | Nasdaq option‑chain API | Yahoo Finance |
| News | Yahoo Finance RSS | Google News RSS |
| Crypto quotes & board | CoinGecko | Binance public API |
| Crypto candles | Binance public API (klines) | — |
| Macro (Treasury yields, VIX) | FRED (Federal Reserve) | — |
| Economic calendar (schedule, forecast, previous) | Forex Factory public feed | — |
| Economic calendar (actual — Fed / ECB / CPI / NFP only) | FRED (Federal Reserve) | — |
| Earnings calendar (next/last date, EPS estimate) | TradingView scanner API | — |
| Earnings history (forecast vs. actual, surprise %) | Nasdaq earnings‑surprise API | — |

> ⚠️ These are public endpoints, not officially licensed data feeds — treat prices as delayed/indicative, not execution‑grade. See [`server/src/providers/`](server/src/providers) — each provider is a small, isolated module, so swapping or adding a data source is a 30‑minute job.

### Optional: Schwab real-time data

If you already have a Charles Schwab brokerage account, you can point the terminal at Schwab's official Trader API for real-time market data instead of the public feeds. This is optional and entirely bring-your-own-credentials — the app still runs with no keys.

What it upgrades when configured:

| Data | Schwab endpoint | Existing fallback |
|---|---|---|
| Quotes + fundamentals | Market Data `/quotes` | Nasdaq → Yahoo → Stooq |
| Historical candles | Market Data `/pricehistory` | Nasdaq → Yahoo → Stooq |
| Option chains | Market Data `/chains` | Nasdaq → Yahoo |
| Symbol search | Market Data `/instruments` | TradingView → Yahoo |
| Movers / market hours | Market Data `/movers`, `/markets` | — |
| Streaming level-one quotes | Streamer `LEVELONE_EQUITIES` | 1-second REST polling |

Setup:

1. Create an app at [developer.schwab.com](https://developer.schwab.com), add the **Market Data** product (and **Accounts and Trading** if you want streaming), and set its callback URL to `https://127.0.0.1` (or your own `SCHWAB_REDIRECT_URI`). Wait until the app is approved/ready.
2. Export your app credentials and run the one-time OAuth helper:
   ```bash
   export SCHWAB_CLIENT_ID=...
   export SCHWAB_CLIENT_SECRET=...
   npm run schwab:auth -w server
   ```
   Open the printed URL, approve access, then paste the full URL you were redirected to back into:
   ```bash
   npm run schwab:auth -w server -- "https://127.0.0.1/?code=..."
   ```
3. The running API picks up the new token file on its next Schwab call (a restart is only needed if the process had cached an invalid token). Tokens are refreshed automatically; the rotating refresh token is stored in `data/.schwab-token.json` (gitignored, mode `0600`).

You can also do step 2 entirely from the in-app **Settings** page (`/settings`): click **Get authorization URL**, approve access, and paste the full callback URL into the form. The page also shows token/streaming status and offers a Disconnect button. The CLI remains available for headless setups.

Notes:

- Enable the **Market Data** product for quotes/history/options. The streamer also reads `/trader/v1/userPreference`, which comes from the **Accounts and Trading** product, so enable both if you want streaming.
- `SCHWAB_TOKEN_FILE` overrides the token path. `SCHWAB_REFRESH_TOKEN` / `SCHWAB_ACCESS_TOKEN` are bootstrap alternatives for environments where writing the token file is awkward; the refresh token is still rotated and persisted on first use.
- Real-time entitlement depends on your Schwab account/market-data agreement. Without it, Schwab itself may return delayed data.
- The app keeps the public fallback chain. If Schwab is not configured, is rate-limited, or lacks a symbol (non-US, crypto, VIX), requests continue through the existing providers.
- Use **Settings → Data source** to switch between `Schwab first (public fallback)` and `Public sources only`. The choice persists in `data/settings.json`.
- Full-market screener/heatmap, news, crypto, and macro/calendar data stay on their existing sources; Schwab's API does not expose a whole-market scan.
- Schwab's app-wide limit is 120 requests/minute; the server queues at 110/min.
- This integration covers market data and streaming only. It does **not** place, modify, or cancel orders.
- Docker: set `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, and optionally `SCHWAB_REFRESH_TOKEN` for the `api` service. To authorize inside the container, run `docker compose exec api node dist/scripts/schwab-auth.js`; the token persists in the `terminal-data` volume.

<br/>

## 🚀 Quick start

```bash
git clone https://github.com/ErTasselli/openterminal.git
cd openterminal
npm install
npm run dev
```

- Web UI → **http://localhost:3000**
- API health → **http://localhost:4000/api/status**

That's it — no `.env` file required to get a fully working terminal.

### Configuration

Optional integrations can be configured either through the in-app **Settings** page (`/settings`) or through a root `.env` file:

```bash
cp .env.example .env
# edit .env, then restart `npm run dev`
```

The root `.env` is loaded by both the API and the web app; Docker/shell environment variables take precedence. Most keys can also be changed at runtime from Settings without restarting: AI credentials/base URL/model, the Schwab OAuth callback, and the data-source toggle.

### Optional: AI assistant

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

You can also paste the key, base URL, and model into **Settings**. Without a key, everything else still works — the AI widget just shows a friendly "unavailable" message instead of failing.

The assistant uses read-only tools to pull live terminal data on demand: quotes, price history, option-chain summaries, news, SEC insider transactions, and macro snapshots. It can call these tools multiple times per question, but not arbitrary URLs, portfolio data, settings, or trading endpoints. Tool results are summarized and size-limited; the AI widget shows which tools were used under each reply.

If your API is not reachable at `127.0.0.1:<API_PORT>` from the API process itself (for example, a non-loopback `API_HOST`), set `AI_INTERNAL_API_URL` to the loopback base URL used for tool calls.

Two optional knobs for the assistant, both standard for the Anthropic SDK:

- `ANTHROPIC_BASE_URL` — point the assistant at an Anthropic-compatible endpoint (a self-hosted gateway, an EU-hosted relay, etc.) instead of api.anthropic.com.
- `ANTHROPIC_MODEL` — override the model sent in requests (default: `claude-opus-4-8`). Required when the endpoint behind `ANTHROPIC_BASE_URL` serves models under different ids.

Values saved in Settings override `.env`; clearing a saved value falls back to the corresponding `ANTHROPIC_*` variable.

### Security defaults

- The API binds to `127.0.0.1` and only accepts browser requests from `http://localhost:3000` by default — nothing else on your network can reach it out of the box.
- The portfolio, AI, Schwab-specific, and streaming endpoints require a shared secret. If you don't set `API_KEY` yourself, the API generates one on first run and saves it to `data/.api-key`; the bundled web app reads that file automatically, so local dev stays zero-config.
- Optional Schwab OAuth tokens live in `data/.schwab-token.json` (mode `0600`, gitignored). Runtime settings — including an AI key saved from the Settings page — live in `data/settings.json` (mode `0600`, gitignored). Both are used only by the API process; the browser only ever reaches the server-side proxy.
- To expose this beyond your own machine, set `API_HOST=0.0.0.0`, `API_KEY=<a-strong-secret>` (on both the api and web processes), and `WEB_ORIGIN=<your actual origin>` explicitly. Don't do this without also keeping dependencies patched — see [Known limitations](#known-limitations) below.
- The `/api/ai` rate limit (10 req/min) keys on `req.ip`. Calls made through the bundled web proxy all arrive from that proxy's own address, so by default every caller sharing it shares one bucket. If you're serving more than one real user through it, set `TRUST_PROXY=1` on the api process **only if** you also run your own reverse proxy in front of the web service that sets `X-Forwarded-For` from the real client and doesn't let visitors set it themselves — otherwise a caller can forge that header to dodge the limit.

<br/>

## 🐳 Docker

```bash
docker compose up --build
```

Portfolio data, Schwab tokens, and runtime settings persist in the `terminal-data` volume (SQLite, WAL mode). Docker Compose forwards the optional `SCHWAB_*` and `ANTHROPIC_*` variables from your shell/`.env`; ports are published on `127.0.0.1` only by default. See [Security defaults](#security-defaults) to expose it deliberately.

<br/>

## 🧱 Tech stack

| Layer | Stack |
|---|---|
| Frontend | Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 · Zustand · TanStack Query |
| Charts | `lightweight-charts` (candles/indicators) · D3 (heatmap treemap) · Recharts (yield curve) |
| Backend | Node.js · Express · TypeScript |
| Database | SQLite (`better-sqlite3`, WAL mode) |
| AI | Anthropic Claude (optional) |

<br/>

## 📁 Project structure

```
├── server/                  # Express + TypeScript API
│   └── src/
│       ├── providers/       # schwab, nasdaq, tradingview, yahoo, stooq, fred, econcalendar, coingecko, binance, news
│       ├── routes/          # market, portfolio, ai, schwab, stream (SSE)
│       ├── cache.ts         # TTL cache with stale-on-error fallback
│       └── db.ts            # SQLite (better-sqlite3, WAL)
└── web/                      # Next.js 15 + React 19 + Tailwind 4
    ├── components/           # TopBar, Sidebar, Workspace, CommandPalette
    ├── components/widgets/   # Chart, Quote, Watchlist, News, Screener, Heatmap, Crypto, Options, Macro, Portfolio, Calendar, AI
    ├── lib/                  # API client, technical indicators
    └── store/                # Zustand store (workspace layout, persisted)
```

Run tests with `npm test` (Vitest, no network calls). CI runs on every push — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

<br/>

## 🗺️ Roadmap

- [ ] Chart drawing tools & multi‑asset comparison overlay
- [ ] Black‑Scholes Greeks on the options chain
- [ ] Price alerts with desktop notifications
- [ ] PostgreSQL as an alternative to SQLite

Have an idea? [Open an issue](../../issues) — contributions are very welcome.

<br/>

## 🤝 Contributing

Pull requests are welcome, especially:
- New or more resilient data providers (`server/src/providers/`)
- New widgets (`web/components/widgets/`)
- Bug fixes and UI polish

Please open an issue first for anything non‑trivial so we can align on approach before you invest the time.

<br/>

## Known limitations

- Schwab access is optional and depends on your own developer app, brokerage account, and market-data entitlements. The integration is read-only (market data and streaming); order placement is not implemented. Re-authorize with `npm run schwab:auth -w server` if the 7-day refresh token expires or is revoked.
- `npm audit` still flags two dependency advisories this project doesn't force-fix: `fast-xml-parser`'s XMLBuilder injection (moderate) doesn't apply here — only `XMLParser` is used, never `XMLBuilder` — and `postcss`'s high-severity issue is bundled inside Next.js itself, only resolved by a Next 16 major upgrade. Both are tracked, neither is silently ignored.
- If you deploy behind a reverse proxy or load balancer, set `API_HOST`/`WEB_ORIGIN` to match, and terminate TLS in front of it — this project doesn't handle HTTPS itself.

<br/>

## ⚖️ Disclaimer

For personal and educational use only. Market data comes from public endpoints and may be delayed, incomplete, or occasionally wrong — **do not use this for real investment decisions**.

This project is not affiliated with, endorsed by, or sponsored by any of the data providers it connects to. It does not host or redistribute data to third parties — it's source code you run yourself, fetching data directly from the provider. Respect the terms of service of the underlying data providers; most free sources are licensed for personal/research use only and prohibit commercial redistribution.

## License

[MIT](LICENSE)

<br/>

<div align="center">

**star the repo** ⭐ — it's the best way to support the project.

</div>
