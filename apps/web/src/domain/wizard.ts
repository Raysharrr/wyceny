import type { KcsInput } from "./kcs";
import type { Valuation } from "../ports/valuation";

/** Wizard steps — labels are UI copy (Polish), mirror of mockup shared.jsx STEPS. */
export const WIZARD_STEPS = [
  { n: 1, label: "Przedmiot" },
  { n: 2, label: "Oględziny" },
  { n: 3, label: "Próba" },
  { n: 4, label: "Cechy" },
  { n: 5, label: "Kalkulacja" },
  { n: 6, label: "Opisy" },
  { n: 7, label: "Operat" },
] as const;

/**
 * Soft gating (spec decision 1): the furthest reachable step is DERIVED from
 * what the draft already holds — no separate progress state to migrate or
 * desync. Step 2 (photos) is an optional pass-through. Step 6 is NOT, and has
 * not been since ADR-014: it generates the operat's descriptive sections and
 * the F-4 gate refuses approval without them. The derivation below is
 * unchanged and still correct — step 6 opens once the calculation is
 * confirmed — only this comment had gone stale.
 */
export function maxReachedStep(v: Pick<Valuation, "status" | "wr" | "inputs">): number {
  if (v.status !== "in_progress" || v.wr != null) return 7;
  if ((v.inputs?.features?.length ?? 0) > 0) return 5;
  if ((v.inputs?.comparables?.length ?? 0) > 0) return 4;
  return 3;
}

export function resolveStep(param: string | undefined, max: number): number {
  const n = Number(param);
  if (!Number.isInteger(n) || n < 1) return max;
  return Math.min(n, max);
}

export function calculationReady(inputs: KcsInput | null): boolean {
  return inputs != null && inputs.comparables.length >= 3 && inputs.features.length > 0;
}
