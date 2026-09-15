import { LEVEL_LABEL } from "./feature-presets";
import { computeKcs, type Feature, type FeatureRating, type KcsInput, type KcsResult } from "./kcs";

/**
 * Rating scale of a feature (ADR-016, P5). The scale is the levels the
 * appraiser DESCRIBED — any two, or all three — and Ui follows the rating's
 * position in that scale. `computeKcs` itself is unchanged: this module maps
 * the position onto the engine's key before calling it. Pure (F-10).
 */

/** `inputs.featureScaleRule` value stamped by the step-4 save under this rule. */
export const FEATURE_SCALE_RULE = 2 as const;

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

/**
 * The features as the engine reads them, or null when any cannot be placed
 * (no WR). A snapshot without the rule marker keeps its fixed keys — it was
 * calculated, and maybe issued, under them. A weight-0 feature adds 0 to ΣUi
 * whatever its key, so only its missing rating stops the engine.
 */
function engineFeatures(input: Pick<KcsInput, "features" | "featureScaleRule">): Feature[] | null {
  if (input.featureScaleRule !== FEATURE_SCALE_RULE) {
    return input.features.every((f) => f.rating != null) ? input.features : null;
  }
  const mapped: Feature[] = [];
  for (const f of input.features) {
    const position = ratingPosition(f);
    if (position) mapped.push({ ...f, rating: ENGINE_RATING[position] });
    else if (f.weight === 0 && f.rating != null) mapped.push(f);
    else return null;
  }
  return mapped;
}

/** Whether every feature can feed the engine — the step-5 and prose guard. */
export function kcsReady(input: Pick<KcsInput, "features" | "featureScaleRule">): boolean {
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
