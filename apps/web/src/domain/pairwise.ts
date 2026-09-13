import { allowedRatings, featureCalculationIssues } from "./feature-rules";
import { comparableIdentity, valuationComparables } from "./pairwise-state";
import {
  resolveMethod,
  ValuationCalculationError,
  type CalculationIssue,
  type FeatureRating,
  type RatingScale,
  type ValuationInput,
} from "./valuation-input";

export type PairwiseCorrection = {
  featureKey: string;
  weight: number;
  range: number;
  multiplier: number;
  amount: number;
};
export type PairwisePair = {
  comparableId: string;
  pricePerM2: number;
  corrections: PairwiseCorrection[];
  totalCorrection: number;
  correctedPrice: number;
};
export type PairwiseResult = {
  cmin: number;
  cmax: number;
  priceSpread: number;
  pairs: PairwisePair[];
  unitValue: number;
  wrUnrounded: number;
  wr: number;
};

/** D-AUTO: an explicit suggestion, not a confirmed expert assessment. */
export function suggestPairwiseMultiplier(
  subject: FeatureRating,
  comparable: FeatureRating,
  scale: RatingScale,
): number {
  const levels = allowedRatings({ name: "", weight: 0, rating: subject, ratingScale: scale });
  const subjectIndex = levels.indexOf(subject);
  const comparableIndex = levels.indexOf(comparable);
  if (subjectIndex < 0 || comparableIndex < 0) {
    throw new ValuationCalculationError([
      { path: "rating", label: "Ocena nie należy do wybranej skali." },
    ]);
  }
  // allowedRatings is highest-first, so better subject => positive correction.
  return (comparableIndex - subjectIndex) / (levels.length - 1);
}

/**
 * AC07/F-2: arithmetic on SAVED prices, with no intermediate rounding. Neither
 * method confirmation nor matrix confirmation belongs to this pure engine.
 * Catalog/name/definition policy belongs to validateFeatures, not reference math.
 */
export function computePairwise(input: ValuationInput): PairwiseResult {
  if (resolveMethod(input) !== "pp") {
    throw new ValuationCalculationError([
      { path: "method", label: "Silnik PP wymaga metody porównywania parami." },
    ]);
  }
  const comparables = valuationComparables(input);
  const issues: CalculationIssue[] = featureCalculationIssues(input.features);
  if (!Number.isFinite(input.area) || input.area <= 0) {
    issues.push({ path: "area", label: "Powierzchnia musi być skończona i dodatnia." });
  }
  comparables.forEach((row) => {
    if (!Number.isFinite(row.pricePerM2) || row.pricePerM2 <= 0) {
      issues.push({
        path: `comparables.${input.comparables.indexOf(row)}.pricePerM2`,
        label: "Cena za m² musi być skończona i dodatnia.",
      });
    }
    if (row.area !== undefined && (!Number.isFinite(row.area) || row.area <= 0)) {
      issues.push({
        path: `comparables.${input.comparables.indexOf(row)}.area`,
        label: "Powierzchnia porównania musi być skończona i dodatnia.",
      });
    }
  });
  const keys = new Set<string>();
  input.features.forEach((f, i) => {
    if (!f.key?.trim() || keys.has(f.key)) {
      issues.push({
        path: `features.${i}.key`,
        label: "PP wymaga jawnych, unikalnych kluczy cech.",
      });
    }
    if (f.key) keys.add(f.key);
  });
  const features = input.features.filter((f) => f.weight > 0);
  comparables.forEach((row) => {
    const id = comparableIdentity(row)!;
    features.forEach((feature) => {
      const key = feature.key!;
      const cell = input.pairwise?.comparisons[id]?.[key];
      const path = `pairwise.comparisons.${id}.${key}`;
      const validRating = cell?.rating != null && allowedRatings(feature).includes(cell.rating);
      if (!validRating)
        issues.push({
          path: `${path}.rating`,
          label: "Uzupełnij ocenę transakcji zgodnie ze skalą cechy.",
        });
      if (cell?.multiplier == null || !Number.isFinite(cell.multiplier)) {
        issues.push({
          path: `${path}.multiplier`,
          label: "Uzupełnij skończony mnożnik poprawki (zero jest dozwolone).",
        });
      } else if (validRating && allowedRatings(feature).includes(feature.rating)) {
        const suggestion = suggestPairwiseMultiplier(
          feature.rating,
          cell.rating!,
          feature.ratingScale ?? "three",
        );
        if (cell.multiplier !== suggestion && !cell.overrideReason?.trim()) {
          issues.push({
            path: `${path}.overrideReason`,
            label: "Uzasadnij mnożnik różny od podpowiedzi.",
          });
        }
      }
    });
  });
  if (issues.length) throw new ValuationCalculationError(issues);

  const prices = comparables.map((row) => row.pricePerM2);
  const cmin = Math.min(...prices);
  const cmax = Math.max(...prices);
  const priceSpread = cmax - cmin;
  const pairs = comparables.map((row) => {
    const comparableId = comparableIdentity(row)!;
    const corrections = features.map((feature) => {
      const featureKey = feature.key!;
      const multiplier = input.pairwise!.comparisons[comparableId][featureKey].multiplier!;
      const range = priceSpread * feature.weight;
      return { featureKey, weight: feature.weight, range, multiplier, amount: range * multiplier };
    });
    const totalCorrection = corrections.reduce((sum, correction) => sum + correction.amount, 0);
    const correctedPrice = row.pricePerM2 + totalCorrection;
    if (!Number.isFinite(correctedPrice) || correctedPrice <= 0) {
      issues.push({
        path: `pairwise.comparisons.${comparableId}`,
        label: "Cena po korekcie musi być skończona i dodatnia.",
      });
    }
    return {
      comparableId,
      pricePerM2: row.pricePerM2,
      corrections,
      totalCorrection,
      correctedPrice,
    };
  });
  const unitValue = pairs.reduce((sum, pair) => sum + pair.correctedPrice, 0) / pairs.length;
  const wrUnrounded = unitValue * input.area;
  const wr = Math.round(wrUnrounded / 100) * 100;
  if (!Number.isFinite(wrUnrounded) || !Number.isFinite(wr)) {
    issues.push({ path: "area", label: "Wynik wyceny przekracza zakres obliczeń." });
  }
  if (issues.length) throw new ValuationCalculationError(issues);
  return { cmin, cmax, priceSpread, pairs, unitValue, wrUnrounded, wr };
}
