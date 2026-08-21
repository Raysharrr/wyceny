import {
  candidateKey,
  type Candidate,
  type Flag,
  type Rejected,
  type RejectReason,
  type Selection,
  type SelectionParams,
} from "./sample-selection";
import type { SubjectEgib } from "./egib-id";
import { applyManualRejections, type ManualRejection } from "./sample-manual";

/** Compact row for the "Odrzucone" section and the overview map (decision a, 2026-08-21): no full Candidate. */
export type RejectedRow = {
  transactionId: string;
  lokalId: string;
  reason: RejectReason;
  allReasons: RejectReason[];
  date: string;
  area: number;
  pricePerM2: number;
  distanceM: number;
  pos: { x: number; y: number } | null;
};

export function toRejectedRow(r: Rejected): RejectedRow {
  const c = r.candidate;
  return {
    transactionId: c.transactionId,
    lokalId: c.lokalId,
    reason: r.reason,
    allReasons: r.allReasons,
    date: c.date,
    area: c.area,
    pricePerM2: c.pricePerM2,
    distanceM: c.distanceM,
    pos: c.pos,
  };
}

/**
 * What step 3 persists in `inputs.sampleSelection` (D7, ADR-015): enough to
 * show badges and re-run the appraiser's choice, NOT the whole 3 km pool
 * (`ranking` is dropped — see {@link toSampleSelectionSnapshot}).
 */
export type SampleSelectionSnapshot = {
  version: 3;
  /** As computed by the domain — NEVER mutated by manual rejections (overlay in `manualRejections`). */
  proposed: Candidate[];
  alternates: Candidate[];
  /** Keyed by `candidateKey` — only for rows in `proposed` ∪ `alternates`. */
  flags: Record<string, Flag[]>;
  rejectedCounts: Partial<Record<RejectReason, number>>;
  /** Rows rejected by hygiene/band inside `radiusUsedM` (decision a). Optional: pre-Slice-3 snapshots lack it. */
  rejected?: RejectedRow[];
  /** Appraiser's overlay (Slice 3). Effective lists = {@link effectiveSelection}. Optional for the same reason. */
  manualRejections?: ManualRejection[];
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
 * persists: drops the full `ranking` (band-passing pool); keeps a COMPACT
 * `rejected` list — the appraiser's proposed/alternate rows plus enough
 * context (flags, radius, counts, params, rejected) to show badges and
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
    rejected: s.rejected.map(toRejectedRow),
    manualRejections: [],
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

/** The lists step 3 shows and `comparables` is assembled from: domain result + manual overlay. */
export function effectiveSelection(snap: SampleSelectionSnapshot) {
  return applyManualRejections(snap, snap.manualRejections ?? []);
}
