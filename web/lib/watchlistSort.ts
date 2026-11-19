export type WatchlistSortKey = "symbol" | "price" | "changePercent" | "volume";

export type WatchlistRow = {
  symbol: string;
  price: number | null | undefined;
  changePercent: number | null | undefined;
  volume: number | null | undefined;
};

function compareSymbol(a: WatchlistRow, b: WatchlistRow, dir: "asc" | "desc"): number {
  const cmp = a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
  return dir === "asc" ? cmp : -cmp;
}

function compareNumeric(
  a: WatchlistRow,
  b: WatchlistRow,
  key: "price" | "changePercent" | "volume",
  dir: "asc" | "desc"
): number {
  const av = a[key];
  const bv = b[key];
  const aMissing = av === null || av === undefined;
  const bMissing = bv === null || bv === undefined;

  // Missing values always sort to the end, regardless of direction.
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  const cmp = av - bv;
  return dir === "asc" ? cmp : -cmp;
}

// Generic in the row type (constrained to WatchlistRow's shape) so callers can
// pass rows with extra fields (e.g. the full matched Quote) and get them back
// without widening to the bare WatchlistRow type.
export function sortWatchlistRows<T extends WatchlistRow>(
  rows: T[],
  key: WatchlistSortKey,
  dir: "asc" | "desc"
): T[] {
  return [...rows].sort((a, b) => (key === "symbol" ? compareSymbol(a, b, dir) : compareNumeric(a, b, key, dir)));
}
