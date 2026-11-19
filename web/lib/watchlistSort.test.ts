import { describe, expect, it } from "vitest";
import { sortWatchlistRows, type WatchlistRow } from "./watchlistSort";

function row(symbol: string, price: number | null, changePercent: number | null, volume: number | null): WatchlistRow {
  return { symbol, price, changePercent, volume };
}

describe("sortWatchlistRows", () => {
  it("sorts by symbol ascending (alphabetical)", () => {
    const rows = [row("TSLA", 1, 1, 1), row("AAPL", 1, 1, 1), row("MSFT", 1, 1, 1)];
    expect(sortWatchlistRows(rows, "symbol", "asc").map((r) => r.symbol)).toEqual([
      "AAPL",
      "MSFT",
      "TSLA",
    ]);
  });

  it("sorts by symbol descending (reverse alphabetical)", () => {
    const rows = [row("TSLA", 1, 1, 1), row("AAPL", 1, 1, 1), row("MSFT", 1, 1, 1)];
    expect(sortWatchlistRows(rows, "symbol", "desc").map((r) => r.symbol)).toEqual([
      "TSLA",
      "MSFT",
      "AAPL",
    ]);
  });

  it("sorts by price numerically, ascending and descending", () => {
    const rows = [row("A", 30, 0, 0), row("B", 10, 0, 0), row("C", 20, 0, 0)];
    expect(sortWatchlistRows(rows, "price", "asc").map((r) => r.symbol)).toEqual(["B", "C", "A"]);
    expect(sortWatchlistRows(rows, "price", "desc").map((r) => r.symbol)).toEqual(["A", "C", "B"]);
  });

  it("sorts by changePercent numerically, ascending and descending", () => {
    const rows = [row("A", 0, -5, 0), row("B", 0, 10, 0), row("C", 0, 2, 0)];
    expect(sortWatchlistRows(rows, "changePercent", "asc").map((r) => r.symbol)).toEqual([
      "A",
      "C",
      "B",
    ]);
    expect(sortWatchlistRows(rows, "changePercent", "desc").map((r) => r.symbol)).toEqual([
      "B",
      "C",
      "A",
    ]);
  });

  it("sorts by volume numerically, ascending and descending", () => {
    const rows = [row("A", 0, 0, 3_000_000), row("B", 0, 0, 1_000_000), row("C", 0, 0, 2_000_000)];
    expect(sortWatchlistRows(rows, "volume", "asc").map((r) => r.symbol)).toEqual(["B", "C", "A"]);
    expect(sortWatchlistRows(rows, "volume", "desc").map((r) => r.symbol)).toEqual(["A", "C", "B"]);
  });

  it("pins rows with missing (null) numeric data to the end in ascending order", () => {
    const rows = [row("A", null, 0, 0), row("B", 10, 0, 0), row("C", 5, 0, 0)];
    expect(sortWatchlistRows(rows, "price", "asc").map((r) => r.symbol)).toEqual(["C", "B", "A"]);
  });

  it("pins rows with missing (null) numeric data to the end in descending order too", () => {
    const rows = [row("A", null, 0, 0), row("B", 10, 0, 0), row("C", 5, 0, 0)];
    expect(sortWatchlistRows(rows, "price", "desc").map((r) => r.symbol)).toEqual(["B", "C", "A"]);
  });

  it("treats undefined the same as null when pinning missing data to the end", () => {
    const rows: WatchlistRow[] = [
      { symbol: "A", price: undefined, changePercent: 0, volume: 0 },
      row("B", 10, 0, 0),
    ];
    expect(sortWatchlistRows(rows, "price", "asc").map((r) => r.symbol)).toEqual(["B", "A"]);
  });

  it("handles a mix of present and missing values across multiple rows", () => {
    const rows = [
      row("A", 5, 0, 0),
      row("B", null, 0, 0),
      row("C", 1, 0, 0),
      row("D", null, 0, 0),
      row("E", 3, 0, 0),
    ];
    const ascResult = sortWatchlistRows(rows, "price", "asc").map((r) => r.symbol);
    expect(ascResult.slice(0, 3)).toEqual(["C", "E", "A"]);
    expect(ascResult.slice(3)).toEqual(["B", "D"]);

    const descResult = sortWatchlistRows(rows, "price", "desc").map((r) => r.symbol);
    expect(descResult.slice(0, 3)).toEqual(["A", "E", "C"]);
    expect(descResult.slice(3)).toEqual(["B", "D"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row("TSLA", 1, 1, 1), row("AAPL", 1, 1, 1), row("MSFT", 1, 1, 1)];
    const original = [...rows];
    sortWatchlistRows(rows, "symbol", "asc");
    expect(rows).toEqual(original);
    expect(rows.map((r) => r.symbol)).toEqual(["TSLA", "AAPL", "MSFT"]);
  });
});
