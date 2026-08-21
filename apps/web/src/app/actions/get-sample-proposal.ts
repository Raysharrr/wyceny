"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/auth/session";
import { sampleProposal, storage, streetView, valuationRepository } from "@/app/valuations/_deps";
import { recordEvent, recordFailure } from "@/app/actions/_record-failure";
import {
  enrichStreetView,
  ENRICH_BUDGET_MS,
  REQUEST_BUDGET_MS,
} from "@/app/actions/_street-view-enrich";
import { fingerprint } from "@/lib/fingerprint";
import { currentTraceId, errorWithCode, withTrace } from "@/lib/trace";
import { WORKER_RESPONDED_PREFIX } from "@/adapters/sample-http";
import { valuationFormObject } from "@/lib/valuation-form-schema";
import { selectSample } from "@/domain/sample-selection";
import { storeysHintByBuilding } from "@/domain/street-view-framing";
import { toSampleSelectionSnapshot, type SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import { deriveSubjectEgib } from "@/domain/egib-id";
import type { SampleMeta } from "@/domain/kcs";
import type { StreetViewSnapshot } from "@/domain/street-view-snapshot";

const inputSchema = valuationFormObject
  .pick({ address: true, area: true })
  .extend({ valuationId: z.uuid("Nieprawidłowe dane formularza.") });

// Declared explicitly rather than `z.input<typeof inputSchema>`: `area` is
// `z.coerce.number()`, whose input type is `unknown`, not `number` — callers
// (the step-3 UI) always have a real number in hand by this point.
export type GetSampleProposalInput = { valuationId: string; address: string; area: number };
export type GetSampleProposalResult =
  | {
      proposal: {
        comparables: { date: string; area: number; pricePerM2: number; transactionId: string }[];
        sampleSelection: SampleSelectionSnapshot;
        sampleMeta: SampleMeta;
        streetView: StreetViewSnapshot;
      };
    }
  | { error: string };

const GENERIC_ERROR =
  "Nie udało się pobrać próby z RCN — spróbuj ponownie albo wpisz transakcje ręcznie.";

/**
 * Server Action backing the "Pobierz próbę z RCN" button (step 3, ADR-015
 * "Dobor proby v3"). Session-gated like `createDraft`; validates
 * address/area with the same rules as the main form (reused via `.pick()`),
 * loads the draft's already-resolved subject point (step 1's fetch, if any),
 * fetches the RAW candidate pool from the worker, and runs the DOMAIN
 * (`selectSample`) over it — the worker only fetches, it never ranks or
 * filters. The adapter's Polish `detail` message (surfaced by the worker on
 * failure, e.g. too few nearby transactions) is passed through verbatim; a
 * zod validation failure at the trust boundary, or the adapter's own English
 * status-text fallback, is replaced with a generic Polish message instead.
 *
 * Slice 3: after the sample telemetry is recorded, `streetView` (null
 * without GOOGLE_STREET_VIEW_KEY) enriches every unique building among
 * proposed+alternates with a Street View preview (`enrichStreetView`) —
 * frozen entries reused, storage-cached, Google failures counted but never
 * thrown (a hiccup there must not cost the appraiser the sample).
 * `enrichStreetView`'s `budgetMs` is derived from `REQUEST_BUDGET_MS` minus
 * time already spent on the worker call (capped at `ENRICH_BUDGET_MS`), not
 * passed as a flat constant — a slow RCN fetch leaves enrichment less room
 * instead of the two budgets stacking past this action's own time limit.
 */
export async function getSampleProposal(
  input: GetSampleProposalInput,
): Promise<GetSampleProposalResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message =
      firstIssue?.code === "invalid_type" ? "Nieprawidłowe dane formularza." : firstIssue?.message;
    return { error: message ?? "Nieprawidłowe dane formularza." };
  }
  const { valuationId, address, area } = parsed.data;

  return withTrace(async () => {
    // Wall-clock anchor for `enrichStreetView`'s `budgetMs` below — how much
    // of REQUEST_BUDGET_MS is left after the worker call, so a slow RCN
    // fetch leaves enrichment less room instead of enrichment blindly
    // assuming it has the full budget to itself.
    const startedAt = Date.now();
    try {
      const valuation = await valuationRepository.get(valuationId, session.user);
      if (!valuation) return { error: "Nie znaleziono wyceny." };

      const meta = valuation.inputs?.subjectMeta ?? null;
      const point = meta ? { x: meta.x, y: meta.y, srid: 2180 as const } : undefined;
      const pool = await sampleProposal.fetchPool({ address, area, ...(point ? { point } : {}) });

      const selectionParams = {
        subjectArea: area,
        // The only clock read in this action — the domain stays pure
        // (todayMonth is a parameter, never `new Date()` inside it).
        todayMonth: new Date().toISOString().slice(0, 7),
        subjectEgib: deriveSubjectEgib(meta?.buildingId, valuation.inputs?.subject?.parcelId),
      };
      const selection = selectSample(pool.candidates, selectionParams);
      const sampleSelection = toSampleSelectionSnapshot(selection, selectionParams);
      const { candidates: _candidates, ...sampleMeta } = pool;
      const comparables = selection.proposed.map((c) => ({
        date: c.date,
        area: c.area,
        pricePerM2: c.pricePerM2,
        transactionId: c.transactionId,
      }));

      // Keyed by POSITION, never by transactionId: that id is masked out of
      // the document by F-12, so it has no business sitting in a table key
      // in the clear. Only the three fields the appraiser can actually edit
      // are hashed — a later "% as proposed" needs to tell an edit from an
      // acceptance, not to re-identify a transaction. Everything else in
      // `meta` is a number or a class (F-13) — never an address, id or
      // coordinate.
      await recordEvent({
        level: "info",
        event: "proposal.sample",
        traceId: currentTraceId(),
        actorId: session.user.id,
        valuationId,
        meta: {
          fields: fingerprint(
            Object.fromEntries(
              comparables.map((tx, i) => [
                `tx${i}`,
                { date: tx.date, area: tx.area, pricePerM2: tx.pricePerM2 },
              ]),
            ),
          ),
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

      return {
        proposal: { comparables, sampleSelection, sampleMeta, streetView: streetViewSnapshot },
      };
    } catch (error) {
      await recordFailure({
        event: "getSampleProposal.failed",
        error,
        valuationId,
        actorId: session.user.id,
      });
      // A ZodError from the adapter's trust-boundary parse carries a
      // JSON-blob `message` — never fit for the appraiser's screen, so it
      // gets the generic message like any other non-worker failure.
      if (error instanceof z.ZodError) return { error: errorWithCode(GENERIC_ERROR) };
      // AbortSignal.timeout() rejects with a DOMException-shaped Error whose
      // `message` is English ("The operation was aborted due to timeout") and
      // does not start with WORKER_RESPONDED_PREFIX, so it would otherwise
      // pass through verbatim like the worker's own Polish `detail`.
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        return { error: errorWithCode(GENERIC_ERROR) };
      }
      const message = error instanceof Error ? error.message : undefined;
      if (message && !message.startsWith(WORKER_RESPONDED_PREFIX)) {
        return { error: errorWithCode(message) };
      }
      return { error: errorWithCode(GENERIC_ERROR) };
    }
  });
}
