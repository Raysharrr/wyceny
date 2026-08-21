"use client";

import { useState } from "react";
import type { UseFormSetValue } from "react-hook-form";
import type { z } from "zod";
import { sampleStepSchema } from "@/app/actions/wizard-schemas";
import { reselectSample } from "@/app/actions/reselect-sample";
import { buildingKey, candidateKey, type Candidate } from "@/domain/sample-selection";
import type {
  ManualInclusion,
  ManualRejection,
  ManualRejectionReason,
  ReviewedMark,
} from "@/domain/sample-manual";
import {
  effectiveSelection,
  reviewStats as computeReviewStats,
  type SampleSelectionSnapshot,
} from "@/domain/sample-snapshot";
import type { StreetViewSnapshot } from "@/domain/street-view-snapshot";

/** `reselectSample`'s radius union — mirrors `ReselectSampleInput["radiusOverrideM"]` in `@/app/actions/reselect-sample`. */
type RadiusM = 500 | 1000 | 2000 | 3000;

type FormInput = z.input<typeof sampleStepSchema>;
type ComparableRow = FormInput["comparables"][number];

/**
 * A fetched candidate → the `comparables` form-row shape (Task 9's ACL).
 * Shared by `step-sample.tsx`'s `onFetchSample` (the server's `{date, area,
 * pricePerM2, transactionId}` proposal rows) and `syncComparables` below
 * (the domain's `Candidate`, a superset of those same four fields) — one
 * place for the "round RCN's raw floats to 2 decimals before they hit an
 * input" rule, so a manual rejection's backfill can't drift from a fresh
 * fetch's.
 */
export function rcnRow(t: {
  date: string;
  area: number;
  pricePerM2: number;
  transactionId: string;
  lokalId: string;
}): ComparableRow {
  return {
    date: t.date,
    area: String(Math.round(t.area * 100) / 100),
    pricePerM2: String(Math.round(t.pricePerM2 * 100) / 100),
    source: "rcn" as const,
    transactionId: t.transactionId,
    lokalId: t.lokalId,
  };
}

/**
 * Rebuilds `comparables` from the EFFECTIVE proposal (domain result + manual
 * overlay) — RCN rows first, any row that isn't `source: "rcn"` (hand-added
 * with `source: "manual"`, a row still mid-edit with NO `source` at all
 * because the appraiser hasn't saved yet, or a leftover from before the
 * last fetch) kept AFTER them rather than dropped. Shared by reject/restore
 * (`syncComparables`) and the radius handler (`onRadius`) so both apply the
 * IDENTICAL predicate — review round 1, Important #1 (2026-08-21): an
 * earlier version of the radius handler used `c.source && c.source !==
 * "rcn"`, which silently deleted a hand-added row still missing its
 * `source` (e.g. right after "Dodaj transakcję", before any save round-trip
 * gives it one) on every radius click.
 *
 * For each effective proposed candidate, an EXISTING `currentRows` entry
 * for the SAME lokal (and `source === "rcn"`) is kept as-is — not rebuilt
 * from `rcnRow(c)` — so a price/date/area the appraiser typed into that row
 * survives a reject/restore/radius resync (final wave, A1: data loss = PR
 * gate). A candidate with no such row (freshly backfilled from alternates,
 * or new after a radius change) gets a fresh `rcnRow(c)`. A row that LEAVES
 * the effective proposal (rejected, or bumped back to alternates) is
 * dropped here exactly as before — it's neither in `nextEff.proposed` nor
 * `source !== "rcn"`, so nothing carries it forward.
 *
 * "Same lokal" is `candidateKey` (`transactionId|lokalId`), NOT
 * `transactionId` alone (runtime bug, team-lead 2026-08-21, Heweliusza
 * 3/43): one notarial act can carry SEVERAL lokale (`proposed[1]`/`[2]` two
 * different units of the same act), and a `transactionId`-only key
 * collapsed both onto whichever row a `Map` happened to keep last — every
 * row for that act then printed the SAME price/area. `currentRows` from an
 * OLDER draft (saved before `lokalId` existed on the form row) falls back to
 * {@link matchLegacyRow} — content, never position (wave 4, C1 root cause
 * #2): an earlier per-`transactionId` FIFO queue assumed the Nth legacy row
 * for an act was the Nth candidate for it in RANKING order, but ranking
 * order can differ from the order the rows were originally written (e.g.
 * after a first reject re-sorts the effective proposal) — the queue could
 * hand candidate B a row that actually belonged to candidate A. Content
 * matching only regenerates via `rcnRow` when there's genuine ambiguity
 * (zero or 2+ legacy rows with identical date/area/price for that
 * `transactionId`), never by guessing position. Legacy rows are claimed
 * from a pool CONSUMED as `nextEff.proposed` is walked (wave 6) — proposal
 * order is claim order, and a row `matchLegacyRow` returns is spliced out
 * immediately, so the SAME row object can never satisfy two candidates.
 */
function rebuildComparables(
  snap: SampleSelectionSnapshot,
  currentRows: ComparableRow[],
): ComparableRow[] {
  const nextEff = effectiveSelection(snap);
  const currentRcnRows = currentRows.filter(
    (c): c is ComparableRow & { transactionId: string } => c.source === "rcn" && !!c.transactionId,
  );
  const byCandidateKey = new Map(
    currentRcnRows
      .filter((c): c is typeof c & { lokalId: string } => !!c.lokalId)
      .map(
        (c) => [candidateKey({ transactionId: c.transactionId, lokalId: c.lokalId }), c] as const,
      ),
  );
  // Mutable pool, CONSUMED as rows are claimed (wave 6) — one legacy row
  // can never be handed to two candidates. Static per-transactionId
  // candidate counts (from the PROPOSAL, not the shrinking pool) decide
  // whether the "one row, safe to reuse without a content check" shortcut
  // even applies for a given transactionId — see matchLegacyRow's doc.
  const unclaimedLegacyRows: ComparableRow[] = currentRcnRows.filter((c) => !c.lokalId);
  const candidatesForTx = new Map<string, number>();
  for (const c of nextEff.proposed) {
    candidatesForTx.set(c.transactionId, (candidatesForTx.get(c.transactionId) ?? 0) + 1);
  }
  const manualRows = currentRows.filter((c) => c.source !== "rcn");
  return [
    ...nextEff.proposed.map((c) => {
      const byKey = byCandidateKey.get(candidateKey(c));
      if (byKey) return byKey;
      const matched = matchLegacyRow(
        c,
        unclaimedLegacyRows,
        candidatesForTx.get(c.transactionId) ?? 0,
      );
      if (!matched) return rcnRow(c);
      unclaimedLegacyRows.splice(unclaimedLegacyRows.indexOf(matched), 1);
      return matched;
    }),
    ...manualRows,
  ];
}

/** Same rounding `rcnRow` applies before a number ever reaches the form. */
function roundedString(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Upserts a review-trail mark for `entity` (Slice 3c) — replaces any
 * existing mark with the same `candidateKey` instead of appending a
 * duplicate: `reviewStats` (domain/sample-snapshot.ts) only cares about SET
 * membership of `reviewedKeys`, so a second mark for the same row is not a
 * history worth keeping, just noise in the persisted jsonb.
 */
function withReviewed(
  reviewed: readonly ReviewedMark[] | undefined,
  entity: Pick<Candidate, "transactionId" | "lokalId">,
  at: string,
): ReviewedMark[] {
  const key = candidateKey(entity);
  const rest = (reviewed ?? []).filter((r) => candidateKey(r) !== key);
  return [...rest, { transactionId: entity.transactionId, lokalId: entity.lokalId, at }];
}

/**
 * Matches a LEGACY row (no `lokalId` — a draft saved before that field
 * existed on the form row) to a candidate by transaction id + CONTENT, since
 * position can't be trusted (see {@link rebuildComparables}'s doc comment).
 *
 * A SINGLE legacy row for this `transactionId` cannot belong to another
 * lokal — there is no other row to confuse it with — so it is reused
 * AS-IS, edits included, no content check needed (wave 5). BUT that
 * shortcut only holds when the transactionId is ALSO unambiguous on the
 * CANDIDATE side: `candidatesForTx` (how many candidates of this
 * `transactionId` sit in the effective proposal, precomputed by the
 * caller) must be exactly 1 too (wave 6) — one saved row plus TWO
 * candidates of the same act is still ambiguous (which of the two does it
 * belong to?), and the caller calls `matchLegacyRow` once per candidate
 * from a SHARED, CONSUMED pool, so an unconditional single-row shortcut
 * would have handed the SAME row object to both (the exact C1 shape:
 * B prints A's data). Content decides whenever either side has 2+:
 * a row counts as a match only when its `date`/`area`/`pricePerM2` strings
 * are identical to what `rcnRow(candidate)` would itself produce (same
 * rounding) — exactly one match reuses that object, zero or 2+ falls back
 * to `rcnRow(candidate)`.
 *
 * Trade-off, accepted (only pre-`lokalId` drafts can hit it, and only for
 * an AMBIGUOUS multi-lokal act — never a single-lokal, single-candidate
 * act): an EDITED row that content-matching can no longer place is lost on
 * the next resync. Never hands a candidate ANOTHER lokal's row just
 * because a queue slot lined up, which is the exact shape of the original
 * data-loss bug — the caller's row-consumption on top of this function
 * closes the last gap where the SAME row could satisfy two independent
 * calls.
 */
export function matchLegacyRow(
  candidate: { transactionId: string; date: string; area: number; pricePerM2: number },
  legacyRows: readonly ComparableRow[],
  candidatesForTx: number,
): ComparableRow | undefined {
  const sameTx = legacyRows.filter((r) => r.transactionId === candidate.transactionId);
  if (sameTx.length === 1 && candidatesForTx === 1) return sameTx[0];
  const wantArea = roundedString(candidate.area);
  const wantPrice = roundedString(candidate.pricePerM2);
  const matches = sameTx.filter(
    (r) => r.date === candidate.date && r.area === wantArea && r.pricePerM2 === wantPrice,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Step-3 candidate review state (Task 7): which candidate the side panel is
 * showing, and the reject/restore handlers that write the appraiser's
 * manual overlay into `sampleSelection` and resync `comparables` from the
 * EFFECTIVE proposal. Split out of `step-sample.tsx` purely to keep that
 * file's own length down — every piece here is still tightly coupled to
 * that step's form (`control`/`setValue`/`replaceComparables` come from its
 * `useForm`/`useFieldArray`), so this is a co-located hook, not a
 * general-purpose one.
 */
export function useSampleReview({
  valuationId,
  sel,
  comparables,
  setValue,
  replaceComparables,
  liveStreetView,
}: {
  valuationId: string;
  sel: SampleSelectionSnapshot | null | undefined;
  comparables: ComparableRow[] | undefined;
  setValue: UseFormSetValue<FormInput>;
  replaceComparables: (rows: ComparableRow[]) => void;
  liveStreetView: StreetViewSnapshot | null | undefined;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isReselecting, setIsReselecting] = useState(false);
  // Missing pool cache (draft predates Slice 3, or storage cleared) — the
  // radius buttons stay disabled until a fresh "Pobierz próbę z RCN" fetch
  // re-populates it (team-lead condition 1, 2026-08-21: never a silent
  // re-selection on an empty pool).
  const [poolMissing, setPoolMissing] = useState(false);
  const [reselectError, setReselectError] = useState<string | null>(null);

  // Domain result + manual overlay (Task 1).
  const eff = sel ? effectiveSelection(sel) : null;

  // Ranking order (proposed then alternates) — the panel's "Propozycja N z
  // total" header and its ↑/↓/Zostaw "next" walk both index into this same
  // list (mirrors `SampleTable`'s own `keys`), so the two stay consistent by
  // construction instead of drifting apart under separate bookkeeping.
  const combined = eff ? [...eff.proposed, ...eff.alternates] : [];
  const selectedIndex = selectedKey
    ? combined.findIndex((c) => candidateKey(c) === selectedKey)
    : -1;
  const selectedCandidate = selectedIndex >= 0 ? combined[selectedIndex] : null;
  const isProposedSelected =
    eff !== null && selectedIndex >= 0 && selectedIndex < eff.proposed.length;

  const streetViewEntryFor = (c: Candidate) => {
    const b = buildingKey(c);
    return b ? liveStreetView?.[b] : undefined;
  };

  /**
   * After a reject/restore, rebuilds `comparables` from the EFFECTIVE
   * proposal via the shared {@link rebuildComparables}. `onFetchSample`
   * deliberately does NOT go through this: a fresh proposal has no
   * `manualRejections` yet, so the result would be identical, just via an
   * extra read of not-yet-committed form state.
   */
  const syncComparables = (snap: SampleSelectionSnapshot) => {
    replaceComparables(rebuildComparables(snap, comparables ?? []));
  };

  /** Panel's "Zostaw" — advances to the next candidate in ranking order; past the last, closes the panel. */
  const next = () => {
    if (selectedIndex < 0) return;
    const nextCandidate = combined[selectedIndex + 1];
    setSelectedKey(nextCandidate ? candidateKey(nextCandidate) : null);
  };

  /**
   * Panel's "Potwierdź odrzucenie" — records the appraiser's own rejection
   * (overlay only, the domain's `proposed`/`alternates` are never mutated),
   * marks the row reviewed (rejecting it IS reviewing it), resyncs
   * `comparables`, and follows the selection to whoever now occupies the
   * SAME ranking slot (the candidate that backfilled it, or the next one
   * along if nothing did, or closes the panel when the ranking has run
   * out). Leaves `manualInclusions` untouched even when the rejected row is
   * itself a manual inclusion (controller ruling, Task 1 review round 2) —
   * the domain overlay puts such a row into `removed` (rejection beats
   * inclusion), and a later `include` of the same key deletes the
   * rejection to bring it back.
   */
  const reject = ({ reason, note }: { reason: ManualRejectionReason; note?: string }) => {
    if (!sel || !selectedCandidate) return;
    const m: ManualRejection = {
      transactionId: selectedCandidate.transactionId,
      lokalId: selectedCandidate.lokalId,
      reason,
      ...(note ? { note } : {}),
      at: new Date().toISOString(),
    };
    const newSel: SampleSelectionSnapshot = {
      ...sel,
      manualRejections: [...(sel.manualRejections ?? []), m],
      reviewed: withReviewed(sel.reviewed, selectedCandidate, m.at),
    };
    setValue("sampleSelection", newSel, { shouldDirty: true });
    syncComparables(newSel);
    const newEff = effectiveSelection(newSel);
    const replacement = [...newEff.proposed, ...newEff.alternates][selectedIndex];
    setSelectedKey(replacement ? candidateKey(replacement) : null);
  };

  /**
   * "Przywróć" in the "Odrzucone" section — drops one manual rejection,
   * marks the row reviewed (restoring it is itself a reviewed decision),
   * and resyncs `comparables`. `m` already carries `transactionId`/`lokalId`
   * (it's the `ManualRejection` row itself), so no candidate lookup is
   * needed.
   */
  const restore = (m: ManualRejection) => {
    if (!sel) return;
    const key = candidateKey(m);
    const newSel: SampleSelectionSnapshot = {
      ...sel,
      manualRejections: (sel.manualRejections ?? []).filter((x) => candidateKey(x) !== key),
      reviewed: withReviewed(sel.reviewed, m, new Date().toISOString()),
    };
    setValue("sampleSelection", newSel, { shouldDirty: true });
    syncComparables(newSel);
  };

  /**
   * Looks up a `Candidate` by `candidateKey` among the rows the appraiser
   * can currently see and act on — `effectiveSelection`'s three lists
   * (proposed, alternates, removed). Mirrors {@link reviewStats}'s own
   * scope (`effKeys`): the bulk auto-rejected `snap.rejected` sample is
   * deliberately OUT of scope for review/inclusion — it's a census, not a
   * one-by-one decision list.
   */
  const findEffCandidate = (key: string): Candidate | undefined =>
    eff
      ? [...eff.proposed, ...eff.alternates, ...eff.removed].find((c) => candidateKey(c) === key)
      : undefined;

  /**
   * Which section a row is CURRENTLY sitting in, per the effective overlay.
   * Independent from "is this a manual inclusion" (that must be read off
   * `sel.manualInclusions` directly — controller ruling, Task 1 review round
   * 2 — never off `effectiveSelection(...).included`, which only lists
   * additions BEYOND the ranked list).
   */
  const statusOf = (key: string): "proposed" | "alternate" | "rejected" | null => {
    if (!eff) return null;
    if (eff.proposed.some((c) => candidateKey(c) === key)) return "proposed";
    if (eff.alternates.some((c) => candidateKey(c) === key)) return "alternate";
    if (eff.removed.some((c) => candidateKey(c) === key)) return "rejected";
    return null;
  };
  const selectedStatus = selectedKey ? statusOf(selectedKey) : null;

  /**
   * List's "w próbie" checkbox / row action (Slice 3c) — records the
   * appraiser's explicit addition of `key` to `manualInclusions`
   * (idempotent: a key already present is not duplicated) and marks it
   * reviewed. If `key` currently carries a manual rejection, that rejection
   * is deleted first (restore + add, same instant) — the selection stays on
   * the SAME row, which now reads from "Odrzucone"/"Alternatywy" into "W
   * próbie" (brief, Task 2). The candidate payload is read off whichever of
   * `effectiveSelection`'s three lists currently holds `key` — including
   * `removed`, so including a row the appraiser had rejected moments ago
   * reconstructs its full `Candidate`, not just the key.
   */
  const include = (key: string) => {
    if (!sel) return;
    const source = findEffCandidate(key);
    if (!source) return;
    const now = new Date().toISOString();
    const alreadyIncluded = (sel.manualInclusions ?? []).some((m) => candidateKey(m) === key);
    const inclusion: ManualInclusion = {
      transactionId: source.transactionId,
      lokalId: source.lokalId,
      at: now,
      candidate: source,
    };
    const newSel: SampleSelectionSnapshot = {
      ...sel,
      manualRejections: (sel.manualRejections ?? []).filter((r) => candidateKey(r) !== key),
      manualInclusions: alreadyIncluded
        ? (sel.manualInclusions ?? [])
        : [...(sel.manualInclusions ?? []), inclusion],
      reviewed: withReviewed(sel.reviewed, source, now),
    };
    setValue("sampleSelection", newSel, { shouldDirty: true });
    syncComparables(newSel);
  };

  /**
   * Marks `key` reviewed only — no rejection/inclusion change, no
   * `comparables` resync (nothing about the sample itself changed). Looked
   * up via {@link findEffCandidate} since `ReviewedMark` needs
   * `transactionId`/`lokalId` separately, not just the combined key.
   */
  const markReviewed = (key: string) => {
    if (!sel) return;
    const entity = findEffCandidate(key);
    if (!entity) return;
    const newSel: SampleSelectionSnapshot = {
      ...sel,
      reviewed: withReviewed(sel.reviewed, entity, new Date().toISOString()),
    };
    setValue("sampleSelection", newSel, { shouldDirty: true });
  };

  /** List's "Pomiń" — same action as {@link markReviewed}, exposed under the button's own name (Slice 3c, Tasks 3–5). */
  const skip = markReviewed;

  /** List's "Zostaw" — marks the panel's currently selected row reviewed, then advances via {@link next} (Slice 3c: reviewed + next). */
  const keep = () => {
    if (selectedKey) markReviewed(selectedKey);
    next();
  };

  /** "Przejrzano X z Y" (domain/sample-snapshot.ts) for the panel's own `sel`, or a zeroed shape before any selection exists. */
  const reviewStats = sel
    ? computeReviewStats(sel)
    : { reviewed: 0, total: 0, reviewedKeys: new Set<string>() };

  /**
   * Radius button (Task 8) — re-runs the DOMAIN selection on the pool
   * `getSampleProposal` already cached (`reselectSample`, no second WFS
   * call), carrying the CURRENT `manualRejections` so they survive the
   * radius change (same candidateKey). `comparables` is rebuilt via the
   * SAME shared {@link rebuildComparables} reject/restore uses — from the
   * EFFECTIVE new proposal (domain result + the carried `manualRejections`),
   * not from `result.proposal.comparables` (the raw domain output), so a
   * carried rejection whose key still matches a row in the new `proposed`
   * is excluded here exactly as it is in the banner/table (both read via
   * `effectiveSelection`).
   *
   * `pool_missing` (no cached pool) and `pool_stale` (the cached pool's
   * `savedFor` no longer matches the valuation's current address/area — a
   * step-1 edit since the last fetch, review round 1 Important #2) are
   * treated identically: both disable the radius buttons until a fresh
   * "Pobierz próbę z RCN" re-populates the cache.
   */
  const onRadius = async (radiusM: RadiusM) => {
    if (!sel) return;
    setIsReselecting(true);
    setReselectError(null);
    try {
      const result = await reselectSample({
        valuationId,
        radiusOverrideM: radiusM,
        manualRejections: sel.manualRejections ?? [],
      });
      if ("error" in result) {
        if (result.code === "pool_missing" || result.code === "pool_stale") setPoolMissing(true);
        setReselectError(result.error);
        return;
      }
      setPoolMissing(false);
      const newSel = result.proposal.sampleSelection;
      setValue("sampleSelection", newSel, { shouldDirty: true });
      setValue("sampleMeta", result.proposal.sampleMeta, { shouldDirty: true });
      setValue("streetView", result.proposal.streetView, { shouldDirty: true });
      replaceComparables(rebuildComparables(newSel, comparables ?? []));
      // A fresh selection may no longer contain the candidate the panel was
      // showing — mirrors `onFetchSample` closing the panel on a new pool.
      setSelectedKey(null);
    } finally {
      setIsReselecting(false);
    }
  };

  /** Clears the reselect error banner — called alongside `setPoolMissing(false)` when a fresh "Pobierz próbę z RCN" fetch succeeds (review round 1, minor #2). */
  const clearReselectError = () => setReselectError(null);

  return {
    eff,
    combined,
    selectedKey,
    setSelectedKey,
    selectedIndex,
    selectedCandidate,
    isProposedSelected,
    streetViewEntryFor,
    next,
    reject,
    restore,
    include,
    skip,
    keep,
    markReviewed,
    reviewStats,
    statusOf,
    selectedStatus,
    isReselecting,
    poolMissing,
    setPoolMissing,
    reselectError,
    clearReselectError,
    onRadius,
  };
}
