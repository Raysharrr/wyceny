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

/** Rows per `importCoopChunk` call from the screen: one geocoder call (adapter CHUNK = 20), ≈ 20 × 1.4 s worst case < the action timeout. */
export const IMPORT_CHUNK = 20;

/** Counters of one chunk; summed by the caller across chunks, then handed to `finalizeCoopImport`. */
export type CoopChunkResult = {
  attempted: number;
  inserted: number;
  /** Rows already present in the register (by dedupe key) — in-file duplicates were skipped by the parser. */
  duplicates: number;
  geocoded: number;
  needsFix: number;
  usedNominatim: boolean;
};

export function sumCoopChunks(chunks: readonly CoopChunkResult[]): CoopChunkResult {
  return chunks.reduce(
    (a, c) => ({
      attempted: a.attempted + c.attempted,
      inserted: a.inserted + c.inserted,
      duplicates: a.duplicates + c.duplicates,
      geocoded: a.geocoded + c.geocoded,
      needsFix: a.needsFix + c.needsFix,
      usedNominatim: a.usedNominatim || c.usedNominatim,
    }),
    { attempted: 0, inserted: 0, duplicates: 0, geocoded: 0, needsFix: 0, usedNominatim: false },
  );
}

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
): Promise<CoopChunkResult> {
  const queries = input.rows.map((r) => `${input.city}, ${r.address} ${r.buildingNumber}`.trim());
  const hits = queries.length ? await deps.geocoder.geocodeMany(queries, input.workerToken) : [];
  const rows = input.rows.map((r, i) => {
    const hit = hits[i] ?? null;
    return { ...r, pos: hit ? { x: hit.x, y: hit.y } : null };
  });
  const geocoded = rows.filter((r) => r.pos !== null).length;
  const { inserted, duplicates } = await deps.registry.upsertMany(rows, {
    userId: input.userId,
    batchId: input.batchId,
  });
  return {
    attempted: rows.length,
    inserted,
    duplicates,
    geocoded,
    needsFix: rows.length - geocoded,
    usedNominatim: hits.some((h) => h?.source === "nominatim"),
  };
}

export async function finalizeCoopImport(
  deps: { registry: PortCoopRegistry; eventLog: PortEventLog },
  input: Omit<CoopImportInput, "rows" | "city" | "workerToken"> & {
    batchId: string;
    totals: CoopChunkResult;
  },
): Promise<CoopImportSummary> {
  const { totals } = input;
  const meta = coopImportEventMeta({
    rowsTotal: input.rowsTotal,
    inserted: totals.inserted,
    duplicates: totals.duplicates,
    skipped: input.skipped,
    warnings: input.warnings,
    geocoded: totals.geocoded,
    needsFix: totals.needsFix,
  });
  await deps.registry.recordBatch({
    id: input.batchId,
    cooperative: input.cooperative,
    fileName: input.fileName,
    mapping: input.mapping,
    rowsInserted: totals.inserted,
    rowsSkipped: [...input.skipped],
    rowsWarned: [...input.warnings],
    createdBy: input.userId,
    finishedAt: new Date().toISOString(),
  });
  await deps.registry.saveMapping(input.cooperative, input.mapping);

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
    skipped: input.skipped,
    warnings: input.warnings,
  };
}

export async function runCoopImport(
  deps: { registry: PortCoopRegistry; geocoder: PortGeocoder; eventLog: PortEventLog },
  input: CoopImportInput,
): Promise<CoopImportSummary> {
  const { batchId } = await startCoopImport(deps, input);
  const totals = await importCoopChunk(deps, { ...input, batchId });
  return finalizeCoopImport(deps, { ...input, batchId, totals });
}
