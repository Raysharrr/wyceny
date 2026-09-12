import { randomUUID } from "node:crypto";
import { coopImportEventMeta, type ColumnMapping, type SkippedRow } from "../domain/coop-import";
import type { NewCoopTransaction, PortCoopRegistry } from "../ports/coop-registry";
import type { PortEventLog } from "../ports/event-log";
import type { PortGeocoder } from "../ports/geocoder";

/**
 * The import itself (T-13, S2a Task 8): geocode every parsed row through the
 * worker chain, insert what is new, remember the mapping, record the batch
 * and two `event_log` entries. The screen (S2b) parses the sheet with
 * `parseCoopSheet` and calls this. Ports only — no adapter import (F-10).
 *
 * F-13: `event_log` gets counts and classes ONLY. No address, flat number,
 * cooperative name or file name — those live in `coop_transaction` and
 * `coop_import_batch`, which are data, not the operational trail.
 */
export type CoopImportInput = {
  rows: NewCoopTransaction[];
  skipped: readonly SkippedRow[];
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
  duplicates: number;
  geocoded: number;
  needsFix: number;
  skipped: readonly SkippedRow[];
};

export async function runCoopImport(
  deps: { registry: PortCoopRegistry; geocoder: PortGeocoder; eventLog: PortEventLog },
  input: CoopImportInput,
): Promise<CoopImportSummary> {
  const queries = input.rows.map((r) => `${input.city}, ${r.address} ${r.buildingNumber}`.trim());
  const hits = queries.length ? await deps.geocoder.geocodeMany(queries, input.workerToken) : [];
  const rows = input.rows.map((r, i) => {
    const hit = hits[i] ?? null;
    return { ...r, pos: hit ? { x: hit.x, y: hit.y } : null };
  });
  const geocoded = rows.filter((r) => r.pos !== null).length;
  const needsFix = rows.length - geocoded;
  const usedNominatim = hits.some((h) => h?.source === "nominatim");

  const batchId = randomUUID();
  const { inserted, duplicates } = await deps.registry.upsertMany(rows, {
    userId: input.userId,
    batchId,
  });
  await deps.registry.recordBatch({
    id: batchId,
    cooperative: input.cooperative,
    fileName: input.fileName,
    mapping: input.mapping,
    rowsInserted: inserted,
    rowsSkipped: [...input.skipped],
    createdBy: input.userId,
  });
  await deps.registry.saveMapping(input.cooperative, input.mapping);

  const common = { traceId: input.traceId, actorId: input.userId };
  await deps.eventLog.record({
    ...common,
    level: needsFix ? "warn" : "info",
    event: "coop.geocode",
    meta: {
      attempted: rows.length,
      resolved: geocoded,
      failed: needsFix,
      geocoder: usedNominatim ? "uug+nominatim" : "uug",
    },
  });
  await deps.eventLog.record({
    ...common,
    level: "info",
    event: "coop.import",
    meta: coopImportEventMeta({
      rowsTotal: input.rowsTotal,
      inserted,
      duplicates,
      skipped: input.skipped,
      geocoded,
      needsFix,
    }),
  });
  return { batchId, inserted, duplicates, geocoded, needsFix, skipped: input.skipped };
}
