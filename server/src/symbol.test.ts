import { describe, expect, it } from "vitest";
import { normalizeSymbol } from "./symbol.js";

describe("normalizeSymbol", () => {
  it.each(["AAPL", "brk-b", "^GSPC", "0700.HK", "EURUSD=X", "GC=F", "M&M.NS", " msft "])("accepts real ticker %j", (s) => {
    expect(normalizeSymbol(s)).toBe(s.trim().toUpperCase());
  });
  it.each(["", "..", "=CMD", "-2+3", "&AB", ".AB", "<script>", "A,B", "A B", "X".repeat(21), 42, null])(
    "rejects %j",
    (s) => expect(normalizeSymbol(s as unknown)).toBeNull()
  );
});
