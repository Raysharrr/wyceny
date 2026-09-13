import { describe, expect, it } from "vitest";
import { computePairwise, suggestPairwiseMultiplier } from "../src/domain/pairwise";
import { comparableIdentity } from "../src/domain/pairwise-state";
import type { ValuationInput } from "../src/domain/valuation-input";

// AC07: sanitized spreadsheet arithmetic; the second PDF's 399400 is a typo.
function reference(which: "a" | "b"): ValuationInput {
  const a = which === "a";
  const totals = a ? [510000, 1068000, 694000] : [350000, 359000, 300000];
  const areas = a ? [51.2, 108.81, 71.3] : [49.9, 50.7, 42.2];
  const weights = a ? [0.4, 0.4, 0.1, 0.1] : [0.2, 0.2, 0.3, 0.2, 0.1];
  const multipliers = a
    ? [
        [0, 1, 1],
        [-0.5, 0.5, 0],
        [1, 0, 1],
        [1, 0, 1],
      ]
    : [
        [0, -1, -1],
        [-1, 0, 0],
        [0, 0, -1],
        [0, 1, 1],
        [1, 0, 0],
      ];
  const comparables = totals.map((total, i) => ({
    id: ["a", "b", "c"][i],
    source: "manual" as const,
    area: areas[i],
    pricePerM2: total / areas[i],
  }));
  return {
    method: "pp",
    area: a ? 74.63 : 48.1,
    comparables,
    features: weights.map((weight, i) => ({
      key: `f${i + 1}`,
      name: `Cecha ${i + 1}`,
      weight,
      rating: "przecietna",
    })),
    pairwise: {
      selectedComparableIds: comparables.map((c) => comparableIdentity(c)!),
      comparisons: Object.fromEntries(
        comparables.map((c, col) => [
          comparableIdentity(c),
          Object.fromEntries(
            weights.map((_, row) => [
              `f${row + 1}`,
              {
                rating: "przecietna",
                multiplier: multipliers[row][col],
                overrideReason: "Współczynnik przyjęty w arkuszu referencyjnym",
              },
            ]),
          ),
        ]),
      ),
    },
  };
}

describe("PP pure arithmetic (AC07/F-2)", () => {
  it.each([
    ["a", 740900, 9927.544254694061, 740892.6277278177],
    ["b", 339400, 7055.303324085876, 339360.0898885306],
  ] as const)("reproduces reference %s without intermediate rounding", (name, wr, mean, raw) => {
    const input = reference(name);
    const before = JSON.stringify(input);
    const result = computePairwise(input);
    expect(result.wr).toBe(wr);
    expect(result.unitValue).toBeCloseTo(mean, 9);
    expect(result.wrUnrounded).toBeCloseTo(raw, 7);
    expect(JSON.stringify(input)).toBe(before);
    expect(computePairwise(input)).toEqual(result);
    input.comparables.forEach((c) => {
      c.pricePerM2 = Math.round(c.pricePerM2 * 100) / 100;
    });
    expect(computePairwise(input).wr).toBe(wr);
  });
  it("uses selected rows only, retaining the pool and column order", () => {
    const input = reference("a");
    input.comparables.push({ id: "pool-only", pricePerM2: 100000 });
    input.pairwise!.selectedComparableIds.reverse();
    const result = computePairwise(input);
    expect(result.wr).toBe(740900);
    expect(result.pairs.map((p) => p.comparableId)).toEqual(["manual:c", "manual:b", "manual:a"]);
    expect(input.comparables).toHaveLength(4);
  });
  it("accepts zero spread and zero multipliers, never divides by the spread", () => {
    const input = reference("a");
    input.comparables.forEach((c) => {
      c.pricePerM2 = 1000;
    });
    expect(computePairwise(input)).toMatchObject({ priceSpread: 0, unitValue: 1000, wr: 74600 });
    expect(computePairwise(input).pairs.every((p) => p.totalCorrection === 0)).toBe(true);
  });
  it.each([-0.25, -1.25])(
    "accepts explicit fractional/extrapolated override %s with rationale",
    (multiplier) => {
      const input = reference("a");
      input.pairwise!.comparisons["manual:a"].f1 = {
        rating: "przecietna",
        multiplier,
        overrideReason: "Uzasadniony wyjątek rzeczoznawcy",
      };
      const result = computePairwise(input);
      expect(result.pairs[0].corrections[0].amount).toBe(result.priceSpread * 0.4 * multiplier);
      input.pairwise!.comparisons["manual:a"].f1.overrideReason = " ";
      expect(() => computePairwise(input)).toThrow();
    },
  );
  it.each([null, NaN, Infinity])("rejects missing/nonfinite multiplier %s", (multiplier) => {
    const input = reference("a");
    input.pairwise!.comparisons["manual:a"].f1.multiplier = multiplier;
    expect(() => computePairwise(input)).toThrow();
  });
  it("rejects missing rating even with zero multiplier", () => {
    const input = reference("a");
    input.pairwise!.comparisons["manual:a"].f1 = { rating: null, multiplier: 0 };
    expect(() => computePairwise(input)).toThrow();
  });
  it.each([0, -1, Infinity, NaN])("rejects nonpositive/nonfinite area and prices: %s", (value) => {
    expect(() => computePairwise({ ...reference("a"), area: value })).toThrow();
    const input = reference("a");
    input.comparables[0].pricePerM2 = value;
    expect(() => computePairwise(input)).toThrow();
  });
  it("rejects nonpositive corrected prices and arithmetic overflow", () => {
    const input = reference("a");
    input.pairwise!.comparisons["manual:a"].f1.multiplier = -1000;
    expect(() => computePairwise(input)).toThrow();
    expect(() => computePairwise({ ...reference("a"), area: Number.MAX_VALUE })).toThrow();
  });
  it("requires explicit unique feature keys and valid scales", () => {
    const input = reference("a");
    input.features[0].key = undefined;
    expect(() => computePairwise(input)).toThrow();
    input.features[0].key = "f2";
    expect(() => computePairwise(input)).toThrow();
    input.features[0].key = "f1";
    input.features[0].ratingScale = "two";
    expect(() => computePairwise(input)).toThrow();
  });
  it("uses two-level endpoints and rejects an average comparable on that scale", () => {
    const input = reference("a");
    input.features[0].ratingScale = "two";
    input.features[0].rating = "gorsza";
    for (const row of Object.values(input.pairwise!.comparisons)) {
      row.f1 = { rating: "lepsza", multiplier: -1 };
    }
    const result = computePairwise(input);
    expect(result.pairs[0].corrections[0].amount).toBe(-result.priceSpread * 0.4);
    input.pairwise!.comparisons["manual:a"].f1.rating = "przecietna";
    expect(() => computePairwise(input)).toThrow();
  });
  it.each([4, 5])("calculates %s explicitly selected comparisons", (count) => {
    const input = reference("a");
    for (let i = 3; i < count; i++) {
      const row = { id: `extra-${i}`, source: "manual" as const, pricePerM2: 10000 };
      input.comparables.push(row);
      const id = comparableIdentity(row)!;
      input.pairwise!.selectedComparableIds.push(id);
      input.pairwise!.comparisons[id] = Object.fromEntries(
        input.features.map((feature) => [feature.key!, { rating: "przecietna", multiplier: 0 }]),
      );
    }
    const result = computePairwise(input);
    expect(result.pairs).toHaveLength(count);
    expect(result.unitValue).toBe(
      result.pairs.reduce((sum, pair) => sum + pair.correctedPrice, 0) / count,
    );
  });
});

describe("D-AUTO explicit ordinal suggestion", () => {
  it("normalizes by the feature's two/three-level scale", () => {
    expect(suggestPairwiseMultiplier("przecietna", "lepsza", "three")).toBe(-0.5);
    expect(suggestPairwiseMultiplier("gorsza", "lepsza", "two")).toBe(-1);
    expect(suggestPairwiseMultiplier("lepsza", "gorsza", "two")).toBe(1);
    expect(suggestPairwiseMultiplier("lepsza", "lepsza", "three")).toBe(0);
    expect(() => suggestPairwiseMultiplier("przecietna", "lepsza", "two")).toThrow();
  });
});
