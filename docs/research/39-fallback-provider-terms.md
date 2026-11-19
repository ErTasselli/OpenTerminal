# Fallback provider terms spike (issue #39)

The quote/history fallback chain (Nasdaq → Stooq → Yahoo) is down to Yahoo too often since Nasdaq/Stooq started 403ing, and the news fallback is all RSS scraping. This spike firsthand-verifies the current free-tier terms of 8 candidate replacement/supplement providers, straight from each provider's own docs, so the next integration decision isn't made on stale roundup-article numbers.

All numbers below were pulled directly from the cited official URL in this session (2026-11-19). Quoted text is verbatim from the source.

## Quotes / history candidates

### Finnhub
- **Free-tier limit**: official docs state a flat **"30 API calls/ second"** global cap that applies "on top of all plan's limit" (exceeding it returns HTTP 429). No separate free-tier-specific per-minute or per-day cap appears anywhere in the fetched docs content — the "60 calls/minute" figure some roundups cite for Finnhub's free tier does **not** appear in the official docs and could not be verified firsthand.
- **Key required**: yes — "All GET request require a token parameter `token=apiKey`... or a header `X-Finnhub-Token`."
- **Quote/candle access on free tier**: `/quote` is `"premium": null` (free-tier accessible, flagged `"highUsage": "High Usage"`); `/stock/candle` is `"premium": null` with no high-usage flag.
- **Reliability signal**: none stated.
- **Source**: https://finnhub.io/docs/api (the public pricing page, https://finnhub.io/pricing, renders client-side only and had no text content to verify against).

### Finnhub — news endpoint
- **Free-tier limit**: same global 30 calls/sec cap; no separate documented limit for news endpoints specifically.
- **Key required**: same token as above.
- **Endpoint access**: `/company-news` is `"premium": null`, with `"freeTier": "1 year of historical news and new updates"`, flagged `"highUsage": "High Usage"`. `/market-news` is also `"premium": null`.
- **Reliability signal**: none stated.
- **Source**: https://finnhub.io/docs/api (same page, same embedded API reference).

### Twelve Data
- **Free-tier limit**: **8 API credits/minute**, **800 requests/day** — "Only the free Basic plan has a daily API limit of 800."
- **Key required**: yes (Authentication section covers API keys; free Basic plan still requires signup for a key).
- **Reliability signal**: explicitly **"No"** SLA on the Basic/free plan. (Only the Ultra paid plan carries a stated 99.95% uptime SLA — the lack of an SLA on free is stated, not just absent.)
- **Source**: https://twelvedata.com/pricing

### Financial Modeling Prep (FMP) — could not verify firsthand
- **Could not reach**: the entire `site.financialmodelingprep.com` domain returned HTTP 403 on root, `/developer/docs`, and `/developer/docs/pricing` across multiple fetch attempts (direct WebFetch and a plain `curl`), consistent with an anti-bot block on the whole docs/pricing site, not just one page. The legacy `financialmodelingprep.com/developer/docs/pricing` URL 301-redirects back into the same blocked domain.
- **Fallback used**: none trustworthy — did not fall back to a third-party roundup for the exact number, per the "don't invent signal" instruction. The commonly-repeated community figure (≈250 requests/day on the free plan) is **not verified** in this session and should not be treated as confirmed.
- **Recommendation implication**: FMP's terms are an open question — resolve with a logged-in account check or a non-bot-blocked channel before considering it for integration.

## Alpha Vantage resolution (the key one)

- **Verified free-tier limit**: **25 API requests per day**, flat — no per-minute limit is stated at all for the free tier.
- **Exact quotes**:
  - Support FAQ: *"Are there usage/frequency limits for the API service?"* → the free service covers **"25 API requests per day"**, with **"unlimited API requests for verified open-source or educational projects."**
  - Premium page: *"For use cases that exceed our standard API usage limit (25 API requests per day) or require certain premium API functions, we offer a premium plan."*
- **Resolution**: the ~25/day figure is correct and current, straight from Alpha Vantage's own two official pages. The "60 calls/minute" figure some secondhand sources cite **does not appear anywhere on either official page** and is not Alpha Vantage's current documented free-tier term — likely stale, conflated with a premium tier, or simply wrong.
- **Sources**: https://www.alphavantage.co/support/ and https://www.alphavantage.co/premium/

## Crypto candidates

### Kraken public API
- **Free-tier limit**: no numeric hard cap published for public (non-authenticated) endpoints. Official guidance: calling public endpoints **"at a frequency of 1 per second (or less) would remain within the rate limits,"** and exceeding that risks being rate-limited for "a few seconds, possibly longer if requests continue." Trades/OHLC are limited per IP *and* currency pair; all other public endpoints are limited per IP only.
- **Key required**: not explicitly stated as "no," but strongly implied — the same doc says private endpoints are limited "by API key" while public endpoints are limited by IP address, i.e. public market data isn't keyed.
- **Reliability signal**: none stated beyond the rate-limit guidance itself.
- **Source**: https://support.kraken.com/hc/en-us/articles/206548367 (official Kraken support domain; `docs.kraken.com/api/docs/rest-api/` itself 403'd on every path tried — anti-bot block on that subdomain specifically).

### CoinCap
- **Current state: the old free, keyless API is dead.** `api.coincap.io` (the legacy v2 keyless endpoint) no longer resolves in DNS at all (`curl`: "Could not resolve host").
- `coincap.io`'s own homepage now promotes **"CoinCap PRO"** tied to a points/staking scheme ("Earn CoinCap Points, Stake MOR for up to 20% APR"), and `docs.coincap.io` permanently 301-redirects to `pro.coincap.io/api-docs` — a login-gated API-key-manager app shell that couldn't be rendered without an account, so the exact current rate limit and whether any tier is still free could not be confirmed.
- **Key required**: yes, under the new PRO product (the old keyless model is gone).
- **Reliability signal**: none stated; the ownership/product pivot itself (free API → points/token-gated PRO portal) is a reliability red flag worth noting on its own.
- **Source**: https://coincap.io, https://docs.coincap.io (redirect target), https://pro.coincap.io/api-docs — firsthand-confirmed that the free/keyless model is gone; exact current limits not independently verifiable without creating an account.

## News candidate

### StockTwits public API
- **Current state: self-serve public API access is gone.** The official developers page (https://stocktwits.com/developers) lists API access only under an **"Enterprise Plan"** with a **"Get in Touch"** contact-sales flow — no self-serve signup, no published rate limit. The legacy docs URL (`api.stocktwits.com/developers/docs`) returns 404.
- **Key required**: effectively N/A for free use — there is no free self-serve tier to key into; access now requires a sales conversation.
- **Reliability signal**: none stated (no SLA info reachable without an enterprise engagement).
- **Source**: https://stocktwits.com/developers

## Recommendation

- **Quotes/history**: integrate **Finnhub** as the primary supplement. Its only documented cap is a global 30 calls/sec ceiling with no stated daily cap in its own docs, which fits this app's repeated-per-symbol-polling pattern far better than a flat daily quota would. Use **Twelve Data** as a secondary/backup source — its 8 credits/min (800/day) cap is real and will bind under heavy multi-symbol polling, but it's still workable as a second fallback behind Finnhub, and unlike Finnhub it states its lack-of-SLA explicitly so expectations are clear. **Do not integrate Alpha Vantage** for this use case: a flat 25 requests/day is catastrophic for an app that polls per-symbol repeatedly over time (a handful of symbol checks in one session can exhaust the entire day's quota), even though its historical breadth is good — the per-minute-vs-per-day distinction matters a lot here and Alpha Vantage loses on exactly that axis. **FMP is undecided** — its terms couldn't be firsthand-verified (full anti-bot block), so it shouldn't be adopted until that's resolved through another channel.
- **Crypto**: integrate **Kraken public endpoints** — keyless, no published hard cap (just a ~1 req/sec courtesy guideline), which is a good match for repeated polling and requires no signup/key management at all. **Do not currently pursue CoinCap** — the free keyless API is confirmed dead (DNS gone) and the replacement is a login-gated, points/token-tied product whose terms we can't even read without creating an account; the product pivot itself is a reliability concern independent of the numbers.
- **News**: integrate **Finnhub's `/company-news` and `/market-news`** as the first real alternative to RSS scraping — both are free-tier accessible (`premium: null`), `/company-news` explicitly includes "1 year of historical news," and they ride the same single global rate limit as the quote endpoints, so no separate budget to manage. **Do not pursue StockTwits** — its public API is confirmed enterprise-sales-only today, not a free/self-serve option at all.
