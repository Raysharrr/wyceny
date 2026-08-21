import {
  candidateKey,
  type Candidate,
  type Flag,
  type RejectReason,
  type Selection,
  type SelectionParams,
} from "./sample-selection";
import type { SubjectEgib } from "./egib-id";

/**
 * What step 3 persists in `inputs.sampleSelection` (D7, ADR-015): enough to
 * show badges and re-run the appraiser's choice, NOT the whole 3 km pool
 * (`ranking`/`rejected` are dropped — see {@link toSampleSelectionSnapshot}).
 */
export type SampleSelectionSnapshot = {
  version: 3;
  proposed: Candidate[];
  alternates: Candidate[];
  /** Keyed by `candidateKey` — only for rows in `proposed` ∪ `alternates`. */
  flags: Record<string, Flag[]>;
  rejectedCounts: Partial<Record<RejectReason, number>>;
  radiusUsedM: number;
  radiusWalk: Selection["radiusWalk"];
  counts: Selection["counts"];
  params: {
    subjectArea: number;
    /** "YYYY-MM" — the valuation month the selection was run for. */
    todayMonth: string;
    subjectEgib?: SubjectEgib;
    radiusOverrideM?: number;
  };
};

/**
 * Trims a `Selection` (domain/sample-selection.ts) down to what the wizard
 * persists: drops the full `ranking` (band-passing pool) and the `rejected`
 * list (kept only as per-reason counts) — the appraiser's proposed/alternate
 * rows plus enough context (flags, radius, counts, params) to show badges and
 * re-run the choice later, without carrying the whole 3 km pool into a jsonb
 * column.
 */
export function toSampleSelectionSnapshot(
  s: Selection,
  p: SelectionParams,
): SampleSelectionSnapshot {
  const keep = new Set([...s.proposed, ...s.alternates].map(candidateKey));
  const flags: Record<string, Flag[]> = {};
  for (const [k, v] of Object.entries(s.flags)) {
    if (keep.has(k)) flags[k] = v;
  }
  const rejectedCounts: Partial<Record<RejectReason, number>> = {};
  for (const r of s.rejected) {
    rejectedCounts[r.reason] = (rejectedCounts[r.reason] ?? 0) + 1;
  }
  return {
    version: 3,
    proposed: s.proposed,
    alternates: s.alternates,
    flags,
    rejectedCounts,
    radiusUsedM: s.radiusUsedM,
    radiusWalk: s.radiusWalk,
    counts: s.counts,
    params: {
      subjectArea: p.subjectArea,
      todayMonth: p.todayMonth,
      ...(p.subjectEgib ? { subjectEgib: p.subjectEgib } : {}),
      ...(p.radiusOverrideM !== undefined ? { radiusOverrideM: p.radiusOverrideM } : {}),
    },
  };
}
