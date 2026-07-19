import type { FeatureRating } from "./kcs";

/**
 * Expert feature preset (F-6, ADR-006) — the domain source of truth for the
 * feature bag, default weights and default rating-scale definitions, per
 * object type (today only "lokal"; a new type = a new entry, ADR-008
 * open/closed). Copied into the form on valuation creation; the appraiser
 * edits per valuation; the snapshot persists in write-once `inputs`.
 *
 * Definition TEXTS are hypothesis-grade defaults derived from the Kościelna
 * operat and the Gościejewko court operat §9.1 (wiki: cechy-porownawcze-lokali)
 * — Aneta verifies them during app testing (user decision 2026-07-15). The
 * MODEL (per-valuation, editable) is confirmed. Pure module: zero I/O (F-10).
 */

/** Document/display order of rating levels. */
export const FEATURE_LEVELS = ["lepsza", "przecietna", "gorsza"] as const;

export type FeatureDefinitions = Partial<Record<FeatureRating, string>>;

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
      name: "standard wykończenia",
      defaultWeightPct: 40,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "standard dobry, wykończenie materiałami lepszej jakości",
        przecietna: "standard dobry, wykończenie materiałami dobrej jakości",
        gorsza: "wymagany remont lub odświeżenie części elementów wykończenia",
      },
    },
    {
      key: "polozenie-na-pietrze",
      name: "położenie na piętrze",
      defaultWeightPct: 30,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "czwarte piętro i powyżej",
        przecietna: "piętra pośrednie (1–3)",
        gorsza: "parter",
      },
    },
    {
      key: "lokalizacja",
      name: "lokalizacja",
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
      name: "powierzchnia użytkowa",
      defaultWeightPct: 10,
      kind: "basic",
      // Dynamic: threshold comes from the comparable-sample area median —
      // powierzchniaDefinitions(). Static defaults stay empty (honest silence
      // in the operat until a sample exists or the appraiser types a text).
      defaultDefinitions: {},
    },
    {
      key: "pomieszczenia-przynalezne",
      name: "pomieszczenia przynależne",
      defaultWeightPct: 4,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "przynależna komórka lokatorska lub inne pomieszczenie",
        gorsza: "brak pomieszczeń przynależnych",
      },
    },
    {
      key: "dodatkowe",
      name: "dodatkowe",
      defaultWeightPct: 6,
      kind: "basic",
      defaultDefinitions: {
        lepsza: "ogródek, miejsce postojowe lub komórka lokatorska do wyłącznego korzystania",
        gorsza: "brak elementów dodatkowych",
      },
    },
    {
      key: "funkcjonalnosc-lokalu",
      name: "funkcjonalność lokalu",
      defaultWeightPct: 0,
      kind: "exceptional",
      defaultDefinitions: {
        lepsza: "układ funkcjonalny bez skosów i pomieszczeń przechodnich",
        gorsza: "skosy lub pomieszczenia przechodnie ograniczające funkcjonalność",
      },
    },
    {
      key: "liczba-izb",
      name: "liczba izb",
      defaultWeightPct: 0,
      kind: "exceptional",
      defaultDefinitions: {
        lepsza: "liczba izb większa niż typowa dla lokali o zbliżonej powierzchni",
        gorsza: "liczba izb mniejsza niż typowa dla lokali o zbliżonej powierzchni",
      },
    },
    {
      key: "rodzaj-zabudowy",
      name: "rodzaj zabudowy budynku",
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

/** Sample-derived powierzchnia definitions; {} when the sample carries no areas. */
export function powierzchniaDefinitions(medianM2: number | null): FeatureDefinitions {
  if (medianM2 == null) return {};
  return {
    lepsza: `powierzchnia użytkowa poniżej ${medianM2} m²`,
    gorsza: `powierzchnia użytkowa ${medianM2} m² i więcej`,
  };
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

/** Form seed: the active basic bag (weights in %, all przecietna, definitions copied). */
export function defaultFeatureFormValues(): Array<{
  key: LokalFeatureKey;
  name: string;
  weightPct: number;
  rating: "przecietna";
  definitions: FeatureDefinitions;
}> {
  return FEATURE_PRESETS.lokal
    .filter((e) => e.kind === "basic")
    .map((e) => ({
      key: e.key as LokalFeatureKey,
      name: e.name,
      weightPct: e.defaultWeightPct,
      rating: "przecietna" as const,
      definitions: { ...e.defaultDefinitions },
    }));
}
