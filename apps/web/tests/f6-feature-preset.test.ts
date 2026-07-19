import { describe, expect, it } from "vitest";
import {
  FEATURE_PRESETS,
  LOKAL_FEATURE_KEYS,
  defaultFeatureFormValues,
  matchesPresetDefinitions,
  matchesPresetWeights,
  medianAreaM2,
  powierzchniaDefinitions,
} from "../src/domain/feature-presets";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import { DEFAULT_FEATURES } from "../src/lib/valuation-form-schema";
import fixture from "./fixtures/koscielna.json";

/**
 * F-6 (fitness function): the expert preset (ADR-006) is the single source of
 * truth for the lokal feature bag. Guards: Σ(basic weights) = 100 exactly, the
 * bag is Aneta's canonical 6+3 list, the basic six reproduce the golden-era
 * form defaults (40/30/10/10/4/6), and the engine ignores the new metadata.
 */
describe("F-6: lokal feature preset", () => {
  const lokal = FEATURE_PRESETS.lokal;
  const basic = lokal.filter((e) => e.kind === "basic");

  it("has exactly Aneta's canonical 9-key bag, in pool order", () => {
    expect(lokal.map((e) => e.key)).toEqual([...LOKAL_FEATURE_KEYS]);
    expect(LOKAL_FEATURE_KEYS).toEqual([
      "standard-wykonczenia",
      "polozenie-na-pietrze",
      "lokalizacja",
      "powierzchnia-uzytkowa",
      "pomieszczenia-przynalezne",
      "dodatkowe",
      "funkcjonalnosc-lokalu",
      "liczba-izb",
      "rodzaj-zabudowy",
    ]);
  });

  it("basic six reproduce the pre-Slice-7 hardcoded form defaults exactly", () => {
    expect(basic.map((e) => [e.name, e.defaultWeightPct])).toEqual([
      ["standard wykończenia", 40],
      ["położenie na piętrze", 30],
      ["lokalizacja", 10],
      ["powierzchnia użytkowa", 10],
      ["pomieszczenia przynależne", 4],
      ["dodatkowe", 6],
    ]);
  });

  it("basic weights sum to exactly 100; exceptional entries carry weight 0", () => {
    expect(basic.reduce((s, e) => s + e.defaultWeightPct, 0)).toBe(100);
    for (const e of lokal.filter((x) => x.kind === "exceptional")) {
      expect(e.defaultWeightPct).toBe(0);
    }
  });

  it("every declared default definition is non-empty; powierzchnia is dynamic (empty static defaults)", () => {
    for (const e of lokal) {
      if (e.key === "powierzchnia-uzytkowa") {
        expect(e.defaultDefinitions).toEqual({});
        continue;
      }
      const levels = Object.values(e.defaultDefinitions);
      expect(levels.length).toBeGreaterThan(0);
      for (const text of levels) expect(text!.trim().length).toBeGreaterThan(0);
    }
  });

  it("powierzchnia definitions derive from the sample median (half-up, whole m²)", () => {
    expect(medianAreaM2([])).toBeNull();
    expect(medianAreaM2([50, 60, 70])).toBe(60);
    expect(medianAreaM2([50, 60])).toBe(55);
    expect(medianAreaM2([50, 61])).toBe(56); // 55.5 → half-up
    expect(medianAreaM2([undefined, null, 70])).toBe(70);
    expect(powierzchniaDefinitions(null)).toEqual({});
    const defs = powierzchniaDefinitions(65);
    expect(defs.lepsza).toContain("65");
    expect(defs.gorsza).toContain("65");
    expect(defs.przecietna).toBeUndefined();
  });

  it("defaultFeatureFormValues() = active basic bag, all przecietna, static definitions copied", () => {
    const defaults = defaultFeatureFormValues();
    expect(defaults.map((f) => [f.key, f.weightPct, f.rating])).toEqual(
      basic.map((e) => [e.key, e.defaultWeightPct, "przecietna"]),
    );
    // powierzchnia starts empty — the form fills it from the live sample median
    expect(defaults.find((f) => f.key === "powierzchnia-uzytkowa")!.definitions).toEqual({});
  });

  it("matchesPresetWeights: true for untouched defaults, false for any edit", () => {
    const defaults = defaultFeatureFormValues();
    expect(matchesPresetWeights(defaults)).toBe(true);
    expect(matchesPresetWeights([{ ...defaults[0], weightPct: 41 }, ...defaults.slice(1)])).toBe(
      false,
    );
    expect(matchesPresetWeights(defaults.slice(1))).toBe(false); // removed a feature
    expect(matchesPresetWeights([...defaults, { key: "rodzaj-zabudowy", weightPct: 0 }])).toBe(
      false,
    ); // added from pool (no `name` — the param type is {key; weightPct} only)
  });

  it("matchesPresetDefinitions: whitespace-insensitive; median-prefilled powierzchnia counts as preset", () => {
    const defaults = defaultFeatureFormValues().map((f) =>
      f.key === "powierzchnia-uzytkowa" ? { ...f, definitions: powierzchniaDefinitions(60) } : f,
    );
    expect(matchesPresetDefinitions(defaults, 60)).toBe(true);
    // extra whitespace still matches
    const spaced = defaults.map((f) =>
      f.key === "standard-wykonczenia"
        ? { ...f, definitions: { ...f.definitions, lepsza: `  ${f.definitions.lepsza}  ` } }
        : f,
    );
    expect(matchesPresetDefinitions(spaced, 60)).toBe(true);
    // a real edit does not
    const edited = defaults.map((f) =>
      f.key === "standard-wykonczenia"
        ? { ...f, definitions: { ...f.definitions, lepsza: "własny tekst rzeczoznawcy" } }
        : f,
    );
    expect(matchesPresetDefinitions(edited, 60)).toBe(false);
    // wrong median → not preset
    expect(matchesPresetDefinitions(defaults, 70)).toBe(false);
  });

  it("DEFAULT_FEATURES is exactly the derived preset (golden-era form reproduced)", () => {
    expect(DEFAULT_FEATURES).toEqual(defaultFeatureFormValues());
  });

  it("engine ignores the new metadata: enriched features give a byte-identical result (F-1 safe)", () => {
    // koscielna.json is a {name, input, expected} wrapper (see golden-wr.test.ts) — use .input.
    const base = (fixture as { input: KcsInput }).input;
    const enriched: KcsInput = {
      ...base,
      features: base.features.map((f) => ({
        ...f,
        key: "standard-wykonczenia",
        definitions: { lepsza: "dowolny tekst" },
      })),
    };
    const a = computeKcs(base);
    const b = computeKcs(enriched);
    expect(b.wr).toBe(a.wr);
    expect(b.sumUi).toBe(a.sumUi);
    expect(b.unitValue).toBe(a.unitValue);
  });
});
