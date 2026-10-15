import { describe, expect, it } from "vitest";
import { normalizeExpiry } from "./expiry.js";

describe("option expiry normalization", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("accepts ISO dates and Nasdaq month labels", () => {
    expect(normalizeExpiry("2026-11-20", now)).toBe("2026-11-20");
    expect(normalizeExpiry("Nov 20", now)).toBe("2026-11-20");
    expect(normalizeExpiry("Nov 20, 2026", now)).toBe("2026-11-20");
    expect(normalizeExpiry("November 20 2026", now)).toBe("2026-11-20");
  });

  it("resolves year-less labels across New Year and keeps today's expiry", () => {
    expect(normalizeExpiry("Jan 15", now)).toBe("2027-01-15");
    expect(normalizeExpiry("Oct 15", now)).toBe("2026-10-15");
  });

  it("rejects invalid dates instead of allowing JavaScript to roll them forward", () => {
    for (const invalid of ["2026-02-30", "2026-13-01", "Feb 30", "2026-02-29", "garbage", "2026-11-20&x=1"]) {
      expect(normalizeExpiry(invalid, now)).toBeNull();
    }
    expect(normalizeExpiry("2028-02-29", now)).toBe("2028-02-29");
  });
});
