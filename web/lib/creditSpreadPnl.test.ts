import { describe, expect, it } from "vitest";
import { computeCreditSpreadPnl } from "./creditSpreadPnl";

describe("computeCreditSpreadPnl", () => {
  it("returns a real costBasis but null live fields when a leg's last price is unknown", () => {
    const result = computeCreditSpreadPnl({
      quantity: 1,
      netCredit: 150,
      multiplier: 100,
      shortLastPrice: null,
      longLastPrice: 1.0,
    });
    expect(result.costBasis).toBe(-150);
    expect(result.currentCostToClose).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
    expect(result.marketValue).toBeNull();
  });

  it("reports positive unrealized P&L when both legs have decayed toward zero (profitable short credit spread)", () => {
    // Opened for a $1.50/contract net credit ($150 total on 1 contract, 100x
    // multiplier): sold the $150 strike for $2.10, bought the $155 strike for
    // $0.60. Both legs have since decayed to $0.30/$0.05 — cheap to close.
    const result = computeCreditSpreadPnl({
      quantity: 1,
      netCredit: 150,
      multiplier: 100,
      shortLastPrice: 0.3,
      longLastPrice: 0.05,
    });
    // currentCostToClose = (0.30 - 0.05) * 100 * 1 = 25
    expect(result.currentCostToClose).toBe(25);
    // unrealizedPnl = 150 - 25 = 125
    expect(result.unrealizedPnl).toBe(125);
    expect(result.marketValue).toBe(-25);
  });

  it("reports negative unrealized P&L when the short leg has appreciated past the long leg (losing spread)", () => {
    // Same $150 net credit entry, but the underlying has rallied through the
    // short strike: short leg now worth $4.00, long leg $1.50.
    const result = computeCreditSpreadPnl({
      quantity: 1,
      netCredit: 150,
      multiplier: 100,
      shortLastPrice: 4.0,
      longLastPrice: 1.5,
    });
    // currentCostToClose = (4.00 - 1.50) * 100 * 1 = 250
    expect(result.currentCostToClose).toBe(250);
    // unrealizedPnl = 150 - 250 = -100
    expect(result.unrealizedPnl).toBe(-100);
    expect(result.marketValue).toBe(-250);
  });

  it("reports zero unrealized P&L when the current cost to close exactly matches the entry net credit", () => {
    // Entry: short $2.10, long $0.60 -> net credit $1.50/contract = $150
    // total. If both legs are unchanged, cost to close == entry net credit.
    const result = computeCreditSpreadPnl({
      quantity: 1,
      netCredit: 150,
      multiplier: 100,
      shortLastPrice: 2.1,
      longLastPrice: 0.6,
    });
    expect(result.unrealizedPnl).toBe(0);
  });

  it("scales currentCostToClose and unrealizedPnl by quantity for multi-contract spreads", () => {
    // Same per-contract prices as the profitable case above, but 3 contracts:
    // netCredit is already the $450 total (3 * $150/contract) per the
    // server's scaling convention.
    const result = computeCreditSpreadPnl({
      quantity: 3,
      netCredit: 450,
      multiplier: 100,
      shortLastPrice: 0.3,
      longLastPrice: 0.05,
    });
    // currentCostToClose = (0.30 - 0.05) * 100 * 3 = 75
    expect(result.currentCostToClose).toBe(75);
    expect(result.unrealizedPnl).toBe(375);
  });

  it("keeps marketValue - costBasis equal to unrealizedPnl across fixtures", () => {
    const fixtures: Array<{ quantity: number; netCredit: number; shortLastPrice: number; longLastPrice: number }> = [
      { quantity: 1, netCredit: 150, shortLastPrice: 0.3, longLastPrice: 0.05 },
      { quantity: 1, netCredit: 150, shortLastPrice: 4.0, longLastPrice: 1.5 },
      { quantity: 2, netCredit: 300, shortLastPrice: 1.1, longLastPrice: 0.4 },
    ];
    for (const f of fixtures) {
      const result = computeCreditSpreadPnl({ ...f, multiplier: 100 });
      expect(result.marketValue! - result.costBasis).toBeCloseTo(result.unrealizedPnl!, 10);
    }
  });
});
