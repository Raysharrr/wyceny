import { suggestPairwiseMultiplier } from "./pairwise";
import type { Feature, PairwiseCell } from "./valuation-input";

/** A saved note is an exception rationale only while today's multiplier is an override. */
export function pairwiseOverrideReason(feature: Feature, cell: PairwiseCell): string | undefined {
  if (cell.rating == null || cell.multiplier == null) return undefined;
  const suggestion = suggestPairwiseMultiplier(
    feature.rating,
    cell.rating,
    feature.ratingScale ?? "three",
  );
  return cell.multiplier !== suggestion ? cell.overrideReason?.trim() || undefined : undefined;
}
