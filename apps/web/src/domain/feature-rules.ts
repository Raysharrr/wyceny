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

/** Polish decimal, no trailing zeros — the scale texts print whole m² today. */
function measureNumber(value: number): string {
  return String(value).replace(".", ",");
}

/**
 * The definition text of ONE band, in the wording the presets already print
 * (D-46 for piętro, the sample-median pair for powierzchnia) — this is the
 * only place a scale text is written, so a threshold edit and the preset can
 * never drift apart.
 */
export function definitionFromBounds(kind: FeatureMeasure["kind"], bound: MeasureBound): string {
  const { od, do: upper } = bound;
  if (kind === "area") {
    if (od == null && upper == null) return "";
    if (od == null) return `powierzchnia użytkowa poniżej ${measureNumber(upper!)} m²`;
    if (upper == null) return `powierzchnia użytkowa ${measureNumber(od)} m² i więcej`;
    return `powierzchnia użytkowa od ${measureNumber(od)} m² do ${measureNumber(upper)} m²`;
  }
  // Piętro: parter = 0, both edges inclusive.
  if (od == null && upper == null) return "";
  if (od == null) return upper === 0 ? "parter" : `do ${measureNumber(upper!)} piętra`;
  if (upper == null) return od === 0 ? "parter i wyżej" : `od ${measureNumber(od)} piętra`;
  if (od === 0 && upper === 0) return "parter";
  if (od === 0) return `parter i piętra do ${measureNumber(upper)}`;
  if (od === upper) return `${measureNumber(od)} piętro`;
  return `piętra od ${measureNumber(od)} do ${measureNumber(upper)}`;
}

/** Every band's definition text — what `Feature.definitions` must equal while `measure` stands. */
export function definitionsFromMeasure(
  measure: FeatureMeasure,
): Partial<Record<FeatureRating, string>> {
  const out: Partial<Record<FeatureRating, string>> = {};
  for (const level of SCALE_ORDER) {
    const bound = measure.bounds[level];
    if (bound) out[level] = definitionFromBounds(measure.kind, bound);
  }
  return out;
}

/**
 * The level a measured value falls into, or null when no band covers it — a
 * kondygnacja below parter, a blank field, a scale with a gap. Floor bands are
 * closed on both edges; area bands take `do` as the exclusive upper edge, so
 * exactly 47 m² belongs to the "47 m² i więcej" band and to no other.
 */
export function levelForValue(
  measure: FeatureMeasure,
  value: number | null | undefined,
): FeatureRating | null {
  if (value == null || !Number.isFinite(value)) return null;
  for (const level of SCALE_ORDER) {
    const bound = measure.bounds[level];
    if (!bound) continue;
    if (bound.od != null && value < bound.od) continue;
    if (bound.do != null && (measure.kind === "floor" ? value > bound.do : value >= bound.do))
      continue;
    return level;
  }
  return null;
}

/**
 * What stops the bands from being a scale (D-46, D-48): fewer than two bands,
 * an inverted band, an overlap, or a gap. Aneta's corrected area scale (do 40 /
 * 41–45 / od 46) is the worked example of the gap case.
 */
export function measureIssues(measure: FeatureMeasure): string[] {
  const issues: string[] = [];
  const bands = SCALE_ORDER.flatMap((level) => {
    const bound = measure.bounds[level];
    return bound ? [{ level, bound }] : [];
  });
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

  // Sorted by their lower edge — the value order, which for powierzchnia runs
  // opposite to the rating order (lepsza = the smaller flat).
  const sorted = [...bands].sort(
    (a, b) => (a.bound.od ?? Number.NEGATIVE_INFINITY) - (b.bound.od ?? Number.NEGATIVE_INFINITY),
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const prevEnd = prev.bound.do;
    const nextStart = next.bound.od;
    const pair = `„${LEVEL_LABEL[prev.level]}” i „${LEVEL_LABEL[next.level]}”`;
    if (prevEnd == null || nextStart == null) {
      issues.push(`Przedziały poziomów ${pair} nachodzą na siebie.`);
      continue;
    }
    // Floors are whole numbers, so the bands touch one storey apart; areas are
    // continuous, so they touch at the same number (`do` exclusive).
    const touching = measure.kind === "floor" ? prevEnd + 1 === nextStart : prevEnd === nextStart;
    if (touching) continue;
    const overlaps = measure.kind === "floor" ? nextStart <= prevEnd : nextStart < prevEnd;
    issues.push(
      overlaps
        ? `Przedziały poziomów ${pair} nachodzą na siebie.`
        : `Między przedziałami poziomów ${pair} jest luka.`,
    );
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
