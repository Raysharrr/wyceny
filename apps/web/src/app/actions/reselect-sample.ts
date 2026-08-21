"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/auth/session";
import { storage, valuationRepository } from "@/app/valuations/_deps";
import { recordFailure } from "@/app/actions/_record-failure";
import { errorWithCode, withTrace } from "@/lib/trace";
import { loadPool } from "@/app/actions/_pool-cache";
import { buildProposal } from "@/app/actions/_build-proposal";
import { manualRejectionSchema } from "@/lib/valuation-form-schema";
import type { ManualRejection } from "@/domain/sample-manual";

const inputSchema = z.object({
  valuationId: z.uuid("Nieprawidłowe dane formularza."),
  radiusOverrideM: z.union([z.literal(500), z.literal(1000), z.literal(2000), z.literal(3000)]),
  manualRejections: z.array(manualRejectionSchema),
});

export type ReselectSampleInput = {
  valuationId: string;
  radiusOverrideM: 500 | 1000 | 2000 | 3000;
  manualRejections: ManualRejection[];
};
export type ReselectSampleResult =
  | { proposal: Awaited<ReturnType<typeof buildProposal>> }
  | { error: string; code?: "pool_missing" };

const POOL_MISSING = "Zmiana promienia wymaga świeżej puli — pobierz próbę z RCN ponownie.";
const GENERIC = "Nie udało się przeliczyć próby — spróbuj ponownie.";

/**
 * Server Action backing the radius buttons (step 3, Task 8, ADR-015 "Dobor
 * proby v3") — re-runs the DOMAIN selection (`selectSample`, via the shared
 * `buildProposal`) over the pool `getSampleProposal` already fetched and
 * cached (`_pool-cache.ts`), at the appraiser's chosen radius. NEVER
 * re-queries the worker/WFS: the pool is a CACHE keyed by `valuationId`,
 * overwritten on every fresh fetch — when nothing is cached (a draft
 * started before Slice 3, or storage cleared), the answer is `pool_missing`,
 * never a silent re-selection on an empty pool (team-lead condition 1,
 * 2026-08-21). `sampleSelection` stays the only source of truth (ADR-011):
 * this returns a brand-new snapshot the same way the first fetch does — the
 * caller saves it via the same `saveSampleAction` → `applySampleUpdate`
 * path, whose `sample_updated` audit row sees `params.radiusOverrideM`.
 */
export async function reselectSample(input: ReselectSampleInput): Promise<ReselectSampleResult> {
  const session = await getSession();
  if (!session) redirect("/login");

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return { error: firstIssue?.message ?? "Nieprawidłowe dane formularza." };
  }
  const { valuationId, radiusOverrideM, manualRejections } = parsed.data;

  return withTrace(async () => {
    const startedAt = Date.now();
    try {
      const valuation = await valuationRepository.get(valuationId, session.user);
      if (!valuation) return { error: "Nie znaleziono wyceny." };

      const pool = await loadPool(storage, valuationId);
      if (!pool) return { error: POOL_MISSING, code: "pool_missing" };

      const proposal = await buildProposal({
        pool,
        valuation,
        area: valuation.area,
        radiusOverrideM,
        manualRejections,
        session,
        valuationId,
        event: "proposal.reselect",
        startedAt,
      });
      return { proposal };
    } catch (error) {
      await recordFailure({
        event: "reselectSample.failed",
        error,
        valuationId,
        actorId: session.user.id,
      });
      return { error: errorWithCode(GENERIC) };
    }
  });
}
