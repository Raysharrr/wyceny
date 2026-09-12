import { randomUUID } from "node:crypto";
import {
  coopImportEventMeta,
  type ColumnMapping,
  type SkippedRow,
  type WarnedRow,
} from "../domain/coop-import";
import type { NewCoopTransaction, PortCoopRegistry } from "../ports/coop-registry";
import type { PortEventLog } from "../ports/event-log";
import type { PortGeocoder } from "../ports/geocoder";
import { type CoopChunkResult } from "./coop-import-chunks";

export { IMPORT_CHUNK, sumCoopChunks, type CoopChunkResult } from "./coop-import-chunks";

/**
 * The import itself (T-13, S2a Task 8; chunked in S2b): geocode every parsed
 * row through the worker chain, insert what is new, remember the mapping,
 * record the batch and two `event_log` entries. Ports only — no adapter
 * import (F-10).
 *
 * Three phases, so the screen can drive one file in slices of 20 rows and
 * stay under the hosting provider's action timeout (≈ 1.4 s per address
 * through the geocoder, measured in S2a E2E):
 *   1. `startCoopImport`   — opens the batch row (finishedAt null) BEFORE any
 *                            row is inserted, so an abandoned import (tab
 *                            closed, timeout) never leaves orphan rows;
 *   2. `importCoopChunk`   — geocode + insert one slice under that batchId;
 *   3. `finalizeCoopImport` — closes the batch with the summed counters,
 *                            remembers the mapping, writes both events.
 * `runCoopImport` is the one-shot composition of the three.
 *
 * F-13: `event_log` gets counts and classes ONLY. No address, flat number,
 * cooperative name or file name — those live in `coop_transaction` and
 * `coop_import_batch`, which are data, not the operational trail.
 */
export type CoopImportInput = {
  rows: NewCoopTransaction[];
  skipped: readonly SkippedRow[];
  /** From parseCoopSheet — rows keyed without a flat number; surfaced in the summary, the batch and the event. */
  warnings: readonly WarnedRow[];
  rowsTotal: number;
  cooperative: string;
  /** City prefix for the geocoder query — registers omit it ("Piastowskie 24"); Przylesie is in Leszno. */
  city: string;
  fileName: string;
  mapping: ColumnMapping;
  userId: string;
  workerToken: string;
  traceId?: string;
};

export type CoopImportSummary = {
  batchId: string;
  inserted: number;
  /** ONE number: duplicates inside the file + rows already in the register — the same the event carries (review 1 §8). */
  duplicates: number;
  geocoded: number;
  needsFix: number;
  skipped: readonly SkippedRow[];
  warnings: readonly WarnedRow[];
};

export type CoopImportStart = Pick<
  CoopImportInput,
  "cooperative" | "fileName" | "mapping" | "skipped" | "warnings" | "userId"
>;

export async function startCoopImport(
  deps: { registry: PortCoopRegistry },
  input: CoopImportStart,
): Promise<{ batchId: string }> {
  const batchId = randomUUID();
  await deps.registry.recordBatch({
    id: batchId,
    cooperative: input.cooperative,
    fileName: input.fileName,
    mapping: input.mapping,
    rowsInserted: 0,
    rowsSkipped: [...input.skipped],
    rowsWarned: [...input.warnings],
    createdBy: input.userId,
    finishedAt: null,
  });
  return { batchId };
}

export async function importCoopChunk(
  deps: { registry: PortCoopRegistry; geocoder: PortGeocoder },
  input: Pick<CoopImportInput, "rows" | "city" | "userId" | "workerToken"> & { batchId: string },
): Promise<CoopChunkResult | null> {
  // NIT-1: only the user who opened the batch may add rows under its id.
  const batch = await deps.registry.getBatch(input.batchId);
  if (!batch || batch.createdBy !== input.userId) return null;
  // Review 1 M-1/M-2: rows already in the register never reach the geocoder,
  // so the counters (and `coop.geocode` in event_log) describe only rows that
  // entered, and re-importing the same file costs zero geocoder calls.
  const present = await deps.registry.existingKeys(input.rows.map((r) => r.dedupeKey));
  const fresh = input.rows.filter((r) => !present.has(r.dedupeKey));
  const queries = fresh.map((r) => `${input.city}, ${r.address} ${r.buildingNumber}`.trim());
  const hits = queries.length ? await deps.geocoder.geocodeMany(queries, input.workerToken) : [];
  const rows = fresh.map((r, i) => {
    const hit = hits[i] ?? null;
    return { ...r, pos: hit ? { x: hit.x, y: hit.y } : null };
  });
  const geocoded = rows.filter((r) => r.pos !== null).length;
  const { inserted, duplicates } = rows.length
    ? await deps.registry.upsertMany(rows, { userId: input.userId, batchId: input.batchId })
    : { inserted: 0, duplicates: 0 };
  return {
    attempted: rows.length,
    inserted,
    duplicates: duplicates + (input.rows.length - fresh.length),
    geocoded,
    needsFix: rows.length - geocoded,
    usedNominatim: hits.some((h) => h?.source === "nominatim"),
  };
}

export async function finalizeCoopImport(
  deps: { registry: PortCoopRegistry; eventLog: PortEventLog },
  input: {
    batchId: string;
    rowsTotal: number;
    totals: CoopChunkResult;
    userId: string;
    traceId?: string;
  },
): Promise<CoopImportSummary | null> {
  // Skipped/warned rows, mapping and file name come from the batch opened in
  // `startCoopImport` — the client does not send them a second time (review 1 m-2).
  const batch = await deps.registry.getBatch(input.batchId);
  if (!batch || batch.createdBy !== input.userId) return null;
  // N-2: a batch closes once — a repeated finalize must not double the event_log entries.
  if (batch.finishedAt) return null;
  const { totals } = input;
  const meta = coopImportEventMeta({
    rowsTotal: input.rowsTotal,
    inserted: totals.inserted,
    duplicates: totals.duplicates,
    skipped: batch.rowsSkipped,
    warnings: batch.rowsWarned,
    geocoded: totals.geocoded,
    needsFix: totals.needsFix,
  });
  await deps.registry.recordBatch({
    ...batch,
    rowsInserted: totals.inserted,
    finishedAt: new Date().toISOString(),
  });
  await deps.registry.saveMapping(batch.cooperative, batch.mapping);

  const common = { traceId: input.traceId, actorId: input.userId };
  await deps.eventLog.record({
    ...common,
    level: totals.needsFix ? "warn" : "info",
    event: "coop.geocode",
    meta: {
      attempted: totals.attempted,
      resolved: totals.geocoded,
      failed: totals.needsFix,
      geocoder: totals.usedNominatim ? "uug+nominatim" : "uug",
    },
  });
  await deps.eventLog.record({ ...common, level: "info", event: "coop.import", meta });
  return {
    batchId: input.batchId,
    inserted: totals.inserted,
    duplicates: meta.duplicates,
    geocoded: totals.geocoded,
    needsFix: totals.needsFix,
    skipped: batch.rowsSkipped,
    warnings: batch.rowsWarned,
  };
}

export async function runCoopImport(
  deps: { registry: PortCoopRegistry; geocoder: PortGeocoder; eventLog: PortEventLog },
  input: CoopImportInput,
): Promise<CoopImportSummary> {
  const { batchId } = await startCoopImport(deps, input);
  const totals = await importCoopChunk(deps, { ...input, batchId });
  if (!totals) throw new Error("coop import batch vanished between start and chunk");
  const summary = await finalizeCoopImport(deps, { ...input, batchId, totals });
  if (!summary) throw new Error("coop import batch vanished between start and finalize");
  return summary;
}
