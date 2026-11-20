import { describe, expect, it } from "vitest";
import { buildPositionsContext, type CreditSpreadPositionSnapshot, type SingleLegPositionSnapshot } from "./positionsContext";

const equity: SingleLegPositionSnapshot = {
  symbol: "AAPL",
  instrumentType: "EQUITY",
  optionType: null,
  strike: null,
  expiration: null,
  quantity: 10,
  avgCost: 150.25,
  realizedPnl: 0,
  multiplier: 1,
};

const creditSpread: CreditSpreadPositionSnapshot = {
  symbol: "SPY",
  instrumentType: "CREDIT_SPREAD",
  optionType: "PUT",
  expiration: "2026-01-16",
  shortStrike: 450,
  longStrike: 445,
  quantity: 2,
  shortQuantity: 2,
  longQuantity: 2,
  netCredit: 180,
  maxRisk: 820,
  realizedPnl: 0,
  multiplier: 100,
};

describe("buildPositionsContext", () => {
  it("returns undefined for an empty portfolio", () => {
    expect(buildPositionsContext([])).toBeUndefined();
  });

  it("forwards the full EQUITY/OPTION position object unchanged (no regression)", () => {
    expect(buildPositionsContext([equity])).toEqual([equity]);
  });

  it("forwards the full CREDIT_SPREAD position object, including fields the old avgCost-only mapping dropped", () => {
    const result = buildPositionsContext([creditSpread]);

    expect(result).toEqual([creditSpread]);
    // Explicitly assert the fields the old symbol/instrumentType/quantity/avgCost-only
    // mapping silently dropped -- and that don't even exist as `avgCost` on this shape --
    // are present and populated, per issue #65's acceptance criteria.
    const [position] = result ?? [];
    expect(position).toMatchObject({
      shortStrike: 450,
      longStrike: 445,
      netCredit: 180,
      maxRisk: 820,
      realizedPnl: 0,
      multiplier: 100,
    });
    expect(position).not.toHaveProperty("avgCost");
  });

  it("forwards multiple mixed-instrument-type positions unchanged", () => {
    expect(buildPositionsContext([equity, creditSpread])).toEqual([equity, creditSpread]);
  });
});
