import { describe, expect, it } from "vitest";
import { computeKcs, ROUNDING, type KcsInput } from "../src/domain/kcs";

// Half-up helper mirroring the engine's own — the tests below recompute each
// stage FROM the engine's own outputs using ROUNDING, so a constant that drifts
// away from the literal it replaced turns them red.
const roundTo = (value: number, dp: number): number => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

// Crafted so every stage lands on a different value one decimal place over:
// csr 10741.33 (2dp) vs 10741.333 (3dp), vmin 0.919 vs 0.9194, vmax 1.149 vs
// 1.1495, sumUi 1.05 vs 1.0502, unitValue 11278.4 vs 11278.397, wr 807 900
// (nearest 100) vs 807 870 (nearest 10).
const input: KcsInput = {
  area: 71.63,
  comparables: [{ pricePerM2: 9876 }, { pricePerM2: 10001 }, { pricePerM2: 12347 }],
  features: [
    { name: "lokalizacja", weight: 0.3, rating: "gorsza" },
    { name: "stan", weight: 0.2, rating: "przecietna" },
    { name: "standard", weight: 0.5, rating: "lepsza" },
  ],
};

describe("ROUNDING", () => {
  // The operat rounding convention (F-1) as a named, importable constant —
  // the help pages cite these values instead of restating them.
  it("matches the operat convention", () => {
    expect(ROUNDING).toEqual({
      csr: 2,
      vmin: 3,
      vmax: 3,
      sumUi: 3,
      unitValue: 2,
      wrNearest: 100,
    });
  });

  // Binding: the constant must be what computeKcs actually applies. Each
  // assertion recomputes one stage from the engine's own upstream outputs at
  // the precision ROUNDING declares; a declaration that no longer matches the
  // engine (or an engine that ignores it) fails here.
  it("is the precision computeKcs actually applies at every stage", () => {
    const result = computeKcs(input);
    const prices = input.comparables.map((c) => c.pricePerM2);
    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;

    expect(result.csr).toBe(roundTo(mean, ROUNDING.csr));
    expect(result.vmin).toBe(roundTo(result.cmin / result.csr, ROUNDING.vmin));
    expect(result.vmax).toBe(roundTo(result.cmax / result.csr, ROUNDING.vmax));
    expect(result.sumUi).toBe(
      roundTo(
        result.ui.reduce((sum, share) => sum + share.value, 0),
        ROUNDING.sumUi,
      ),
    );
    expect(result.unitValue).toBe(roundTo(result.csr * result.sumUi, ROUNDING.unitValue));
    expect(result.wr).toBe(
      Math.round(result.wrUnrounded / ROUNDING.wrNearest) * ROUNDING.wrNearest,
    );
  });
});
