import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeKcs, type Comparable, type Feature, type KcsInput } from "../src/domain/kcs";
import {
  FEATURE_SCALE_RULE,
  computeKcsOnScale,
  describedLevels,
  featureIssues,
  featureUis,
  kcsReady,
  ratingPosition,
} from "../src/domain/feature-rules";
import { OCZEKIWANE_PO_ADR016, wycena1409Anon } from "./fixtures/wycena-1409-anon";

/**
 * ADR-016 — the scale of a feature is the levels the appraiser DESCRIBED; Ui
 * follows the rating's position in that scale (I-10, I-11 U). Synthetic data
 * (F-9): the numbers mirror the 14.09 valuation's Cśr/Vmin/Vmax, no PII.
 */

const LEPSZA = "opis lepszej";
const PRZECIETNA = "opis przeciętnej";
const GORSZA = "opis gorszej";

function feature(over: Partial<Feature>): Feature {
  return { name: "Cecha", weight: 0.1, rating: null, ...over };
}

describe("describedLevels (ADR-016 reg. 1)", () => {
  it("keeps only non-blank definitions, ordered gorsza < przeciętna < lepsza", () => {
    expect(
      describedLevels(
        feature({ definitions: { lepsza: LEPSZA, przecietna: "  ", gorsza: GORSZA } }),
      ),
    ).toEqual(["gorsza", "lepsza"]);
    expect(describedLevels(feature({ definitions: null }))).toEqual([]);
  });
});

describe("ratingPosition (ADR-016 reg. 2)", () => {
  it("two levels lepsza/przeciętna: przeciętna is the lower one → min", () => {
    expect(
      ratingPosition(
        feature({ rating: "przecietna", definitions: { lepsza: LEPSZA, przecietna: PRZECIETNA } }),
      ),
    ).toBe("min");
  });

  it("two levels lepsza/gorsza: lepsza → max", () => {
    expect(
      ratingPosition(
        feature({ rating: "lepsza", definitions: { lepsza: LEPSZA, gorsza: GORSZA } }),
      ),
    ).toBe("max");
  });

  it("two levels gorsza/przeciętna: przeciętna is the higher one → max", () => {
    expect(
      ratingPosition(
        feature({ rating: "przecietna", definitions: { przecietna: PRZECIETNA, gorsza: GORSZA } }),
      ),
    ).toBe("max");
  });

  it("three levels map as before: gorsza min, przeciętna mid, lepsza max", () => {
    const definitions = { lepsza: LEPSZA, przecietna: PRZECIETNA, gorsza: GORSZA };
    expect(ratingPosition(feature({ rating: "gorsza", definitions }))).toBe("min");
    expect(ratingPosition(feature({ rating: "przecietna", definitions }))).toBe("mid");
    expect(ratingPosition(feature({ rating: "lepsza", definitions }))).toBe("max");
  });

  it("a rating on an undescribed level has no position", () => {
    expect(
      ratingPosition(
        feature({ rating: "przecietna", definitions: { lepsza: LEPSZA, gorsza: GORSZA } }),
      ),
    ).toBeNull();
  });

  it("no rating has no position", () => {
    expect(ratingPosition(feature({ definitions: { lepsza: LEPSZA, gorsza: GORSZA } }))).toBeNull();
  });
});

describe("featureIssues (I-10)", () => {
  it("B-08: no rating", () => {
    expect(
      featureIssues(
        feature({ name: "Lokalizacja", definitions: { lepsza: LEPSZA, gorsza: GORSZA } }),
      ),
    ).toEqual([{ code: "B-08", label: "Wybierz ocenę cechy „Lokalizacja”." }]);
  });

  it("B-09: rating on an undescribed level", () => {
    expect(
      featureIssues(
        feature({
          name: "Powierzchnia użytkowa",
          rating: "przecietna",
          definitions: { lepsza: LEPSZA, gorsza: GORSZA },
        }),
      ),
    ).toEqual([
      {
        code: "B-09",
        label:
          "Ocena „przeciętna” cechy „Powierzchnia użytkowa” nie ma opisu w skali — opisz ten poziom albo zmień ocenę.",
      },
    ]);
  });

  it("B-10: a weighted feature with fewer than two described levels", () => {
    expect(
      featureIssues(
        feature({ name: "Dodatkowe", rating: "lepsza", definitions: { lepsza: LEPSZA } }),
      ),
    ).toEqual([
      { code: "B-10", label: "Cecha „Dodatkowe” musi mieć opisane co najmniej dwa poziomy." },
    ]);
  });

  it("B-10 only for weight > 0; a rated feature on a described scale has no issues", () => {
    expect(
      featureIssues(feature({ weight: 0, rating: "lepsza", definitions: { lepsza: LEPSZA } })),
    ).toEqual([]);
    expect(
      featureIssues(feature({ rating: "lepsza", definitions: { lepsza: LEPSZA, gorsza: GORSZA } })),
    ).toEqual([]);
  });
});

describe("computeKcs refuses a feature without a rating (no WR)", () => {
  it("throws when any rating is null", () => {
    expect(() =>
      computeKcs({
        comparables: [{ pricePerM2: 10000 }],
        area: 50,
        features: [feature({ weight: 1 })],
      }),
    ).toThrow();
  });
});

/**
 * The 14.09 case, synthetic. Cśr 10 337,10 · Vmin 0,875 · Vmax 1,154 — the
 * three prices below give exactly those values.
 */
const COMPARABLES_1409: Comparable[] = [
  { pricePerM2: 9040.48 },
  { pricePerM2: 11931.82 },
  { pricePerM2: 10039.0 },
];
const THREE = { lepsza: LEPSZA, przecietna: PRZECIETNA, gorsza: GORSZA };

function features1409(powierzchnia: Feature): Feature[] {
  return [
    { name: "Standard wykończenia", weight: 0.4, rating: "przecietna", definitions: THREE },
    { name: "Położenie na piętrze", weight: 0.3, rating: "lepsza", definitions: THREE },
    {
      name: "Lokalizacja szczegółowa",
      weight: 0.1,
      rating: "przecietna",
      definitions: { lepsza: LEPSZA, przecietna: PRZECIETNA },
    },
    powierzchnia,
    {
      name: "Pomieszczenia przynależne",
      weight: 0.1,
      rating: "gorsza",
      definitions: { lepsza: LEPSZA, gorsza: GORSZA },
    },
  ];
}

function inputs1409(powierzchnia: Feature, over: Partial<KcsInput> = {}): KcsInput {
  return {
    comparables: COMPARABLES_1409,
    area: 44.23,
    features: features1409(powierzchnia),
    ...over,
  };
}

describe("computeKcsOnScale — Ui from the position in the described scale (I-11 U)", () => {
  it("as reported 14.09: powierzchnia rated on an undescribed level → no WR, and an issue", () => {
    const reported = inputs1409({
      name: "Powierzchnia użytkowa",
      weight: 0.1,
      rating: "przecietna",
      definitions: { lepsza: LEPSZA, gorsza: GORSZA },
    });
    expect(kcsReady(reported)).toBe(false);
    expect(() => computeKcsOnScale(reported)).toThrow();
    expect(featureIssues(reported.features[3]).map((i) => i.code)).toEqual(["B-09"]);
  });

  it("corrected like Aneta's (powierzchnia with three levels): lokalizacja takes w·Vmin", () => {
    const corrected = inputs1409({
      name: "Powierzchnia użytkowa",
      weight: 0.1,
      rating: "przecietna",
      definitions: THREE,
    });
    const onScale = computeKcsOnScale(corrected);
    expect(onScale.csr).toBe(10337.1);
    expect(onScale.vmin).toBe(0.875);
    expect(onScale.vmax).toBe(1.154);
    // 0,1 × 0,875 = 0,0875, printed and summed as 0,088 (ROUNDING.ui).
    expect(onScale.ui[2].value).toBe(0.088);

    // What the draft was computed with before ADR-016: the engine read the
    // rating KEY, so lokalizacja „przeciętna” took Ui śr and ΣUi was 1,034.
    const fixedKey = computeKcs(corrected);
    expect(fixedKey.sumUi).toBe(1.034);
    // Position mapping drops it by Ui śr − Ui min of lokalizacja, and the
    // rounded rows add up to the operat's 1,022 / 467 300 zł.
    expect(onScale.sumUi).toBe(1.022);
    expect(onScale.wr).toBe(467300);
  });

  it("Ui rows keep the appraiser's own rating, not the engine key of its position", () => {
    const onScale = computeKcsOnScale(
      inputs1409({ name: "Powierzchnia", weight: 0.1, rating: "przecietna", definitions: THREE }),
    );
    expect(onScale.ui.map((u) => u.rating)).toEqual([
      "przecietna",
      "lepsza",
      "przecietna",
      "przecietna",
      "gorsza",
    ]);
  });

  it("featureUis: Ui of every placeable feature while others still wait for a rating", () => {
    const partial = inputs1409({
      name: "Powierzchnia użytkowa",
      weight: 0.1,
      rating: null,
      definitions: THREE,
    });
    // Rounded exactly like the engine's own rows, so the step-4 rows add up to
    // the ΣUi of the sidebar once every feature is rated (I-11).
    const uis = featureUis(partial);
    expect(uis).toEqual([0.4, 0.346, 0.088, null, 0.088]);
  });

  // The marker records WHEN the ratings were confirmed (B-11), it never
  // changes a number — the same inputs give the same WR with and without it.
  it("the rule marker does not change what the engine computes", () => {
    const rated = inputs1409({
      name: "Powierzchnia",
      weight: 0.1,
      rating: "przecietna",
      definitions: THREE,
    });
    expect(computeKcsOnScale({ ...rated, featureScaleRule: FEATURE_SCALE_RULE })).toEqual(
      computeKcsOnScale(rated),
    );
    // And the marker never makes an unusable set usable. (`kcsReady` cannot
    // even see it — its parameter type is `Pick<KcsInput, "features">`.)
    const unrated: KcsInput = {
      ...rated,
      featureScaleRule: FEATURE_SCALE_RULE,
      features: [feature({ weight: 1, definitions: THREE })],
    };
    expect(kcsReady(unrated)).toBe(false);
  });
});

describe("computeKcsOnScale on the anonymised 14.09 fixture (b1-test-foundation)", () => {
  it("matches OCZEKIWANE_PO_ADR016 — the rule computed independently of the engine", () => {
    const { inputs } = wycena1409Anon({ skalaPowierzchni: "poprawiona" });
    const onScale = computeKcsOnScale(inputs);
    expect({ sumUi: onScale.sumUi, wr: onScale.wr }).toEqual(OCZEKIWANE_PO_ADR016);
  });

  it("as reported (powierzchnia rated off its scale) there is no WR", () => {
    expect(kcsReady(wycena1409Anon().inputs)).toBe(false);
  });
});

describe("one engine entry point for the application (ADR-016 reg. 2)", () => {
  const SRC = path.join(process.cwd(), "src");
  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });

  it("no file in src/ imports computeKcs except kcs.ts and feature-rules.ts", () => {
    const importers = sources(SRC)
      .filter((file) =>
        /import\s*\{[^}]*\bcomputeKcs\b(?!OnScale)[^}]*\}/.test(fs.readFileSync(file, "utf8")),
      )
      .map((file) => path.relative(SRC, file));
    expect(importers).toEqual(["domain/feature-rules.ts"]);
  });
});
