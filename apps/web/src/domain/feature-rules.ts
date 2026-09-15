import { LEVEL_LABEL } from "./feature-presets";
import { computeKcs, type Feature, type FeatureRating, type KcsInput, type KcsResult } from "./kcs";

/**
 * Rating scale of a feature (ADR-016, P5). The scale is the levels the
 * appraiser DESCRIBED — any two, or all three — and Ui follows the rating's
 * position in that scale. One path: this module maps the position onto the
 * engine's key before calling it, always. Pure (F-10).
 */

export type RatingPosition = "min" | "mid" | "max";

/** Scale order, lowest first (ADR-016 reg. 1). */
const SCALE_ORDER: FeatureRating[] = ["gorsza", "przecietna", "lepsza"];

/** The engine's key for a position — the formula reads gorsza as w·Vmin, przeciętna as w, lepsza as w·Vmax. */
const ENGINE_RATING: Record<RatingPosition, FeatureRating> = {
  min: "gorsza",
  mid: "przecietna",
  max: "lepsza",
};

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
