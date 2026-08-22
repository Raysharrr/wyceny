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
import {
  applyManualOverlay,
  type ManualInclusion,
  type ManualRejection,
  type ReviewedMark,
} from "./sample-manual";

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

/** Cap on `rejected` rows kept PER REASON (jsonb size guard) — `rejectedCounts` stays the full census. */
export const REJECTED_PER_REASON = 50;

/** Nearest first (smallest `distanceM`); ties broken by newer `date` first. */
function compareForCap(a: Rejected, b: Rejected): number {
  if (a.candidate.distanceM !== b.candidate.distanceM) {
    return a.candidate.distanceM - b.candidate.distanceM;
  }
  if (a.candidate.date !== b.candidate.date) {
    return a.candidate.date > b.candidate.date ? -1 : 1;
  }
  return 0;
}

/**
 * Bounds `rejected` to the {@link REJECTED_PER_REASON} nearest rows per
 * reason — the "Odrzucone" section shows a representative sample, not the
 * whole 3 km pool; `rejectedCounts` (built from the untrimmed list) is the
 * census.
 */
function capRejected(rejected: Rejected[]): RejectedRow[] {
  const byReason = new Map<RejectReason, Rejected[]>();
  for (const r of rejected) {
    const bucket = byReason.get(r.reason);
    if (bucket) bucket.push(r);
    else byReason.set(r.reason, [r]);
  }
  const kept: RejectedRow[] = [];
  for (const bucket of byReason.values()) {
    const nearest = [...bucket].sort(compareForCap).slice(0, REJECTED_PER_REASON);
    for (const r of nearest) kept.push(toRejectedRow(r));
  }
  return kept;
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
  /**
   * Rows rejected by hygiene/band inside `radiusUsedM` (decision a).
   * `rejected` is a bounded sample for the "Odrzucone" section (nearest 50
   * per reason); `rejectedCounts` is the census. Optional: pre-Slice-3
   * snapshots lack it.
   */
  rejected?: RejectedRow[];
  /** Appraiser's overlay (Slice 3). Effective lists = {@link effectiveSelection}. Optional for the same reason. */
  manualRejections?: ManualRejection[];
  /** Appraiser's explicit additions outside the domain's proposal (Slice 3c). Full record per row — see {@link ManualInclusion}. Optional: pre-Slice-3c snapshots lack it. */
  manualInclusions?: ManualInclusion[];
  /** Review trail — informational only, never affects the sample (Slice 3c). Optional: pre-Slice-3c snapshots lack it. */
  reviewed?: ReviewedMark[];
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
 * persists: drops the full `ranking` (band-passing pool); keeps a COMPACT,
 * CAPPED `rejected` sample (nearest {@link REJECTED_PER_REASON} per reason —
 * see {@link capRejected}) — the appraiser's proposed/alternate rows plus
 * enough context (flags, radius, counts, params, rejected) to show badges
 * and re-run the choice later, without carrying the whole 3 km pool into a
 * jsonb column.
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
    rejected: capRejected(s.rejected),
    manualRejections: [],
    manualInclusions: [],
    reviewed: [],
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

/** The lists step 3 shows and `comparables` is assembled from: domain result + manual overlay (rejections and inclusions). */
export function effectiveSelection(snap: SampleSelectionSnapshot) {
  return applyManualOverlay(snap, {
    rejections: snap.manualRejections ?? [],
    inclusions: snap.manualInclusions ?? [],
  });
}

/**
 * Review-trail counters for the "Przejrzano X z Y" indicator. `total` is the
 * EFFECTIVE row count (proposed + alternates + removed, after the manual
 * overlay) — not the raw domain output. `reviewed` counts only `snap.reviewed`
 * keys that still exist among those rows; a mark for a row the appraiser
 * later rejected/re-radiused away no longer counts. Purely informational —
 * never gates anything.
 */
export function reviewStats(snap: SampleSelectionSnapshot): {
  reviewed: number;
  total: number;
  reviewedKeys: Set<string>;
} {
  const eff = effectiveSelection(snap);
  const effKeys = new Set([...eff.proposed, ...eff.alternates, ...eff.removed].map(candidateKey));
  const total = eff.proposed.length + eff.alternates.length + eff.removed.length;
  const reviewedKeys = new Set(
    (snap.reviewed ?? []).map(candidateKey).filter((k) => effKeys.has(k)),
  );
  return { reviewed: reviewedKeys.size, total, reviewedKeys };
}
