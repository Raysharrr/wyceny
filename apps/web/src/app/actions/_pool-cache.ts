import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import type { CandidatePool } from "@/ports/sample";
import { StorageNotFoundError, type PortStorage } from "@/ports/storage";
import { candidatePoolSchema } from "@/lib/valuation-form-schema";

/**
 * The gzip pool cache key for a valuation (Task 8). A CACHE, not a
 * snapshot — overwritten on every `getSampleProposal` fetch, never versioned
 * or kept around after a fresher one lands.
 */
export const poolKey = (valuationId: string) => `pool/${valuationId}.json.gz`;

/**
 * The subject inputs the cached pool was fetched for — `reselectSample`
 * refuses to reuse a pool whose `address`/`area` no longer match the
 * valuation's CURRENT subject (review round 1, Important #2, 2026-08-21): an
 * address edit in step 1 after a step-3 fetch must not silently re-select on
 * a pool for the WRONG point/area band.
 */
export type PoolSavedFor = { address: string; area: number };

const poolCacheEntrySchema = z.object({
  savedFor: z.object({ address: z.string(), area: z.number() }),
  pool: candidatePoolSchema,
});

/**
 * The raw candidate pool, frozen per valuation at fetch time, so a radius
 * change (`reselectSample`) can re-run the DOMAIN selection without a
 * second WFS round trip (Slice 3, ADR-015). Saved AFTER dedup — as
 * `Candidate[]`, not the raw GML — gzip keeps a several-MB JSON pool under
 * 2 MB (team-lead condition 2, 2026-08-21). Overwritten by every fetch.
 * Wrapped with `savedFor` (the address/area it was fetched for) so a later
 * reselect can detect a stale pool instead of silently applying it to a
 * subject that has since changed.
 */
export async function savePool(
  storage: PortStorage,
  valuationId: string,
  pool: CandidatePool,
  savedFor: PoolSavedFor,
): Promise<void> {
  await storage.put(
    poolKey(valuationId),
    gzipSync(Buffer.from(JSON.stringify({ savedFor, pool }), "utf8")),
  );
}

/**
 * Reloads the cached pool (with the `savedFor` it was fetched under), or
 * `null` when nothing was ever cached for this valuation (a draft started
 * before Slice 3, or a cleared storage) — the ONLY case `reselectSample`
 * treats as "pobierz ponownie", never a silent re-selection on an empty pool
 * (team-lead condition 1). A corrupt cache (bad gzip, malformed JSON, or a
 * shape `poolCacheEntrySchema`/`candidatePoolSchema` rejects) is a genuine
 * failure and is left to throw, not masked as a missing pool.
 */
export async function loadPool(
  storage: PortStorage,
  valuationId: string,
): Promise<{ savedFor: PoolSavedFor; pool: CandidatePool } | null> {
  try {
    const raw = gunzipSync(await storage.get(poolKey(valuationId))).toString("utf8");
    return poolCacheEntrySchema.parse(JSON.parse(raw));
  } catch (e) {
    if (e instanceof StorageNotFoundError) return null;
    throw e;
  }
}
