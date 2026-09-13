import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeKcs } from "../src/domain/kcs";
import { FEATURE_PRESETS } from "../src/domain/feature-presets";
import {
  calculationIssues,
  computeValuation,
  resolveMethod,
} from "../src/domain/valuation-calculation";
import {
  comparableIdentity,
  pairwiseBasis,
  valuationComparables,
} from "../src/domain/pairwise-state";
import {
  ValuationCalculationError,
  type Comparable,
  type ValuationInput,
} from "../src/domain/valuation-input";

function draft(method: "kcs" | "pp" = "pp"): ValuationInput {
  const ids = ["a", "b", "c"];
  const input: ValuationInput = {
    method,
    methodConfirmed: true,
    area: 50,
    comparables: (method === "pp" ? ids : Array.from({ length: 12 }, (_, i) => `${i}`)).map(
      (id, i) => ({ id, source: "manual", area: 40 + i, pricePerM2: 1000 + 100 * i }),
    ),
    features: [{ key: "lokalizacja", name: "lokalizacja", rating: "przecietna", weight: 1 }],
    pairwise: {
      selectedComparableIds: ids.map((id) => `manual:${id}`),
      comparisons: Object.fromEntries(
        ids.map((id) => [`manual:${id}`, { lokalizacja: { rating: "przecietna", multiplier: 0 } }]),
      ),
    },
  };
  input.pairwise!.confirmedBasis = pairwiseBasis(input);
  return input;
}

describe("shared dispatcher and readiness (AC01/AC02/AC10)", () => {
  it("calculates either method while requiring explicit choice for new operations", () => {
    for (const method of ["kcs", "pp"] as const) {
      const input = draft(method);
      expect(calculationIssues(input)).toEqual([]);
      expect(computeValuation(input).method).toBe(method);
      input.methodConfirmed = false;
      expect(calculationIssues(input)).toContainEqual(expect.objectContaining({ path: "method" }));
      expect(computeValuation(input).method).toBe(method);
    }
  });
  it("keeps legacy arithmetic entirely separate from new thresholds/feature validation", () => {
    const input = draft("kcs");
    delete input.method;
    input.comparables = input.comparables.slice(0, 2);
    input.features = [{ name: "", weight: 0.1, rating: "przecietna" }];
    expect(resolveMethod(input)).toBe("kcs");
    expect(computeValuation(input)).toEqual({ method: "kcs", ...computeKcs(input) });
    expect(calculationIssues(input)).toContainEqual(
      expect.objectContaining({ path: "comparables" }),
    );
    expect(calculationIssues(input)).toContainEqual(expect.objectContaining({ path: "method" }));
  });
  it.each(["unknown", "", null])("never defaults unknown method %s to KCS", (method) => {
    const input = { ...draft(), method } as unknown as ValuationInput;
    expect(() => computeValuation(input)).toThrow();
    expect(() => valuationComparables(input)).toThrow();
    expect(calculationIssues(input)).toContainEqual(expect.objectContaining({ path: "method" }));
  });
  it("keeps KCS minimum at 12, without changing arithmetic-only access", () => {
    const input = draft("kcs");
    input.comparables.pop();
    expect(calculationIssues(input)).toContainEqual(
      expect.objectContaining({ path: "comparables" }),
    );
    expect(computeValuation(input).wr).toBeGreaterThan(0);
  });
  it("returns a typed empty-sample error for explicit KCS, preserving the legacy error", () => {
    const input = { ...draft("kcs"), comparables: [] };
    expect(() => computeValuation(input)).toThrow(ValuationCalculationError);
    try {
      computeValuation(input);
    } catch (error) {
      expect(error).toMatchObject({ issues: [expect.objectContaining({ path: "comparables" })] });
    }
    delete input.method;
    const legacyMessage = "KCS engine: at least one comparable transaction is required";
    expect(() => computeKcs(input)).toThrow(legacyMessage);
    expect(() => computeValuation(input)).toThrow(legacyMessage);
    expect(() => computeValuation(input)).not.toThrow(ValuationCalculationError);
  });
  it.each([0, 2, 6])(
    "rejects PP selection of %s instead of choosing from the pool automatically",
    (count) => {
      const input = draft();
      input.comparables = Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, pricePerM2: 1000 }));
      input.pairwise!.selectedComparableIds = input.comparables
        .slice(0, count)
        .map((c) => comparableIdentity(c)!);
      expect(calculationIssues(input)).toContainEqual(
        expect.objectContaining({ path: "comparables" }),
      );
      expect(() => valuationComparables(input)).toThrow();
    },
  );
  it.each([3, 4, 5])("resolves %s chosen rows in display order", (count) => {
    const input = draft();
    input.comparables = Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, pricePerM2: 1000 }));
    input.pairwise!.selectedComparableIds = input.comparables
      .slice(0, count)
      .reverse()
      .map((c) => comparableIdentity(c)!);
    expect(valuationComparables(input).map((c) => c.id)).toEqual(
      Array.from({ length: count }, (_, i) => `${count - i - 1}`),
    );
  });
  it("requires up-to-date matrix confirmation but supports unconfirmed calculation preview", () => {
    const input = draft();
    const originalBasis = input.pairwise!.confirmedBasis;
    input.pairwise!.comparisons["manual:a"].lokalizacja.multiplier = -0.25;
    input.pairwise!.comparisons["manual:a"].lokalizacja.overrideReason = "Uzasadniony wyjątek";
    expect(calculationIssues(input)).toContainEqual(
      expect.objectContaining({ path: "pairwise.confirmedBasis" }),
    );
    expect(computeValuation(input).wr).toBeGreaterThan(0);
    expect(pairwiseBasis(input)).not.toBe(originalBasis);
    input.pairwise!.confirmedBasis = pairwiseBasis(input);
    expect(calculationIssues(input)).toEqual([]);
  });
  it("PP refuses an undefined middle area rating saved before the wizard cleared it", () => {
    const input = draft();
    input.features = [
      {
        key: "powierzchnia-uzytkowa",
        name: "powierzchnia użytkowa",
        rating: "przecietna",
        weight: 1,
        definitions: { lepsza: "poniżej 50 m²", gorsza: "50 m² i więcej" },
      },
    ];
    const issue = expect.objectContaining({ path: "features.0.rating" });
    expect(calculationIssues(input)).toContainEqual(issue);
    input.features[0].rating = "lepsza";
    expect(calculationIssues(input)).not.toContainEqual(issue);
    expect(
      calculationIssues({
        ...draft("kcs"),
        features: [{ ...input.features[0], rating: "przecietna" }],
      }),
    ).not.toContainEqual(issue);
  });
  it("enforces catalog rules and refuses invalid weights in both new methods", () => {
    for (const method of ["kcs", "pp"] as const) {
      const input = draft(method);
      input.features[0].name = "Zmieniona nazwa";
      expect(() => computeValuation(input)).toThrow();
      expect(calculationIssues(input)).toContainEqual(
        expect.objectContaining({ path: "features.0.name" }),
      );
      input.features[0].name = "lokalizacja";
      input.features[0].weight = 0.9;
      expect(() => computeValuation(input)).toThrow();
    }
  });
  it("excludes zero-weight rows in new results and requires no zero-weight PP cells", () => {
    for (const method of ["kcs", "pp"] as const) {
      const input = draft(method);
      const before = computeValuation(input);
      const preset = FEATURE_PRESETS.lokal[0];
      input.features.push({ key: preset.key, name: preset.name, rating: "lepsza", weight: 0 });
      input.pairwise!.confirmedBasis = pairwiseBasis(input);
      expect(calculationIssues(input)).toEqual([]);
      expect(computeValuation(input)).toEqual(before);
    }
  });
  it.each([0, -1, NaN, Infinity])("rejects nonfinite/nonpositive numeric inputs %s", (value) => {
    for (const method of ["kcs", "pp"] as const) {
      const input = draft(method);
      input.comparables[0].area = value;
      expect(calculationIssues(input)).toContainEqual(
        expect.objectContaining({ path: "comparables.0.area" }),
      );
      expect(() => computeValuation(input)).toThrow();
    }
  });
  it("preserves both exact historical golden results through the dispatcher", () => {
    const a = JSON.parse(
      readFileSync(new URL("./fixtures/koscielna.json", import.meta.url), "utf8"),
    );
    const b = JSON.parse(
      readFileSync(new URL("./fixtures/coop-piastowskie.json", import.meta.url), "utf8"),
    );
    const inputB: ValuationInput = {
      area: b.subjectArea,
      features: b.features,
      comparables: b.rows.map((row: { area: number; priceTotal: number }) => ({
        area: row.area,
        pricePerM2: row.priceTotal / row.area,
      })),
    };
    expect(computeValuation(a.input)).toEqual({ method: "kcs", ...computeKcs(a.input) });
    expect(computeValuation(a.input).wr).toBe(1044400);
    expect(computeValuation(inputB).wr).toBe(446900);
  });
});

describe("stable identities (AC05)", () => {
  it("distinguishes locals of one act, registries and manual rows", () => {
    expect(
      comparableIdentity({ pricePerM2: 1, source: "rcn", transactionId: "tx", lokalId: "a" }),
    ).toBe("rcn:tx|a");
    expect(
      comparableIdentity({ pricePerM2: 1, source: "rcn", transactionId: "tx", lokalId: "b" }),
    ).toBe("rcn:tx|b");
    expect(comparableIdentity({ pricePerM2: 1, source: "rejestr_sm", coopTxId: "tx" })).toBe(
      "sm:tx",
    );
    expect(comparableIdentity({ pricePerM2: 1, source: "manual", id: "tx" })).toBe("manual:tx");
  });
  it("keeps source-qualified fallback identities without inferring ids from prices/order", () => {
    expect(comparableIdentity({ pricePerM2: 1 })).toBeNull();
    expect(comparableIdentity({ pricePerM2: 1, source: "rcn", transactionId: "tx" })).toBeNull();
    expect(comparableIdentity({ pricePerM2: 1, source: "rcn", id: "row-a" })).toBe("rcn:row:row-a");
    expect(comparableIdentity({ pricePerM2: 1, source: "rejestr_sm", id: "row-a" })).toBe(
      "sm:row:row-a",
    );
    expect(comparableIdentity({ pricePerM2: 1, source: "rejestr_sm", coopTxId: "row:a" })).not.toBe(
      "sm:row:a",
    );
  });
  it("escapes composite separators to avoid collisions", () => {
    const row: Comparable = { pricePerM2: 1, source: "rcn", transactionId: "a|b", lokalId: "c" };
    expect(comparableIdentity(row)).not.toBe(
      comparableIdentity({ ...row, transactionId: "a", lokalId: "b|c" }),
    );
  });
  it.each(["duplicate-pool", "missing-pool", "duplicate-selection", "foreign-selection"])(
    "rejects %s",
    (kind) => {
      const input = draft();
      if (kind === "duplicate-pool") input.comparables.push({ ...input.comparables[0] });
      if (kind === "missing-pool") delete input.comparables[0].id;
      if (kind === "duplicate-selection") input.pairwise!.selectedComparableIds[1] = "manual:a";
      if (kind === "foreign-selection") input.pairwise!.selectedComparableIds[1] = "manual:foreign";
      expect(() => valuationComparables(input)).toThrow();
      expect(() => computeValuation(input)).toThrow();
    },
  );
  it("pool reordering preserves ratings attached to the same identity", () => {
    const input = draft();
    input.pairwise!.comparisons["manual:a"].lokalizacja = { rating: "lepsza", multiplier: -0.5 };
    const before = computeValuation(input);
    input.comparables.reverse();
    expect(computeValuation(input)).toEqual(before);
    input.pairwise!.selectedComparableIds[0] = "manual:new";
    input.comparables.push({ id: "new", pricePerM2: 1000 });
    expect(() => computeValuation(input)).toThrow();
  });
});

describe("complete confirmation basis (AC06)", () => {
  const changes: [string, (input: ValuationInput) => void][] = [
    [
      "method",
      (i) => {
        i.method = "kcs";
      },
    ],
    [
      "subject area",
      (i) => {
        i.area += 1;
      },
    ],
    [
      "column order",
      (i) => {
        i.pairwise!.selectedComparableIds.reverse();
      },
    ],
    [
      "selection",
      (i) => {
        i.pairwise!.selectedComparableIds.pop();
      },
    ],
    [
      "row source",
      (i) => {
        i.comparables[0].source = "rcn";
      },
    ],
    [
      "row id",
      (i) => {
        i.comparables[0].id = "new";
      },
    ],
    [
      "row date",
      (i) => {
        i.comparables[0].date = "2026-01";
      },
    ],
    [
      "row area",
      (i) => {
        i.comparables[0].area = 55;
      },
    ],
    [
      "row price",
      (i) => {
        i.comparables[0].pricePerM2 += 0.001;
      },
    ],
    [
      "source tx id",
      (i) => {
        i.comparables[0].transactionId = "tx";
      },
    ],
    [
      "source lokal id",
      (i) => {
        i.comparables[0].lokalId = "lok";
      },
    ],
    [
      "source coop id",
      (i) => {
        i.comparables[0].coopTxId = "coop";
      },
    ],
    [
      "feature name",
      (i) => {
        i.features[0].name = "inna";
      },
    ],
    [
      "feature key",
      (i) => {
        i.features[0].key = "inne";
      },
    ],
    [
      "feature weight",
      (i) => {
        i.features[0].weight = 0.99;
      },
    ],
    [
      "feature rating",
      (i) => {
        i.features[0].rating = "lepsza";
      },
    ],
    [
      "feature scale",
      (i) => {
        i.features[0].ratingScale = "two";
      },
    ],
    [
      "feature definitions",
      (i) => {
        i.features[0].definitions = { lepsza: "Nowa definicja" };
      },
    ],
    [
      "cell rating",
      (i) => {
        i.pairwise!.comparisons["manual:a"].lokalizacja.rating = "lepsza";
      },
    ],
    [
      "cell multiplier",
      (i) => {
        i.pairwise!.comparisons["manual:a"].lokalizacja.multiplier = -0.25;
      },
    ],
    [
      "cell reason",
      (i) => {
        i.pairwise!.comparisons["manual:a"].lokalizacja.overrideReason = "Wyjątek";
      },
    ],
    [
      "missing cell",
      (i) => {
        delete i.pairwise!.comparisons["manual:a"].lokalizacja;
      },
    ],
    [
      "null cell value",
      (i) => {
        i.pairwise!.comparisons["manual:a"].lokalizacja.multiplier = null;
      },
    ],
    [
      "unused cell",
      (i) => {
        i.pairwise!.comparisons["manual:pool"] = { unused: { rating: null, multiplier: null } };
      },
    ],
  ];
  it.each(changes)("invalidates on %s", (_, change) => {
    const input = draft();
    const originalLoadedBasis = pairwiseBasis(input);
    change(input);
    expect(pairwiseBasis(input)).not.toBe(originalLoadedBasis);
    expect(input.pairwise!.confirmedBasis).toBe(originalLoadedBasis);
  });
  it("sorts map keys, preserves arrays, excludes only confirmation/status metadata", () => {
    const input = draft();
    const before = pairwiseBasis(input);
    input.pairwise!.confirmedBasis = "new marker";
    input.methodConfirmed = false;
    input.comparables.forEach((row) => {
      row.status = "confirmed";
    });
    input.comparables.reverse();
    input.pairwise!.comparisons = Object.fromEntries(
      Object.entries(input.pairwise!.comparisons).reverse(),
    );
    expect(pairwiseBasis(input)).toBe(before);
    input.pairwise!.confirmedBasis = pairwiseBasis(input);
    expect(pairwiseBasis(input)).toBe(before);
  });
  it("supports incomplete drafts and does not accidentally bind unrelated pool rows", () => {
    const input = draft();
    const before = pairwiseBasis(input);
    input.comparables.push({ id: "unused", pricePerM2: 99999 });
    expect(pairwiseBasis(input)).toBe(before);
    input.pairwise!.selectedComparableIds = ["manual:missing"];
    expect(() => pairwiseBasis(input)).not.toThrow();
  });
});
