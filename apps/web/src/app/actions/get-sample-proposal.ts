"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/auth/session";
import { sampleProposal, storage, valuationRepository } from "@/app/valuations/_deps";
import { recordFailure } from "@/app/actions/_record-failure";
import { errorWithCode, withTrace } from "@/lib/trace";
import { WORKER_RESPONDED_PREFIX } from "@/adapters/sample-http";
import { valuationFormObject } from "@/lib/valuation-form-schema";
import { savePool } from "@/app/actions/_pool-cache";
import { buildProposal } from "@/app/actions/_build-proposal";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
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
 * fetches the RAW candidate pool from the worker, caches it (Task 8, so a
 * later radius change via `reselectSample` never re-queries WFS), and runs
 * the DOMAIN selection over it via `buildProposal` (shared with
 * `reselectSample`) — the worker only fetches, it never ranks or filters.
 * The adapter's Polish `detail` message (surfaced by the worker on failure,
 * e.g. too few nearby transactions) is passed through verbatim; a zod
 * validation failure at the trust boundary, or the adapter's own English
 * status-text fallback, is replaced with a generic Polish message instead.
 *
 * Slice 3: `buildProposal` enriches every unique building among
 * proposed+alternates with a Street View preview (null without
 * GOOGLE_STREET_VIEW_KEY) — see its own doc for the budget/cache details.
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
    // Wall-clock anchor for `buildProposal`'s `enrichStreetView` budget below
    // — how much of REQUEST_BUDGET_MS is left after the worker call, so a
    // slow RCN fetch leaves enrichment less room instead of enrichment
    // blindly assuming it has the full budget to itself.
    const startedAt = Date.now();
    try {
      const valuation = await valuationRepository.get(valuationId, session.user);
      if (!valuation) return { error: "Nie znaleziono wyceny." };

      const meta = valuation.inputs?.subjectMeta ?? null;
      const point = meta ? { x: meta.x, y: meta.y, srid: 2180 as const } : undefined;
      const pool = await sampleProposal.fetchPool({ address, area, ...(point ? { point } : {}) });

      // Overwrites any previous cache for this valuation (it's a CACHE, not
      // a versioned snapshot) — a write failure must not cost the appraiser
      // the sample they just fetched, only the ability to change the radius
      // without re-fetching later, so it's logged and swallowed.
      try {
        await savePool(storage, valuationId, pool);
      } catch (error) {
        await recordFailure({
          event: "poolCache.writeFailed",
          error,
          valuationId,
          actorId: session.user.id,
        });
      }

      const proposal = await buildProposal({
        pool,
        valuation,
        area,
        session,
        valuationId,
        event: "proposal.sample",
        startedAt,
      });

      return { proposal };
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
