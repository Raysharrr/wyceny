"use client";

import { useState } from "react";
import type { UseFormSetValue } from "react-hook-form";
import type { z } from "zod";
import { sampleStepSchema } from "@/app/actions/wizard-schemas";
import { reselectSample } from "@/app/actions/reselect-sample";
import { buildingKey, candidateKey, type Candidate } from "@/domain/sample-selection";
import type { ManualRejection, ManualRejectionReason } from "@/domain/sample-manual";
import { effectiveSelection, type SampleSelectionSnapshot } from "@/domain/sample-snapshot";
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
 * a per-`transactionId` QUEUE, consumed one-by-one in effective-proposal
 * order (final wave addendum, C1 refinement): the pre-`lokalId` code always
 * wrote `comparables` as `nextEff.proposed.map(rcnRow)`, i.e. in EXACTLY
 * that order, so the Nth legacy row for a `transactionId` is the Nth
 * candidate for it here too — same correspondence it always had. This
 * preserves an edit on EITHER lokal of an old-style multi-lokal act, not
 * just the earlier "exactly one row" fallback's single-lokal case.
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
  const legacyQueueByTransactionId = new Map<string, ComparableRow[]>();
  for (const c of currentRcnRows) {
    if (c.lokalId) continue; // matched via candidateKey above instead
    const queue = legacyQueueByTransactionId.get(c.transactionId);
    if (queue) queue.push(c);
    else legacyQueueByTransactionId.set(c.transactionId, [c]);
  }
  const manualRows = currentRows.filter((c) => c.source !== "rcn");
  return [
    ...nextEff.proposed.map(
      (c) =>
        byCandidateKey.get(candidateKey(c)) ??
        legacyQueueByTransactionId.get(c.transactionId)?.shift() ??
        rcnRow(c),
    ),
    ...manualRows,
  ];
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

  // Ranking order (proposed then alternates) — the panel's "Kandydatka N z
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
   * resyncs `comparables`, and follows the selection to whoever now
   * occupies the SAME ranking slot (the candidate that backfilled it, or
   * the next one along if nothing did, or closes the panel when the
   * ranking has run out).
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
    };
    setValue("sampleSelection", newSel, { shouldDirty: true });
    syncComparables(newSel);
    const newEff = effectiveSelection(newSel);
    const replacement = [...newEff.proposed, ...newEff.alternates][selectedIndex];
    setSelectedKey(replacement ? candidateKey(replacement) : null);
  };

  /** "Przywróć" in the "Odrzucone" section — drops one manual rejection and resyncs `comparables`. */
  const restore = (m: ManualRejection) => {
    if (!sel) return;
    const key = candidateKey(m);
    const newSel: SampleSelectionSnapshot = {
      ...sel,
      manualRejections: (sel.manualRejections ?? []).filter((x) => candidateKey(x) !== key),
    };
    setValue("sampleSelection", newSel, { shouldDirty: true });
    syncComparables(newSel);
  };

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
    isReselecting,
    poolMissing,
    setPoolMissing,
    reselectError,
    clearReselectError,
    onRadius,
  };
}
