// Economic calendar — schedule, consensus forecast and previous reading come from
// Forex Factory's free public JSON feed (no key, no signup). That feed never carries
// the released "actual" value, so for a curated set of the highest-visibility
// releases (central bank rates, CPI, unemployment, NFP) we backfill "actual" from
// FXMacroData, which carries the official print with its announcement time, and fall
// back to FRED for the US/EU releases it mirrors, usually within a day or two.
import * as fred from "./fred.js";
import * as fxmd from "./fxmacrodata.js";

export type EconEvent = {
  title: string;
  country: string;
  date: string; // ISO
  impact: "Low" | "Medium" | "High" | "Holiday";
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

type FFRaw = { title: string; country: string; date: string; impact: string; forecast: string; previous: string };

async function fetchWeek(which: "thisweek" | "nextweek"): Promise<FFRaw[]> {
  const res = await fetch(`https://nfs.faireconomy.media/ff_calendar_${which}.json`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`forexfactory ${res.status} for ${which}`);
  return res.json();
}

type Matcher = {
  test: (title: string, country: string) => boolean;
  seriesId: string;
  kind: "level" | "mom_pct" | "yoy_pct" | "change";
  // "rate" series (Fed/ECB decisions) update same-day and are checked against the
  // event date directly. "monthly" series (CPI, payrolls, unemployment) always carry
  // a period-end date one month behind their release date by construction — freshness
  // has to be judged against the *reference period*, not the release date itself.
  cadence: "rate" | "monthly";
};

// Fed / ECB / CPI / NFP only — the handful of releases people actually watch a
// terminal for. Anything else just shows forecast/previous like a normal calendar.
const FRED_MATCHERS: Matcher[] = [
  { test: (t, c) => c === "USD" && /federal funds rate/i.test(t), seriesId: "DFEDTARU", kind: "level", cadence: "rate" },
  { test: (t, c) => c === "EUR" && /main refinancing rate/i.test(t), seriesId: "ECBMRRFR", kind: "level", cadence: "rate" },
  { test: (t, c) => c === "EUR" && /deposit facility rate/i.test(t), seriesId: "ECBDFR", kind: "level", cadence: "rate" },
  { test: (t, c) => c === "USD" && /non-?farm employment change/i.test(t), seriesId: "PAYEMS", kind: "change", cadence: "monthly" },
  { test: (t, c) => c === "USD" && /^unemployment rate$/i.test(t), seriesId: "UNRATE", kind: "level", cadence: "monthly" },
  { test: (t, c) => c === "USD" && /^core cpi y\/y$/i.test(t), seriesId: "CPILFESL", kind: "yoy_pct", cadence: "monthly" },
  { test: (t, c) => c === "USD" && /^core cpi m\/m$/i.test(t), seriesId: "CPILFESL", kind: "mom_pct", cadence: "monthly" },
  { test: (t, c) => c === "USD" && /^cpi y\/y$/i.test(t), seriesId: "CPIAUCSL", kind: "yoy_pct", cadence: "monthly" },
  { test: (t, c) => c === "USD" && /^cpi m\/m$/i.test(t), seriesId: "CPIAUCSL", kind: "mom_pct", cadence: "monthly" },
];

// Forex Factory title -> FXMacroData indicator. Each match is only trusted when the
// release FXMacroData has on file was announced within RELEASE_WINDOW_MS of the event,
// so last month's print never shows up as this month's actual, and when its unit is
// the one the event reports (a "y/y" event never picks up a level or an m/m series).
type FxmdMatcher = {
  test: (title: string, country: string) => boolean;
  indicator: string;
  unit: string;
  kind: "rate" | "pct" | "thousands" | "payrolls";
};

const FXMD_MATCHERS: FxmdMatcher[] = [
  { test: (t, c) => c === "USD" && /^federal funds rate$/i.test(t), indicator: "policy_rate", unit: "%", kind: "rate" },
  { test: (t, c) => c === "EUR" && /^main refinancing rate$/i.test(t), indicator: "policy_rate_mro", unit: "%", kind: "rate" },
  { test: (t, c) => c === "EUR" && /^deposit facility rate$/i.test(t), indicator: "policy_rate", unit: "%", kind: "rate" },
  { test: (t, c) => c === "GBP" && /^official bank rate$/i.test(t), indicator: "policy_rate", unit: "%", kind: "rate" },
  { test: (t, c) => c === "JPY" && /^boj policy rate$/i.test(t), indicator: "policy_rate", unit: "%", kind: "rate" },
  { test: (t, c) => c === "AUD" && /^cash rate$/i.test(t), indicator: "policy_rate", unit: "%", kind: "rate" },
  { test: (t, c) => c === "NZD" && /^official cash rate$/i.test(t), indicator: "policy_rate", unit: "%", kind: "rate" },
  { test: (t, c) => c === "CAD" && /^overnight rate$/i.test(t), indicator: "policy_rate", unit: "%", kind: "rate" },
  { test: (t, c) => c === "CHF" && /^snb policy rate$/i.test(t), indicator: "policy_rate", unit: "%", kind: "rate" },
  { test: (t) => /^(final |flash )?cpi( flash estimate)? y\/y$/i.test(t), indicator: "inflation", unit: "%YoY", kind: "pct" },
  { test: (t, c) => c === "USD" && /^cpi m\/m$/i.test(t), indicator: "inflation_mom", unit: "%MoM", kind: "pct" },
  { test: (t, c) => c === "USD" && /^core cpi y\/y$/i.test(t), indicator: "core_inflation", unit: "%YoY", kind: "pct" },
  { test: (t, c) => c === "USD" && /^core cpi m\/m$/i.test(t), indicator: "core_inflation_mom", unit: "%MoM", kind: "pct" },
  {
    test: (t, c) => ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD"].includes(c) && /^unemployment rate$/i.test(t),
    indicator: "unemployment",
    unit: "%",
    kind: "pct",
  },
  { test: (t, c) => c === "USD" && /^non-?farm employment change$/i.test(t), indicator: "non_farm_payrolls", unit: "Persons", kind: "payrolls" },
  { test: (t, c) => c === "USD" && /^unemployment claims$/i.test(t), indicator: "initial_jobless_claims", unit: "Persons", kind: "thousands" },
];

// Forex Factory times are scheduled times; a release can land a little early or late,
// and some publishers only give a date. A day either side still rules out the previous
// monthly print, which is weeks away.
const RELEASE_WINDOW_MS = 36 * 3_600_000;

function fxmdMatcher(title: string, country: string): FxmdMatcher | undefined {
  return FXMD_MATCHERS.find((m) => m.test(title, country));
}

export function fxmdActual(
  title: string,
  country: string,
  eventDate: Date,
  releases: Map<string, fxmd.Release> | undefined
): string | null {
  const matcher = fxmdMatcher(title, country);
  const release = matcher && releases?.get(matcher.indicator);
  if (!matcher || !release || release.unit !== matcher.unit) return null;
  if (Math.abs(release.announcedAt - eventDate.getTime()) > RELEASE_WINDOW_MS) return null;

  if (matcher.kind === "rate") return `${release.value.toFixed(2)}%`;
  if (matcher.kind === "pct") return `${release.value.toFixed(1)}%`;
  if (matcher.kind === "thousands") return `${Math.round(release.value / 1000)}K`;
  // Payrolls are published as a level (persons); the calendar shows the monthly change.
  return release.previous === null ? null : `${Math.round((release.value - release.previous) / 1000)}K`;
}

/** One FXMacroData call per currency that has a matched release already behind us. */
async function fxmdReleases(raw: FFRaw[]): Promise<Map<string, Map<string, fxmd.Release>>> {
  const now = Date.now();
  const currencies = new Set(
    raw
      .filter((e) => new Date(e.date).getTime() <= now && fxmdMatcher(e.title, e.country) && fxmd.supports(e.country))
      .map((e) => e.country)
  );
  const out = new Map<string, Map<string, fxmd.Release>>();
  await Promise.all(
    [...currencies].map(async (c) => {
      try {
        out.set(c, await fxmd.latestReleases(c));
      } catch {
        // No actuals from FXMacroData for this currency on this refresh; FRED still runs.
      }
    })
  );
  return out;
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

async function actualFor(title: string, country: string, eventDate: Date): Promise<string | null> {
  if (eventDate.getTime() > Date.now()) return null;
  const matcher = FRED_MATCHERS.find((m) => m.test(title, country));
  if (!matcher) return null;
  try {
    const points = await fred.series(matcher.seriesId, 24);
    if (points.length === 0) return null;
    const last = points[points.length - 1];
    const lastDate = new Date(last.date);

    if (matcher.cadence === "rate") {
      // Daily series carried forward every business day — fresh once it's caught
      // up to (or past) the decision date itself.
      if (lastDate.getTime() < eventDate.getTime() - 3 * 86_400_000) return null;
    } else {
      // Monthly releases report on the month *before* the release: a report dated
      // this month covers last month's data. Only trust it once FRED's own period
      // matches that reference month — otherwise it's still an older reading.
      const referencePeriod = new Date(Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth() - 1, 1));
      if (!sameMonth(lastDate, referencePeriod)) return null;
    }

    if (matcher.kind === "level") return `${last.value.toFixed(2)}%`;
    if (matcher.kind === "change") {
      const prev = points[points.length - 2];
      return prev ? `${Math.round(last.value - prev.value)}K` : null;
    }
    const prev = points[points.length - 2];
    if (matcher.kind === "mom_pct") return prev ? `${(((last.value - prev.value) / prev.value) * 100).toFixed(1)}%` : null;
    // yoy_pct: walk back to the point ~12 months before the latest one
    const yearAgo = [...points].reverse().find((p) => lastDate.getTime() - new Date(p.date).getTime() >= 360 * 86_400_000);
    return yearAgo ? `${(((last.value - yearAgo.value) / yearAgo.value) * 100).toFixed(1)}%` : null;
  } catch {
    return null;
  }
}

export async function weeklyEvents(): Promise<EconEvent[]> {
  // Forex Factory's export only exists as a "this week" snapshot (Mon–Sun) — there's
  // no "next week" file to extend the window with.
  const raw = await fetchWeek("thisweek");
  const releases = await fxmdReleases(raw);

  const events = await Promise.all(
    raw.map(async (e): Promise<EconEvent> => {
      const date = new Date(e.date);
      return {
        title: e.title,
        country: e.country,
        date: date.toISOString(),
        impact: (e.impact as EconEvent["impact"]) ?? "Low",
        forecast: e.forecast || null,
        previous: e.previous || null,
        actual:
          (date.getTime() <= Date.now() ? fxmdActual(e.title, e.country, date, releases.get(e.country)) : null) ??
          (await actualFor(e.title, e.country, date)),
      };
    })
  );

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}
