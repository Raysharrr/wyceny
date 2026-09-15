import {
  computeKcs,
  type Feature,
  type FeatureMeasure,
  type FeatureRating,
  type KcsInput,
  type KcsResult,
  type MeasureBound,
} from "./kcs";

/**
 * Rating scale of a feature (ADR-016, P5). The scale is the levels the
 * appraiser DESCRIBED — any two, or all three — and Ui follows the rating's
 * position in that scale. One path: this module maps the position onto the
 * engine's key before calling it, always. Pure (F-10).
 *
 * For a MEASURABLE feature (piętro, powierzchnia) the scale additionally
 * carries numeric bands (`Feature.measure`, FH.1): the definition texts are
 * generated FROM the bands, and the same bands place the subject (the step-4
 * suggestion) and the Cmin/Cmax transactions of §12.2 (D-52).
 */

export type RatingPosition = "min" | "mid" | "max";

/**
 * Label per rating level — the internal enum stays diacritic-free. One map for
 * the §12.1 scale block, the prose facts, the step-4 cards and the ADR-016
 * blockers. It lives here, beside the rules that read the levels, so
 * `feature-presets.ts` can import the threshold helpers below without a cycle;
 * that module re-exports it, so existing import sites are unchanged.
 */
export const LEVEL_LABEL: Record<FeatureRating, string> = {
  lepsza: "lepsza",
  przecietna: "przeciętna",
  gorsza: "gorsza",
};

/** Scale order, lowest first (ADR-016 reg. 1). */
const SCALE_ORDER: FeatureRating[] = ["gorsza", "przecietna", "lepsza"];

/** The engine's key for a position — the formula reads gorsza as w·Vmin, przeciętna as w, lepsza as w·Vmax. */
const ENGINE_RATING: Record<RatingPosition, FeatureRating> = {
  min: "gorsza",
  mid: "przecietna",
  max: "lepsza",
};

// ─── Numeric thresholds of measurable features (FH.1, plan §P1.1, D-46/D-48) ─

/** One storey as the operats name it — parter has no number. */
function floorLabel(value: number): string {
  return value === 0 ? "parter" : `${value} piętro`;
}

/**
 * How many storeys a piętro band may list before the wording runs out. Across
 * eight operats every enumeration is one or two items ("parter", "parter,
 * 1 piętro", "1 piętro, 2 piętro", "4 piętro, 5 piętro"); a wider range is
 * always written as "N piętro i powyżej" or left descriptive ("piętra
 * pośrednie"). There is not one enumeration of three or more (user decision
 * 15.09), so this is the edge of the evidence, not a style preference.
 */
const MAX_FLOOR_ENUMERATION = 2;

/** Bands that carry an edge, ordered by VALUE — for powierzchnia that is the reverse of the rating order. */
function valueOrderedBands(
  measure: FeatureMeasure,
): Array<{ level: FeatureRating; bound: MeasureBound }> {
  return SCALE_ORDER.flatMap((level) => {
    const bound = measure.bounds[level];
    return bound && (bound.od != null || bound.do != null) ? [{ level, bound }] : [];
  }).sort(
    (a, b) => (a.bound.od ?? Number.NEGATIVE_INFINITY) - (b.bound.od ?? Number.NEGATIVE_INFINITY),
  );
}

/**
 * The definition text of ONE band, in the wording four KCŚ operats use
 * (Kościelna, Meissnera, Starołęcka, Bohaterów II — team-lead's extract,
 * 15.09). This is the only place a scale text is written, so a threshold edit
 * and the preset can never drift apart. Three rules the operats settle:
 *
 * - the feature's NAME is the table heading, so the definition never repeats it
 *   ("do 40 m²", never "powierzchnia użytkowa do 40 m²");
 * - the piętro band that is neither the lowest nor the highest is "piętra
 *   pośrednie" — descriptive in all four operats, never a numeric range;
 * - the lowest piętro band is an ENUMERATION of at most two storeys ("parter",
 *   "parter, 1 piętro"), and the highest is "N piętro i powyżej".
 *
 * `position` is the band's place in the value order, which decides only the
 * piętro middle wording; every other sentence is written from the edges
 * themselves, so a band can never claim coverage it does not have.
 */
function definitionFromBounds(
  kind: FeatureMeasure["kind"],
  bound: MeasureBound,
  position: "lowest" | "middle" | "highest",
): string {
  const { od, do: upper } = bound;
  if (od == null && upper == null) return "";
  if (kind === "area") {
    // The 14.09 operat's pattern (Bohaterów II), not the older "poniżej/powyżej".
    if (od == null) return `do ${upper} m²`;
    if (upper == null) return `od ${od} m²`;
    return `od ${od} m² do ${upper} m²`;
  }
  if (upper == null) return `${floorLabel(od ?? 0)} i powyżej`;
  if (position === "middle") return "piętra pośrednie";
  const from = od ?? 0;
  // A closed band wider than the enumeration has NO wording in the operats, and
  // "N piętro i powyżej" would claim storeys it does not cover. Nothing is
  // written; `measureIssues` names the band in the row instead of the generator
  // inventing a sentence that would go into the operat.
  if (upper - from + 1 > MAX_FLOOR_ENUMERATION) return "";
  const storeys = [];
  for (let n = from; n <= upper; n++) storeys.push(floorLabel(n));
  return storeys.join(", ");
}

/** Every band's definition text — what `Feature.definitions` must equal while `measure` stands. */
export function definitionsFromMeasure(
  measure: FeatureMeasure,
): Partial<Record<FeatureRating, string>> {
  const bands = valueOrderedBands(measure);
  const out: Partial<Record<FeatureRating, string>> = {};
  bands.forEach(({ level, bound }, i) => {
    const position = i === 0 ? "lowest" : i === bands.length - 1 ? "highest" : "middle";
    out[level] = definitionFromBounds(measure.kind, bound, position);
  });
  return out;
}

/**
 * The level a measured value falls into, or null when no band covers it — a
 * kondygnacja below parter, a blank field, a scale with a gap. Both edges are
 * inclusive; an area is rounded half-up to whole m² first, because the operats
 * write whole-m² bands and 46,8 m² has to land somewhere.
 */
export function levelForValue(
  measure: FeatureMeasure,
  value: number | null | undefined,
): FeatureRating | null {
  if (value == null || !Number.isFinite(value)) return null;
  const placed = measure.kind === "area" ? Math.round(value) : value;
  for (const level of SCALE_ORDER) {
    const bound = measure.bounds[level];
    if (!bound) continue;
    if (bound.od != null && placed < bound.od) continue;
    if (bound.do != null && placed > bound.do) continue;
    return level;
  }
  return null;
}

/**
 * What stops the bands from being a scale (D-46, D-48): fewer than two bands,
 * an inverted band, an overlap, or a gap. Aneta's 14.09 area scale (do 40 /
 * 41–45 / od 46) is the worked example of a scale that MUST pass — it is what
 * forced the whole-number inclusive convention.
 */
export function measureIssues(measure: FeatureMeasure): string[] {
  const issues: string[] = [];
  // A level with both fields blank is not a band — it would otherwise pad the
  // count and let a one-band scale through.
  const bands = valueOrderedBands(measure);
  if (bands.length < 2) {
    issues.push("Skala liczbowa musi mieć co najmniej dwa przedziały.");
    return issues;
  }
  for (const { level, bound } of bands) {
    if (bound.od != null && bound.do != null && bound.od > bound.do) {
      issues.push(`Przedział poziomu „${LEVEL_LABEL[level]}” zaczyna się powyżej swojego końca.`);
    }
  }
  if (issues.length > 0) return issues;

  for (let i = 1; i < bands.length; i++) {
    const prev = bands[i - 1];
    const next = bands[i];
    const prevEnd = prev.bound.do;
    const nextStart = next.bound.od;
    const pair = `„${LEVEL_LABEL[prev.level]}” i „${LEVEL_LABEL[next.level]}”`;
    if (prevEnd == null || nextStart == null) {
      issues.push(`Przedziały poziomów ${pair} nachodzą na siebie.`);
      continue;
    }
    // One convention for both kinds: whole numbers, both edges inclusive, so
    // neighbours touch one step apart ("do 40 m²" then "od 41 m²").
    if (prevEnd + 1 === nextStart) continue;
    const overlaps = nextStart <= prevEnd;
    issues.push(
      overlaps
        ? `Przedziały poziomów ${pair} nachodzą na siebie.`
        : `Między przedziałami poziomów ${pair} jest luka.`,
    );
  }
  if (issues.length > 0) return issues;

  // Last, because it is about WORDING rather than about the bands being a
  // scale: a closed piętro band wider than the enumeration has no sentence in
  // the operats, so the generator writes none and the row says why.
  if (measure.kind === "floor") {
    for (const { level, bound } of bands) {
      const from = bound.od ?? 0;
      if (bound.do == null || bound.do - from + 1 <= MAX_FLOOR_ENUMERATION) continue;
      if (definitionsFromMeasure(measure)[level]) continue;
      issues.push(
        `Przedział poziomu „${LEVEL_LABEL[level]}” obejmuje więcej niż ${MAX_FLOOR_ENUMERATION} piętra i jest domknięty z góry — operaty nie mają na to zapisu. Zwęź go albo opisz poziom pośredni.`,
      );
    }
  }
  return issues;
}

type ScaledFeature = Pick<Feature, "rating" | "definitions">;

/** Levels with a non-blank definition, lowest first (ADR-016 reg. 1). */
export function describedLevels(feature: Pick<Feature, "definitions">): FeatureRating[] {
  return SCALE_ORDER.filter((level) => (feature.definitions?.[level] ?? "").trim() !== "");
}

/**
 * Where the rating sits in the described scale (ADR-016 reg. 2): of two
 * levels the lower is `min` and the higher `max`; of three, gorsza/przeciętna/
 * lepsza are min/mid/max. Null without a rating, on an undescribed level, or
 * on a scale of fewer than two levels.
 */
export function ratingPosition(feature: ScaledFeature): RatingPosition | null {
  if (feature.rating == null) return null;
  const levels = describedLevels(feature);
  const index = levels.indexOf(feature.rating);
  if (levels.length < 2 || index < 0) return null;
  if (index === 0) return "min";
  return index === levels.length - 1 ? "max" : "mid";
}

export type FeatureIssue = { code: "B-08" | "B-09" | "B-10"; label: string };

/** What stops the feature from entering the operat (I-10) — spec §4 catalogue copy. */
export function featureIssues(
  feature: Pick<Feature, "name" | "weight" | "rating" | "definitions">,
): FeatureIssue[] {
  const issues: FeatureIssue[] = [];
  const levels = describedLevels(feature);
  if (feature.rating == null) {
    issues.push({ code: "B-08", label: `Wybierz ocenę cechy „${feature.name}”.` });
  } else if (!levels.includes(feature.rating)) {
    issues.push({
      code: "B-09",
      label: `Ocena „${LEVEL_LABEL[feature.rating]}” cechy „${feature.name}” nie ma opisu w skali — opisz ten poziom albo zmień ocenę.`,
    });
  }
  if (feature.weight > 0 && levels.length < 2) {
    issues.push({
      code: "B-10",
      label: `Cecha „${feature.name}” musi mieć opisane co najmniej dwa poziomy.`,
    });
  }
  return issues;
}

/** The feature as the engine reads it, or null when its rating has no position. */
function placed(feature: Feature): Feature | null {
  const position = ratingPosition(feature);
  if (position) return { ...feature, rating: ENGINE_RATING[position] };
  // A weight-0 feature adds 0 to ΣUi whatever its key, so only a missing
  // rating stops it — its scale can stay unfinished (B-10 spares it too).
  return feature.weight === 0 && feature.rating != null ? feature : null;
}

/** The features as the engine reads them, or null when any cannot be placed (no WR). */
function engineFeatures(input: Pick<KcsInput, "features">): Feature[] | null {
  const mapped = input.features.map(placed);
  return mapped.every((f) => f != null) ? mapped : null;
}

/**
 * Ui per feature for the step-4 rows while the set is still incomplete: the
 * engine runs on the placeable features only (same formula, and the same
 * per-row rounding, so the printed rows add up to ΣUi — I-11), `null` marks a
 * feature without a position. Throws like the engine on an unusable sample.
 */
export function featureUis(input: KcsInput): Array<number | null> {
  const mapped = input.features.map(placed);
  const { ui } = computeKcs({ ...input, features: mapped.filter((f) => f != null) });
  let next = 0;
  return mapped.map((f) => (f ? ui[next++].value : null));
}

/** Whether every feature can feed the engine — the step-5 and prose guard. */
export function kcsReady(input: Pick<KcsInput, "features">): boolean {
  return engineFeatures(input) != null;
}

/**
 * `computeKcs` fed positions (ADR-016 reg. 2) — the one entry point for the
 * application; the engine stays the golden-tested core. Throws, like the
 * engine, when a feature cannot be placed. Ui rows carry the appraiser's own
 * rating, not the engine key its position maps to.
 */
export function computeKcsOnScale(input: KcsInput): KcsResult {
  const features = engineFeatures(input);
  if (!features) {
    throw new Error("KCS: every feature needs a rating on its described scale");
  }
  const result = computeKcs({ ...input, features });
  return {
    ...result,
    ui: result.ui.map((share, i) => ({ ...share, rating: input.features[i].rating })),
  };
}
