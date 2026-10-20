import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv.js";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and newlines inside fields", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",z')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["multi\nline", "z"],
    ]);
  });
  it("strips a UTF-8 BOM and skips blank lines", () => {
    expect(parseCsv("\uFEFFsymbol,side\n\nAAPL,BUY\n\n")).toEqual([["symbol", "side"], ["AAPL", "BUY"]]);
  });
  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,"broken\n')).toThrow(/unterminated/);
  });
});

describe("toCsv", () => {
  it("round-trips through parseCsv", () => {
    const rows = [["AAPL", "BUY", 1.5, 100, "2026-01-01T00:00:00.000Z"], ['he said "x, y"', "SELL", 2, 3, "z"]];
    expect(parseCsv(toCsv(["a", "b", "c", "d", "e"], rows)).slice(1)).toEqual(rows.map((r) => r.map(String)));
  });
  it.each(["=HYPERLINK(\"http://evil\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd"])("neutralises formula-looking text %j", (bad) => {
    const cell = parseCsv(toCsv(["x"], [[bad]]))[1][0];
    expect(cell.startsWith("'")).toBe(true);
  });
  it("leaves numbers (including negatives) as numbers and blanks non-finite ones", () => {
    expect(toCsv(["n"], [[-1.5], [Infinity], [null]])).toBe("n\r\n-1.5\r\n\r\n\r\n");
  });
});
