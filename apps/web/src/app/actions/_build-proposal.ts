import { storage, streetView } from "@/app/valuations/_deps";
import { recordEvent } from "@/app/actions/_record-failure";
import {
  enrichStreetView,
  ENRICH_BUDGET_MS,
  REQUEST_BUDGET_MS,
} from "@/app/actions/_street-view-enrich";
import { fingerprint } from "@/lib/fingerprint";
import { currentTraceId } from "@/lib/trace";
import { selectSample } from "@/domain/sample-selection";
import { storeysHintByBuilding } from "@/domain/street-view-framing";
import { toSampleSelectionSnapshot, type SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import { deriveSubjectEgib } from "@/domain/egib-id";
import type { ManualRejection } from "@/domain/sample-manual";
import type { SampleMeta } from "@/domain/kcs";
import type { StreetViewSnapshot } from "@/domain/street-view-snapshot";
import type { CandidatePool } from "@/ports/sample";
import type { Valuation } from "@/ports/valuation";

/**
 * Shared core of `getSampleProposal` (fresh WFS fetch) and `reselectSample`
 * (radius change on the frozen pool, Task 8): runs the DOMAIN selection
 * (`selectSample`) over the given pool, builds the persisted snapshot +
 * comparable rows, enriches Street View, and records the sample telemetry
 * event. `pool` may be a just-fetched `CandidatePool` or one reloaded from
 * `_pool-cache.ts` — this function never fetches or caches it itself.
 *
 * `event` distinguishes the two callers in the telemetry: "proposal.sample"
 * (a fresh WFS fetch — meta carries the pool-fetch provenance: geocoder,
 * truncated, pages) from "proposal.reselect" (no re-fetch happened, so
 * those pool-fetch fields don't apply — meta carries only
 * radiusOverrideM/counts/fields, F-13).
 *
 * `startedAt` is the CALLER's wall-clock anchor (read at the top of its own
 * `withTrace`), not read here — `enrichStreetView`'s `budgetMs` must reflect
 * time already spent by the caller before `buildProposal` was even entered
 * (e.g. the worker round trip in `getSampleProposal`), not just this
 * function's own runtime.
 */
export async function buildProposal(
  args: {
    pool: CandidatePool;
    valuation: Valuation;
    area: number;
    manualRejections?: ManualRejection[];
    session: { user: { id: string } };
    valuationId: string;
    startedAt: number;
  } & ({ event: "proposal.sample" } | { event: "proposal.reselect"; radiusOverrideM: number }),
): Promise<{
  comparables: {
    date: string;
    area: number;
    pricePerM2: number;
    transactionId: string;
    lokalId: string;
  }[];
  sampleSelection: SampleSelectionSnapshot;
  sampleMeta: SampleMeta;
  streetView: StreetViewSnapshot;
}> {
  const { pool, valuation, area, manualRejections, session, valuationId, startedAt } = args;
  // Only present for a reselect (the discriminated union above guarantees
  // it) — a fresh fetch always walks the domain's own radius steps.
  const radiusOverrideM = args.event === "proposal.reselect" ? args.radiusOverrideM : undefined;

  const subjectMeta = valuation.inputs?.subjectMeta ?? null;
  const selectionParams = {
    subjectArea: area,
    // The only clock read for the domain — `selectSample` itself stays pure
    // (todayMonth is a parameter, never `new Date()` inside it).
    todayMonth: new Date().toISOString().slice(0, 7),
    subjectEgib: deriveSubjectEgib(subjectMeta?.buildingId, valuation.inputs?.subject?.parcelId),
    ...(radiusOverrideM !== undefined ? { radiusOverrideM } : {}),
  };
  const selection = selectSample(pool.candidates, selectionParams);
  const sampleSelection: SampleSelectionSnapshot = {
    ...toSampleSelectionSnapshot(selection, selectionParams),
    // Appraiser's overlay (Slice 3) — survives a radius change by candidateKey,
    // not recomputed here; `toSampleSelectionSnapshot` always writes `[]`.
    manualRejections: manualRejections ?? [],
  };
  const { candidates: _candidates, ...sampleMeta } = pool;
  const comparables = selection.proposed.map((c) => ({
    date: c.date,
    area: c.area,
    pricePerM2: c.pricePerM2,
    transactionId: c.transactionId,
    // Distinguishes lokale of one notarial act (final wave, runtime bug fix
    // — multi-lokal Heweliusza 3/43 collapsed to one lokal's data under a
    // transactionId-only key). See `rebuildComparables` and `document-model.ts`.
    lokalId: c.lokalId,
  }));

  // Keyed by POSITION, never by transactionId: that id is masked out of the
  // document by F-12, so it has no business sitting in a table key in the
  // clear. Only the three fields the appraiser can actually edit are
  // hashed — a later "% as proposed" needs to tell an edit from an
  // acceptance, not to re-identify a transaction.
  const fields = fingerprint(
    Object.fromEntries(
      comparables.map((tx, i) => [
        `tx${i}`,
        { date: tx.date, area: tx.area, pricePerM2: tx.pricePerM2 },
      ]),
    ),
  );

  if (args.event === "proposal.sample") {
    await recordEvent({
      level: "info",
      event: "proposal.sample",
      traceId: currentTraceId(),
      actorId: session.user.id,
      valuationId,
      meta: {
        fields,
        geocoder: pool.point.source,
        radiusUsedM: selection.radiusUsedM,
        truncated: pool.query.truncated,
        pages: pool.query.pages,
        counts: {
          ...selection.counts,
          fetched: pool.counts.fetched,
          deduped: pool.counts.deduped,
          noPos: pool.counts.noPos,
        },
      },
    });
  } else {
    // No re-fetch happened here — `geocoder`/`truncated`/`pages` are
    // properties of the POOL FETCH, not of a re-selection on it, so they
    // are deliberately absent (F-13, team-lead condition 3, 2026-08-21).
    // `args.radiusOverrideM` is narrowed by the `event` discriminant above —
    // no cast needed (review round 1, minor #6).
    await recordEvent({
      level: "info",
      event: "proposal.reselect",
      traceId: currentTraceId(),
      actorId: session.user.id,
      valuationId,
      meta: {
        radiusOverrideM: args.radiusOverrideM,
        counts: { ...selection.counts },
        fields,
      },
    });
  }

  let streetViewSnapshot: StreetViewSnapshot = valuation.inputs?.streetView ?? {};
  if (streetView) {
    const budgetMs = Math.min(
      ENRICH_BUDGET_MS,
      Math.max(0, REQUEST_BUDGET_MS - (Date.now() - startedAt)),
    );
    const enriched = await enrichStreetView([...selection.proposed, ...selection.alternates], {
      streetView,
      storage,
      now: () => new Date(),
      existing: valuation.inputs?.streetView ?? null,
      budgetMs,
      storeys: storeysHintByBuilding(pool.candidates),
    });
    streetViewSnapshot = { ...streetViewSnapshot, ...enriched.snapshot };
    await recordEvent({
      level: "info",
      event: "proposal.streetview",
      traceId: currentTraceId(),
      actorId: session.user.id,
      valuationId,
      meta: enriched.meta,
    });
  }

  return { comparables, sampleSelection, sampleMeta, streetView: streetViewSnapshot };
}
