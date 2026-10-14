// Chile's "dólar observado" — the official USD/CLP reference rate published
// daily by the Banco Central de Chile (the rate contracts, invoices and
// accounting use, as opposed to the live interbank spot quote).
//
// Two free, keyless mirrors of the central bank's data:
//   - mindicador.cl: latest value plus the last ~30 published days (primary).
//   - api.boostr.cl: latest value only (fallback when mindicador is down).

// mindicador has been seen hanging for 20s+ (or resetting connections) —
// fail fast so the fallback and the rest of /api/fx are not held hostage.
const TIMEOUT_MS = 6_000;

export type ObservadoPoint = { date: string; value: number };
export type Observado = { date: string; value: number; source: string; series: ObservadoPoint[] };

function isoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export async function fromMindicador(): Promise<Observado> {
  const res = await fetch("https://mindicador.cl/api/dolar", { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`mindicador ${res.status}`);
  const json = await res.json();
  const series: ObservadoPoint[] = (Array.isArray(json?.serie) ? json.serie : [])
    .map((p: any) => ({ date: isoDate(p?.fecha), value: Number(p?.valor) }))
    .filter((p: { date: string | null; value: number }) => p.date && isFinite(p.value) && p.value > 0)
    .sort((a: ObservadoPoint, b: ObservadoPoint) => a.date.localeCompare(b.date));
  const last = series[series.length - 1];
  if (!last) throw new Error("mindicador: empty series");
  return { date: last.date, value: last.value, source: "mindicador.cl", series };
}

export async function fromBoostr(): Promise<Observado> {
  const res = await fetch("https://api.boostr.cl/economy/indicator/dolar.json", { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`boostr ${res.status}`);
  const json = await res.json();
  const date = isoDate(json?.data?.date);
  const value = Number(json?.data?.value);
  // boostr answers 200 with {status:"error"} when its own upstream fails.
  if (json?.status !== "success" || !date || !isFinite(value) || value <= 0) {
    throw new Error(`boostr: ${json?.message ?? "no data"}`);
  }
  return { date, value, source: "api.boostr.cl", series: [] };
}
