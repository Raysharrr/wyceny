import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeKcs,
  type Comparable,
  type Feature,
  type FeatureMeasure,
  type KcsInput,
} from "../src/domain/kcs";
import {
  computeKcsOnScale,
  definitionsFromMeasure,
  describedLevels,
  featureIssues,
  featureUis,
  kcsReady,
  levelForValue,
  measureIssues,
  ratingPosition,
} from "../src/domain/feature-rules";
import {
  FEATURE_PRESETS,
  powierzchniaDefinitions,
  powierzchniaMeasure,
} from "../src/domain/feature-presets";
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

  it("a feature left unrated stops the engine", () => {
    const rated = inputs1409({
      name: "Powierzchnia",
      weight: 0.1,
      rating: "przecietna",
      definitions: THREE,
    });
    const unrated: KcsInput = { ...rated, features: [feature({ weight: 1, definitions: THREE })] };
    expect(kcsReady(unrated)).toBe(false);
    expect(() => computeKcsOnScale(unrated)).toThrow();
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

/**
 * FH.1 — progi liczbowe cech mierzalnych (plan §P1.1 „Progi cech mierzalnych”,
 * ADR-016 reg. 5, D-46/D-48). Skala piętra i powierzchni ma POLA liczbowe, a
 * tekst definicji powstaje z nich; parsowania tekstu nie ma nigdzie.
 */
describe("definitionsFromMeasure — brzmienia wprost z czterech operatów KCŚ", () => {
  it("piętro Kościelnej, Meissnera i Starołęckiej: parter / piętra pośrednie / 4 piętro i powyżej", () => {
    expect(
      definitionsFromMeasure({
        kind: "floor",
        bounds: { gorsza: { od: 0, do: 0 }, przecietna: { od: 1, do: 3 }, lepsza: { od: 4 } },
      }),
    ).toEqual({
      gorsza: "parter",
      przecietna: "piętra pośrednie",
      lepsza: "4 piętro i powyżej",
    });
  });

  it("piętro Bohaterów II: dolny przedział to wyliczenie, górny próg to inna liczba", () => {
    expect(
      definitionsFromMeasure({
        kind: "floor",
        bounds: { gorsza: { od: 0, do: 1 }, przecietna: { od: 2, do: 5 }, lepsza: { od: 6 } },
      }),
    ).toEqual({
      gorsza: "parter, 1 piętro",
      przecietna: "piętra pośrednie",
      lepsza: "6 piętro i powyżej",
    });
  });

  it("powierzchnia Bohaterów II: nazwa cechy nie wraca w definicji", () => {
    expect(
      definitionsFromMeasure({
        kind: "area",
        bounds: { lepsza: { do: 40 }, przecietna: { od: 41, do: 45 }, gorsza: { od: 46 } },
      }),
    ).toEqual({
      lepsza: "do 40 m²",
      przecietna: "od 41 m² do 45 m²",
      gorsza: "od 46 m²",
    });
  });

  it("powierzchnia dwustopniowa (Kościelna, Meissnera) — bez poziomu pośredniego", () => {
    expect(
      definitionsFromMeasure({
        kind: "area",
        bounds: { lepsza: { do: 64 }, gorsza: { od: 65 } },
      }),
    ).toEqual({ lepsza: "do 64 m²", gorsza: "od 65 m²" });
  });

  it("„piętra pośrednie” tylko w środku skali — skrajny przedział zawsze podaje swoje liczby", () => {
    // Skala dwustopniowa nie ma środka, więc żaden przedział nie jest pośredni.
    expect(
      definitionsFromMeasure({
        kind: "floor",
        bounds: { gorsza: { od: 0, do: 3 }, lepsza: { od: 4 } },
      }),
    ).toEqual({ gorsza: "parter, 1 piętro, 2 piętro, 3 piętro", lepsza: "4 piętro i powyżej" });
    // Najniższy przedział, który nie zaczyna się od parteru, wylicza od swojego „od”.
    expect(
      definitionsFromMeasure({
        kind: "floor",
        bounds: { gorsza: { od: 2, do: 3 }, lepsza: { od: 4 } },
      }),
    ).toEqual({ gorsza: "2 piętro, 3 piętro", lepsza: "4 piętro i powyżej" });
  });

  it("każde wygenerowane zdanie jest prawdziwe na obu krańcach swojego przedziału", () => {
    const skale: FeatureMeasure[] = [
      {
        kind: "floor",
        bounds: { gorsza: { od: 0, do: 1 }, przecietna: { od: 2, do: 5 }, lepsza: { od: 6 } },
      },
      {
        kind: "area",
        bounds: { lepsza: { do: 40 }, przecietna: { od: 41, do: 45 }, gorsza: { od: 46 } },
      },
    ];
    for (const measure of skale) {
      for (const [level, bound] of Object.entries(measure.bounds)) {
        if (bound.od != null) expect(levelForValue(measure, bound.od)).toBe(level);
        if (bound.do != null) expect(levelForValue(measure, bound.do)).toBe(level);
      }
    }
  });
});

describe("levelForValue — poziom z wartości przedmiotu lub transakcji (ADR-016 reg. 5)", () => {
  const PIETRO: FeatureMeasure = {
    kind: "floor",
    bounds: { gorsza: { od: 0, do: 0 }, przecietna: { od: 1, do: 3 }, lepsza: { od: 4 } },
  };
  const POWIERZCHNIA: FeatureMeasure = {
    kind: "area",
    bounds: { lepsza: { do: 46 }, gorsza: { od: 47 } },
  };

  it("piętro: przedziały domknięte obustronnie, bo kondygnacje są całkowite", () => {
    expect(levelForValue(PIETRO, 0)).toBe("gorsza");
    expect(levelForValue(PIETRO, 1)).toBe("przecietna");
    expect(levelForValue(PIETRO, 3)).toBe("przecietna");
    expect(levelForValue(PIETRO, 6)).toBe("lepsza");
  });

  it("powierzchnia: obie granice włączne, a metraż zaokrągla się do pełnych m²", () => {
    expect(levelForValue(POWIERZCHNIA, 44.23)).toBe("lepsza");
    expect(levelForValue(POWIERZCHNIA, 46)).toBe("lepsza");
    expect(levelForValue(POWIERZCHNIA, 47)).toBe("gorsza");
    expect(levelForValue(POWIERZCHNIA, 80)).toBe("gorsza");
    // 46,4 → 46 (lepsza), 46,5 → 47 (gorsza): połówka w górę, tak jak mediana.
    expect(levelForValue(POWIERZCHNIA, 46.4)).toBe("lepsza");
    expect(levelForValue(POWIERZCHNIA, 46.5)).toBe("gorsza");
  });

  it("żaden metraż nie wypada poza skalę, której brzmienie zostawia szczelinę", () => {
    // Operaty piszą „do 40 m²” obok „od 41 m²” — 40,5 m² nie należy do żadnego
    // z tych zdań dosłownie, a mimo to musi dostać poziom.
    const anety: FeatureMeasure = {
      kind: "area",
      bounds: { lepsza: { do: 40 }, przecietna: { od: 41, do: 45 }, gorsza: { od: 46 } },
    };
    expect(levelForValue(anety, 40.4)).toBe("lepsza");
    expect(levelForValue(anety, 40.5)).toBe("przecietna");
    expect(levelForValue(anety, 45.6)).toBe("gorsza");
  });

  it("granica `do` jest włączna także bez sąsiedniego przedziału", () => {
    // Bez tego przypadku „47 należy do gorsza” przechodzi przez sam porządek
    // skali, a nie przez granicę — mutant `value >= do` przeżywa.
    const zLuka: FeatureMeasure = {
      kind: "area",
      bounds: { lepsza: { do: 47 }, gorsza: { od: 100 } },
    };
    expect(levelForValue(zLuka, 47)).toBe("lepsza");
    expect(levelForValue(zLuka, 48)).toBeNull();
  });

  it("wartość poza wszystkimi przedziałami nie daje poziomu", () => {
    // Kondygnacja podziemna (rejestr zna −1) leży poniżej parteru.
    expect(levelForValue(PIETRO, -1)).toBeNull();
    expect(levelForValue(PIETRO, null)).toBeNull();
    expect(levelForValue(PIETRO, undefined)).toBeNull();
  });
});

describe("measureIssues — przedziały domknięte i rozłączne (D-46, D-48)", () => {
  const ok = (bounds: FeatureMeasure["bounds"], kind: FeatureMeasure["kind"] = "floor") =>
    measureIssues({ kind, bounds });

  it("przyjmuje skalę bez luk i bez nakładania", () => {
    expect(
      ok({ gorsza: { od: 0, do: 0 }, przecietna: { od: 1, do: 3 }, lepsza: { od: 4 } }),
    ).toEqual([]);
    expect(ok({ lepsza: { do: 46 }, gorsza: { od: 47 } }, "area")).toEqual([]);
    // Skala powierzchni z operatu 14.09 — kontrakt MUSI ją przyjąć.
    expect(
      ok({ lepsza: { do: 40 }, przecietna: { od: 41, do: 45 }, gorsza: { od: 46 } }, "area"),
    ).toEqual([]);
    // I skala piętra z tego samego operatu (szóste piętro i powyżej).
    expect(
      ok({ gorsza: { od: 0, do: 1 }, przecietna: { od: 2, do: 5 }, lepsza: { od: 6 } }),
    ).toEqual([]);
  });

  it("odrzuca lukę między przedziałami", () => {
    expect(ok({ gorsza: { od: 0, do: 0 }, lepsza: { od: 4 } })).toHaveLength(1);
    expect(ok({ lepsza: { do: 40 }, gorsza: { od: 46 } }, "area")).toHaveLength(1);
  });

  it("odrzuca nakładanie przedziałów", () => {
    expect(
      ok({ gorsza: { od: 0, do: 2 }, przecietna: { od: 1, do: 3 }, lepsza: { od: 4 } }),
    ).toHaveLength(1);
  });

  it("odrzuca przedział odwrócony i skalę z jednym przedziałem", () => {
    expect(ok({ gorsza: { od: 3, do: 1 }, lepsza: { od: 4 } })).not.toEqual([]);
    expect(ok({ lepsza: { od: 4 } })).not.toEqual([]);
    // Poziom z obydwoma polami pustymi nie jest przedziałem — inaczej dopycha
    // licznik i skala z jednym realnym przedziałem przechodzi.
    expect(ok({ gorsza: {}, lepsza: { od: 4 } })).toEqual([
      "Skala liczbowa musi mieć co najmniej dwa przedziały.",
    ]);
  });
});

describe("presety cech mierzalnych niosą progi (FH.1 „Done”)", () => {
  it("piętro: progi D-46 i teksty wygenerowane z nich", () => {
    const pietro = FEATURE_PRESETS.lokal.find((e) => e.key === "polozenie-na-pietrze")!;
    expect(pietro.defaultMeasure).toEqual({
      kind: "floor",
      bounds: { gorsza: { od: 0, do: 0 }, przecietna: { od: 1, do: 3 }, lepsza: { od: 4 } },
    });
    expect(measureIssues(pietro.defaultMeasure!)).toEqual([]);
    expect(pietro.defaultDefinitions).toEqual(definitionsFromMeasure(pietro.defaultMeasure!));
  });

  it("powierzchnia: progi z mediany próby i teksty wygenerowane z nich", () => {
    expect(powierzchniaMeasure(47)).toEqual({
      kind: "area",
      bounds: { lepsza: { do: 46 }, gorsza: { od: 47 } },
    });
    expect(measureIssues(powierzchniaMeasure(47)!)).toEqual([]);
    expect(powierzchniaDefinitions(47)).toEqual({ lepsza: "do 46 m²", gorsza: "od 47 m²" });
    expect(powierzchniaMeasure(null)).toBeNull();
    expect(definitionsFromMeasure(powierzchniaMeasure(47)!)).toEqual(powierzchniaDefinitions(47));
    // Lokal o metrażu dokładnie medianowym zostaje w większym przedziale, tak
    // jak przed zmianą konwencji — przesuwa się brzmienie, nie klasyfikacja.
    expect(levelForValue(powierzchniaMeasure(47)!, 47)).toBe("gorsza");
    expect(levelForValue(powierzchniaMeasure(47)!, 46)).toBe("lepsza");
  });
});
