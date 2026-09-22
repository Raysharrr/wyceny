import { definitionsFromMeasure } from "./feature-rules";
import type { FeatureMeasure, FeatureRating } from "./kcs";

/**
 * Expert feature preset (F-6, ADR-006) — the domain source of truth for the
 * feature bag, default weights and default rating-scale definitions, per
 * object type (today only "lokal"; a new type = a new entry, ADR-008
 * open/closed). Copied into the form on valuation creation; the appraiser
 * edits per valuation; the snapshot persists in write-once `inputs`.
 *
 * Definition TEXTS are hypothesis-grade defaults derived from the Kościelna
 * operat and the Gościejewko court operat §9.1 (wiki: cechy-porownawcze-lokali)
 * — Aneta verifies them during app testing (user decision 2026-07-15); names
 * and texts corrected after her 14.09 operat (D-43, D-45, D-46, D-49). The
 * MODEL (per-valuation, editable) is confirmed. Pure module: zero I/O (F-10).
 *
 * The two MEASURABLE features are the exception to "texts": piętro and
 * powierzchnia carry numeric thresholds (`defaultMeasure`), and their texts are
 * GENERATED from them (`definitionsFromMeasure`, FH.1) — editing a threshold
 * rewrites the text, so the two can never state different scales.
 */

/** Document/display order of rating levels. */
export const FEATURE_LEVELS = ["lepsza", "przecietna", "gorsza"] as const;

/**
 * Label per rating level — defined in `feature-rules.ts` beside the rules that
 * read the levels, re-exported here because this module has been the import
 * site since Slice 7.
 */
export { LEVEL_LABEL } from "./feature-rules";

export type FeatureDefinitions = Partial<Record<FeatureRating, string>>;

/**
 * Piętro thresholds (D-46): parter / 1–3 / od 4, closed and disjoint —
 * the 14.09 operat's "piętra pośrednie" had no numbers at all. Piętro is
 * counted parter = 0, the convention the definition texts print.
 */
const PIETRO_MEASURE: FeatureMeasure = {
  kind: "floor",
  bounds: { gorsza: { od: 0, do: 0 }, przecietna: { od: 1, do: 3 }, lepsza: { od: 4 } },
};

export type FeaturePresetEntry = {
  /** Stable slug (no diacritics) — closed pool, validated by zod. */
  key: string;
  /** Polish display name — flows into the engine's Feature.name and the operat. */
  name: string;
  defaultWeightPct: number;
  /** basic = active by default; exceptional = waits in the pool with weight 0. */
  kind: "basic" | "exceptional";
  /** Static level definitions; powierzchnia-uzytkowa is dynamic — see powierzchniaDefinitions(). */
  defaultDefinitions: FeatureDefinitions;
  /**
   * Numeric thresholds behind those texts, for the two measurable features
   * (FH.1). Absent on every other feature — nothing to measure, no suggestion.
   * powierzchnia-uzytkowa is dynamic here too: `powierzchniaMeasure()`.
   */
  defaultMeasure?: FeatureMeasure;
};

export const LOKAL_FEATURE_KEYS = [
  "standard-wykonczenia",
  "polozenie-na-pietrze",
  "lokalizacja",
  "powierzchnia-uzytkowa",
  "pomieszczenia-przynalezne",
  "dodatkowe",
  "funkcjonalnosc-lokalu",
  "liczba-izb",
  "rodzaj-zabudowy",
] as const;

export type LokalFeatureKey = (typeof LOKAL_FEATURE_KEYS)[number];

export const FEATURE_PRESETS: { lokal: FeaturePresetEntry[] } = {
  lokal: [
    {
      key: "standard-wykonczenia",
      name: "Standard wykończenia",
      defaultWeightPct: 40,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "standard dobry, wykończenie materiałami lepszej jakości",
        przecietna:
          "standard przeciętny, wykończenie materiałami przeciętnej jakości, widoczne zużycia elementów wykończenia",
        gorsza: "wymagany remont lub odświeżenie części elementów wykończenia",
      },
    },
    {
      key: "polozenie-na-pietrze",
      name: "Położenie na piętrze",
      defaultWeightPct: 30,
      kind: "basic",
      // D-46: the texts ARE the thresholds — generated, never typed twice.
      defaultDefinitions: definitionsFromMeasure(PIETRO_MEASURE),
      defaultMeasure: PIETRO_MEASURE,
    },
    {
      key: "lokalizacja",
      name: "Lokalizacja szczegółowa",
      defaultWeightPct: 10,
      kind: "basic",
      defaultDefinitions: {
        lepsza:
          "położenie w otoczeniu zabudowy mieszkaniowej wielorodzinnej, w bliskiej odległości od punktów handlowo-usługowych i szlaków komunikacyjnych",
        przecietna:
          "położenie w otoczeniu zabudowy mieszkaniowej wielorodzinnej i terenów zielonych, w dalszej odległości od punktów handlowo-usługowych",
      },
    },
    {
      key: "powierzchnia-uzytkowa",
      name: "Powierzchnia użytkowa",
      defaultWeightPct: 10,
      kind: "basic",
      // Dynamic: threshold comes from the comparable-sample area median —
      // powierzchniaDefinitions(). Static defaults stay empty (honest silence
      // in the operat until a sample exists or the appraiser types a text).
      defaultDefinitions: {},
    },
    {
      key: "pomieszczenia-przynalezne",
      name: "Pomieszczenia przynależne",
      defaultWeightPct: 4,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "przynależna piwnica lub inne pomieszczenie",
        gorsza: "brak pomieszczeń przynależnych",
      },
    },
    {
      key: "dodatkowe",
      name: "Dodatkowe",
      defaultWeightPct: 6,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "ogródek, miejsce postojowe lub komórka lokatorska do wyłącznego korzystania",
        gorsza: "brak elementów dodatkowych",
      },
    },
    {
      key: "funkcjonalnosc-lokalu",
      name: "Funkcjonalność lokalu",
      defaultWeightPct: 0,
      kind: "exceptional",
      defaultDefinitions: {
        lepsza: "układ funkcjonalny bez skosów i pomieszczeń przechodnich",
        gorsza: "skosy lub pomieszczenia przechodnie ograniczające funkcjonalność",
      },
    },
    {
      key: "liczba-izb",
      name: "Liczba izb",
      defaultWeightPct: 0,
      kind: "exceptional",
      defaultDefinitions: {
        lepsza: "liczba izb większa niż typowa dla lokali o zbliżonej powierzchni",
        gorsza: "liczba izb mniejsza niż typowa dla lokali o zbliżonej powierzchni",
      },
    },
    {
      key: "rodzaj-zabudowy",
      name: "Rodzaj zabudowy budynku",
      defaultWeightPct: 0,
      kind: "exceptional",
      defaultDefinitions: {
        lepsza: "rodzaj zabudowy preferowany na rynku lokalnym",
        gorsza: "rodzaj zabudowy mniej preferowany na rynku lokalnym",
      },
    },
  ],
};

/** Median of valid areas, half-up to whole m²; null when no usable area. */
export function medianAreaM2(areas: Array<number | null | undefined>): number | null {
  const valid = areas
    .filter((a): a is number => typeof a === "number" && Number.isFinite(a) && a > 0)
    .sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  const median = valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  return Math.round(median);
}

/**
 * Sample-derived powierzchnia thresholds; null when the sample carries no
 * areas. The median splits the scale in two: below it the flat is the smaller
 * (and, per m², the dearer) one. Both edges are inclusive whole m², so the
 * bands touch one m² apart — "do 46 m²" / "od 47 m²" for a median of 47, which
 * leaves a flat of exactly the median area in the larger band, as before.
 *
 * TWO levels, not three: that is the real shape of the Kościelna and Meissnera
 * operats, and it is all a median can honestly say.
 */
export function powierzchniaMeasure(medianM2: number | null): FeatureMeasure | null {
  if (medianM2 == null) return null;
  return { kind: "area", bounds: { lepsza: { do: medianM2 - 1 }, gorsza: { od: medianM2 } } };
}

/**
 * The kind of numeric scale a feature is measured on — `floor` for the storey,
 * `area` for the usable area — or null for every feature that has no numbers
 * behind its texts. What the step reads to keep the „od”/„do” fields on screen
 * while the thresholds are detached (PR-4, mockup 8).
 */
export function measureKindFor(key: string): FeatureMeasure["kind"] | null {
  if (key === "powierzchnia-uzytkowa") return "area";
  return FEATURE_PRESETS.lokal.find((e) => e.key === key)?.defaultMeasure?.kind ?? null;
}

/**
 * The preset thresholds a measurable feature can be RESTORED to („Przywróć
 * progi z presetu”, PR-4): the storey's static bands, the area's median bands
 * (null without a sample median — nothing to restore to), null for a feature
 * that never had thresholds. Always a fresh object: `bounds` is nested, and a
 * restored measure the appraiser then edits must never write into
 * FEATURE_PRESETS (see `defaultFeatureFormValues`).
 */
export function presetMeasureFor(key: string, medianM2: number | null): FeatureMeasure | null {
  if (key === "powierzchnia-uzytkowa") return powierzchniaMeasure(medianM2);
  const entry = FEATURE_PRESETS.lokal.find((e) => e.key === key);
  return entry?.defaultMeasure ? structuredClone(entry.defaultMeasure) : null;
}

/** Sample-derived powierzchnia definitions; {} when the sample carries no areas. */
export function powierzchniaDefinitions(medianM2: number | null): FeatureDefinitions {
  const measure = powierzchniaMeasure(medianM2);
  return measure ? definitionsFromMeasure(measure) : {};
}

/** Expected preset definitions for a key, resolving the dynamic powierzchnia case. */
export function presetDefinitionsFor(key: string, medianM2: number | null): FeatureDefinitions {
  if (key === "powierzchnia-uzytkowa") return powierzchniaDefinitions(medianM2);
  return FEATURE_PRESETS.lokal.find((e) => e.key === key)?.defaultDefinitions ?? {};
}

/** Trim + collapse inner whitespace — deterministic preset comparison (spec: Ryzyka). */
export function normalizeDefText(s: string | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

/** True iff the bag composition AND all weights equal the untouched basic preset. */
export function matchesPresetWeights(features: Array<{ key: string; weightPct: number }>): boolean {
  const basic = FEATURE_PRESETS.lokal.filter((e) => e.kind === "basic");
  if (features.length !== basic.length) return false;
  return basic.every((e) => {
    const f = features.find((x) => x.key === e.key);
    return f != null && Number(f.weightPct) === e.defaultWeightPct;
  });
}

/** True iff every feature's definitions equal the expected preset texts (whitespace-insensitive). */
export function matchesPresetDefinitions(
  features: Array<{ key: string; definitions?: FeatureDefinitions | null }>,
  medianM2: number | null,
): boolean {
  return features.every((f) => {
    const expected = presetDefinitionsFor(f.key, medianM2);
    return FEATURE_LEVELS.every(
      (level) => normalizeDefText(f.definitions?.[level]) === normalizeDefText(expected[level]),
    );
  });
}

/** Form seed: the active basic bag (weights in %, no rating — ADR-016 reg. 3, definitions copied). */
export function defaultFeatureFormValues(): Array<{
  key: LokalFeatureKey;
  name: string;
  weightPct: number;
  rating: FeatureRating | null;
  definitions: FeatureDefinitions;
  measure?: FeatureMeasure;
}> {
  return FEATURE_PRESETS.lokal
    .filter((e) => e.kind === "basic")
    .map((e) => ({
      key: e.key as LokalFeatureKey,
      name: e.name,
      weightPct: e.defaultWeightPct,
      rating: null,
      definitions: { ...e.defaultDefinitions },
      // Deep copy, not the preset's own object: `bounds` is nested, so a shallow
      // hand-over would let one valuation's thresholds write into FEATURE_PRESETS
      // and from there into every valuation opened later in the same process.
      // The form happens to REPLACE the measure rather than mutate it, but that
      // is the caller's convention, not a contract this module can rely on.
      ...(e.defaultMeasure ? { measure: structuredClone(e.defaultMeasure) } : {}),
    }));
}
