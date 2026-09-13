import { validateFeatures } from "./feature-rules";
import { computeKcs, type KcsResult } from "./kcs";
import { computePairwise, type PairwiseResult } from "./pairwise";
import { pairwiseBasis, VALUATION_SAMPLE_LIMITS } from "./pairwise-state";
import {
  resolveMethod,
  ValuationCalculationError,
  type CalculationIssue,
  type ValuationInput,
} from "./valuation-input";

export { resolveMethod } from "./valuation-input";
export { valuationComparables, VALUATION_SAMPLE_LIMITS } from "./pairwise-state";
export type { CalculationIssue } from "./valuation-input";
export type ValuationResult = ({ method: "kcs" } & KcsResult) | ({ method: "pp" } & PairwiseResult);

function kcsNumericIssues(input: ValuationInput): CalculationIssue[] {
  const issues: CalculationIssue[] = [];
  if (input.comparables.length === 0) {
    issues.push({
      path: "comparables",
      label: "Obliczenie KCS wymaga co najmniej jednej transakcji.",
    });
  }
  if (!Number.isFinite(input.area) || input.area <= 0) {
    issues.push({ path: "area", label: "Powierzchnia musi być skończona i dodatnia." });
  }
  input.comparables.forEach((row, i) => {
    if (!Number.isFinite(row.pricePerM2) || row.pricePerM2 <= 0) {
      issues.push({
        path: `comparables.${i}.pricePerM2`,
        label: "Cena za m² musi być skończona i dodatnia.",
      });
    }
    if (row.area !== undefined && (!Number.isFinite(row.area) || row.area <= 0)) {
      issues.push({
        path: `comparables.${i}.area`,
        label: "Powierzchnia porównania musi być skończona i dodatnia.",
      });
    }
  });
  return issues;
}

/** Arithmetic dispatcher. Operation readiness is an explicit, separate check below. */
export function computeValuation(input: ValuationInput): ValuationResult {
  const method = resolveMethod(input);
  if (method === "kcs" && input.method === undefined) {
    // AC10: exact historical behavior, including intermediate rounding and zero rows.
    return { method, ...computeKcs(input) };
  }
  const issues = validateFeatures(input.features);
  if (method === "kcs") issues.push(...kcsNumericIssues(input));
  if (issues.length) throw new ValuationCalculationError(issues);
  if (method === "pp") return { method, ...computePairwise(input) };
  const result = computeKcs({ ...input, features: input.features.filter((f) => f.weight > 0) });
  if (!Number.isFinite(result.wr) || !Number.isFinite(result.wrUnrounded)) {
    throw new ValuationCalculationError([
      { path: "area", label: "Wynik wyceny przekracza zakres obliczeń." },
    ]);
  }
  return { method, ...result };
}

/**
 * AC01–AC07: readiness for NEW calculation/approval operations. Never run on the
 * archived legacy signing path. Does not check provenance/owner/draft permissions.
 * Acyclic: validates engine arithmetic, engines never invoke operation readiness.
 */
export function calculationIssues(input: ValuationInput): CalculationIssue[] {
  const issues: CalculationIssue[] = [];
  let method;
  try {
    method = resolveMethod(input);
  } catch (error) {
    if (error instanceof ValuationCalculationError) return error.issues;
    throw error;
  }
  if (input.method === undefined || input.methodConfirmed !== true) {
    issues.push({ path: "method", label: "Wybierz i potwierdź metodę wyceny." });
  }
  issues.push(...validateFeatures(input.features));
  if (method === "kcs") {
    if (input.comparables.length < VALUATION_SAMPLE_LIMITS.kcs.min) {
      issues.push({ path: "comparables", label: "Metoda KCS wymaga co najmniej 12 transakcji." });
    }
    issues.push(...kcsNumericIssues(input));
  } else {
    if (!input.pairwise?.confirmedBasis || input.pairwise.confirmedBasis !== pairwiseBasis(input)) {
      issues.push({
        path: "pairwise.confirmedBasis",
        label: "Sprawdź i potwierdź aktualne oceny oraz poprawki porównań.",
      });
    }
    try {
      computePairwise(input);
    } catch (error) {
      if (error instanceof ValuationCalculationError) issues.push(...error.issues);
      else throw error;
    }
  }
  // Also catch numeric overflow in valid KCS data without changing its historic engine.
  if (method === "kcs" && issues.length === 0) {
    try {
      computeValuation(input);
    } catch (error) {
      if (error instanceof ValuationCalculationError) issues.push(...error.issues);
      else throw error;
    }
  }
  return issues.filter(
    (issue, i) =>
      issues.findIndex((other) => other.path === issue.path && other.label === issue.label) === i,
  );
}
