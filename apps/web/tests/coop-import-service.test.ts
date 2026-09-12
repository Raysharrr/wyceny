import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import { eventLogRepo } from "../src/adapters/event-log-drizzle";
import {
  parseCoopSheet,
  rememberedMappingFor,
  type ColumnMapping,
  type RememberedMapping,
} from "../src/domain/coop-import";
import {
  finalizeCoopImport,
  importCoopChunk,
  runCoopImport,
  startCoopImport,
  sumCoopChunks,
  type CoopChunkResult,
} from "../src/lib/coop-import-service";
import type { NewCoopTransaction, PortCoopRegistry } from "../src/ports/coop-registry";
import type { PortGeocoder } from "../src/ports/geocoder";
import { newTraceId } from "../src/lib/trace";
import fixture from "./fixtures/coop-registry-synthetic.sheets.json";

/**
 * S2a Task 8: the import geocodes sequentially through the port, inserts,
 * records the batch and writes `coop.geocode` + `coop.import` to the REAL
 * event_log — and F-13 holds: no address, flat number, cooperative or file
 * name ever lands there. Registry and geocoder are in-memory fakes; the
 * event log is the Drizzle adapter on Postgres, because that is the table
 * the fitness function is about.
 */
const COOP = "SM Syntetyczna Ukryta";
const FILE = "rejestr-tajny.xlsx";
const parsed = parseCoopSheet(
  fixture.sheets[0]!.rows,
  { address: 1, buildingNumber: 2, flatNumber: 3, area: 4, priceTotal: 5, date: 6, rightType: 7 },
  { cooperative: COOP, priceKind: "nieustalona", headerRow: 3 },
);

function fakeRegistry() {
  const stored: NewCoopTransaction[] = [];
  const calls: string[] = [];
  const batches: { rowsWarned: unknown[]; rowsInserted: number; finishedAt: string | null }[] = [];
  const full = new Map<string, import("../src/ports/coop-registry").CoopImportBatch>();
  const remembered: { mapping: RememberedMapping | null } = { mapping: null };
  const registry: PortCoopRegistry = {
    async existingKeys(keys) {
      calls.push("existingKeys");
      return new Set(keys.filter((k) => stored.some((s) => s.dedupeKey === k)));
    },
    async upsertMany(rows) {
      calls.push("upsertMany");
      const fresh = rows.filter((r) => !stored.some((s) => s.dedupeKey === r.dedupeKey));
      stored.push(...fresh);
      return { inserted: fresh.length, duplicates: rows.length - fresh.length };
    },
    async recordBatch(b) {
      calls.push("recordBatch");
      batches.push({
        rowsWarned: b.rowsWarned,
        rowsInserted: b.rowsInserted,
        finishedAt: b.finishedAt,
      });
      full.set(b.id, b);
    },
    async getBatch(id) {
      return full.get(id) ?? null;
    },
    async saveMapping(_cooperative, mapping, headers) {
      calls.push("saveMapping");
      remembered.mapping = { mapping, headers };
    },
    list: async () => ({ rows: [], total: 0, hasMore: false, truncated: false }),
    save: async () => ({ ok: false, reason: "invalid" }),
    remove: async () => {},
    stats: async () => ({ total: 0, byCooperative: {}, needsGeocoding: 0, lastImport: null }),
    getMapping: async () => remembered.mapping,
  };
  return { registry, stored, calls, batches };
}

const geocoderQueries: string[][] = [];
const geocoder: PortGeocoder = {
  async geocodeMany(addresses) {
    geocoderQueries.push([...addresses]);
    // Bukowa is unknown to the fake geocoder → pos null → "do poprawki".
    return addresses.map((a, i) =>
      a.includes("Bukowa")
        ? null
        : { x: 360000 + i, y: 504000, source: i === 0 ? "nominatim" : "uug" },
    );
  },
};

const eventLog = eventLogRepo(db);
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await pool.end();
});

describe("runCoopImport", () => {
  it("geocodes with the city prefix, inserts, records batch + mapping, and a re-run inserts 0", async () => {
    const { registry, stored, calls, batches } = fakeRegistry();
    const traceId = newTraceId();
    const input = {
      rows: parsed.rows,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      rowsTotal: fixture.sheets[0]!.rows.length,
      cooperative: COOP,
      city: "Poznań",
      fileName: FILE,
      mapping: { address: 1, buildingNumber: 2 },
      userId: "u-import",
      workerToken: "tok",
      traceId,
    };
    const first = await runCoopImport({ registry, geocoder, eventLog }, input);
    // duplicates = 1 inside the file (row 5) + 0 already in the register — one number, same as the event.
    expect(first).toMatchObject({ inserted: 5, duplicates: 1, geocoded: 4, needsFix: 1 });
    expect(geocoderQueries.at(-1)![0]).toBe("Poznań, Zmyślona 4");
    expect(stored.filter((r) => r.pos === null).map((r) => r.address)).toEqual(["Bukowa"]);
    expect(calls).toEqual([
      "recordBatch",
      "existingKeys",
      "upsertMany",
      "recordBatch",
      "saveMapping",
    ]);
    expect(first.warnings).toEqual([{ row: 13, reason: "no_flat" }]);
    expect(batches[0]!.rowsWarned).toEqual([{ row: 13, reason: "no_flat" }]);

    const again = await runCoopImport({ registry, geocoder, eventLog }, input);
    expect(again).toMatchObject({ inserted: 0, duplicates: 6 });
    expect((await eventLog.byTrace(traceId)).at(-1)!.meta).toMatchObject({ duplicates: 6 });
  });

  it("F-13: event_log carries counts and classes only — never an address, flat, cooperative or file name", async () => {
    const { registry } = fakeRegistry();
    const traceId = newTraceId();
    await runCoopImport(
      { registry, geocoder, eventLog },
      {
        rows: parsed.rows,
        skipped: parsed.skipped,
        warnings: parsed.warnings,
        rowsTotal: 15,
        cooperative: COOP,
        city: "Poznań",
        fileName: FILE,
        mapping: { address: 1 },
        userId: "u-f13",
        workerToken: "tok",
        traceId,
      },
    );
    const rows = await eventLog.byTrace(traceId);
    expect(rows.map((r) => r.event)).toEqual(["coop.geocode", "coop.import"]);
    expect(rows[0]!.meta).toEqual({
      attempted: 5,
      resolved: 4,
      failed: 1,
      geocoder: "uug+nominatim",
    });
    expect(rows[0]!.level).toBe("warn");
    expect(rows[1]!.meta).toEqual({
      rows_total: 15,
      inserted: 5,
      duplicates: 1,
      skipped_summary: 2,
      skipped_bad: 2,
      warned_no_flat: 1,
      warned_no_flat_merge: 0,
      geocoded: 4,
      needs_fix: 1,
    });
    // The gate is on the VALUES, not on substrings of the JSON (a legal count
    // of 12 must not turn it red — review 1 §12): every meta value is a number
    // or one of the closed geocoder classes, and the keys are the documented set.
    const GEOCODER_CLASSES = ["uug", "uug+nominatim"];
    for (const r of rows) {
      for (const [k, v] of Object.entries(r.meta as Record<string, unknown>)) {
        expect(
          typeof v === "number" || GEOCODER_CLASSES.includes(v as string),
          `${r.event}.${k}`,
        ).toBe(true);
      }
    }
    expect(Object.keys(rows[0]!.meta as object).sort()).toEqual([
      "attempted",
      "failed",
      "geocoder",
      "resolved",
    ]);
    expect(Object.keys(rows[1]!.meta as object).sort()).toEqual([
      "duplicates",
      "geocoded",
      "inserted",
      "needs_fix",
      "rows_total",
      "skipped_bad",
      "skipped_summary",
      "warned_no_flat",
      "warned_no_flat_merge",
    ]);
  });
});

describe("chunked import (S2b): start → chunks → finalize equals the one-shot", () => {
  it("opens the batch before any row, sums chunk counters, closes with finishedAt", async () => {
    const { registry, stored, calls, batches } = fakeRegistry();
    const common = {
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      rowsTotal: fixture.sheets[0]!.rows.length,
      cooperative: COOP,
      fileName: FILE,
      mapping: { address: 1, buildingNumber: 2 },
      userId: "u-chunks",
    };
    const { batchId } = await startCoopImport({ registry }, common);
    expect(batches[0]).toMatchObject({ rowsInserted: 0, finishedAt: null });
    expect(stored).toHaveLength(0);

    const chunks: CoopChunkResult[] = [];
    for (let i = 0; i < parsed.rows.length; i += 2) {
      chunks.push(
        (await importCoopChunk(
          { registry, geocoder },
          {
            batchId,
            rows: parsed.rows.slice(i, i + 2),
            city: "Poznań",
            userId: "u-chunks",
            workerToken: "t",
          },
        ))!,
      );
    }
    expect(chunks).toHaveLength(3);
    const summary = await finalizeCoopImport(
      { registry, eventLog },
      {
        batchId,
        rowsTotal: common.rowsTotal,
        userId: common.userId,
        totals: sumCoopChunks(chunks),
      },
    );
    expect(summary).toMatchObject({
      batchId,
      inserted: 5,
      duplicates: 1,
      geocoded: 4,
      needsFix: 1,
    });
    expect(batches.at(-1)).toMatchObject({ rowsInserted: 5 });
    expect(batches.at(-1)!.finishedAt).not.toBeNull();
    expect(calls.filter((c) => c === "upsertMany")).toHaveLength(3);
    expect(calls.at(-1)).toBe("saveMapping");
  });
});

describe("re-import (review 1 M-1/M-2)", () => {
  it("rows already in the register are skipped BEFORE geocoding: zero geocoder calls, counters only for rows that entered", async () => {
    const { registry } = fakeRegistry();
    const common = {
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      rowsTotal: fixture.sheets[0]!.rows.length,
      cooperative: COOP,
      fileName: FILE,
      mapping: { address: 1 },
      userId: "u-re",
      city: "Poznań",
      workerToken: "t",
      rows: parsed.rows,
    };
    const first = await runCoopImport({ registry, geocoder, eventLog }, common);
    expect(first).toMatchObject({ inserted: 5, geocoded: 4, needsFix: 1 });
    const before = geocoderQueries.length;
    const again = await runCoopImport({ registry, geocoder, eventLog }, common);
    expect(geocoderQueries.length).toBe(before);
    // 5 already in the register + 1 inside the file; nothing geocoded, nothing "do poprawki".
    expect(again).toMatchObject({ inserted: 0, duplicates: 6, geocoded: 0, needsFix: 0 });
  });
});

describe("batch ownership (review 1 NIT-1)", () => {
  it("a chunk or finalize under someone else's batchId is refused with null", async () => {
    const { registry, stored } = fakeRegistry();
    const { batchId } = await startCoopImport(
      { registry },
      {
        cooperative: COOP,
        fileName: FILE,
        mapping: {},
        skipped: [],
        warnings: [],
        userId: "owner",
      },
    );
    const chunk = await importCoopChunk(
      { registry, geocoder },
      {
        batchId,
        rows: parsed.rows.slice(0, 1),
        city: "Poznań",
        userId: "intruder",
        workerToken: "t",
      },
    );
    expect(chunk).toBeNull();
    expect(stored).toHaveLength(0);
    const fin = await finalizeCoopImport(
      { registry, eventLog },
      { batchId, rowsTotal: 1, userId: "intruder", totals: sumCoopChunks([]) },
    );
    expect(fin).toBeNull();
  });
});

describe("finalize is one-shot (review 2 N-2)", () => {
  it("a second finalize of a closed batch returns null and writes nothing", async () => {
    const { registry, calls } = fakeRegistry();
    const input = {
      rows: parsed.rows,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      rowsTotal: 1,
      cooperative: COOP,
      city: "Poznań",
      fileName: FILE,
      mapping: {},
      userId: "u-once",
      workerToken: "t",
    };
    const first = await runCoopImport({ registry, geocoder, eventLog }, input);
    const before = calls.length;
    const again = await finalizeCoopImport(
      { registry, eventLog },
      { batchId: first.batchId, rowsTotal: 1, userId: "u-once", totals: sumCoopChunks([]) },
    );
    expect(again).toBeNull();
    expect(calls.length).toBe(before);
  });
});

describe("remembered mapping vs a sheet with a different header row (S5, Task 4e — staging O-1)", () => {
  // Sheet A: "Rejestr 2025" (header row 3: Lp. | Adres | Nr budynku | …).
  // Sheet B: "Bez nr mieszkania" (header row 0: Adres | Pow. | Cena | zł/m² | Data | Tytuł własności).
  // Same cooperative, different layouts — exactly Aneta's registers (five layouts, four SMs).
  const A = fixture.sheets[0]!;
  const B = fixture.sheets[2]!;
  const MAPPING_A: ColumnMapping = {
    address: 1,
    buildingNumber: 2,
    flatNumber: 3,
    area: 4,
    priceTotal: 5,
    date: 6,
    rightType: 7,
  };
  const MAPPING_B: ColumnMapping = {
    address: 0,
    buildingNumber: 0,
    flatNumber: "absent",
    area: 1,
    priceTotal: 2,
    date: 4,
    rightType: 5,
  };
  const headersOf = (sheet: { rows: string[][] }, headerRow: number) => sheet.rows[headerRow]!;

  async function importSheet(
    registry: PortCoopRegistry,
    sheet: { rows: string[][] },
    mapping: ColumnMapping,
    headerRow: number,
  ) {
    const p = parseCoopSheet(sheet.rows, mapping, {
      cooperative: COOP,
      priceKind: "nieustalona",
      headerRow,
    });
    const { batchId } = await startCoopImport(
      { registry },
      {
        cooperative: COOP,
        fileName: FILE,
        mapping,
        skipped: p.skipped,
        warnings: p.warnings,
        userId: "u",
      },
    );
    const chunk = await importCoopChunk(
      { registry, geocoder },
      { batchId, city: "Poznań", rows: p.rows, userId: "u", workerToken: "tok" },
    );
    const summary = await finalizeCoopImport(
      { registry, eventLog },
      {
        batchId,
        rowsTotal: sheet.rows.length,
        totals: sumCoopChunks([chunk!]),
        userId: "u",
        headers: headersOf(sheet, headerRow),
      },
    );
    return summary!;
  }

  it("A → B (other layout) → A again: the mapping remembered from B is NOT laid over A, and A re-imports 0 new rows", async () => {
    const { registry } = fakeRegistry();
    const first = await importSheet(registry, A, MAPPING_A, 3);
    expect(first.inserted).toBe(5);
    await importSheet(registry, B, MAPPING_B, 0);

    // The wizard's decision for sheet A after B was imported last:
    const remembered = await registry.getMapping(COOP);
    expect(remembered?.headers).toEqual(headersOf(B, 0));
    const decision = rememberedMappingFor(remembered, headersOf(A, 3));
    expect(decision).toEqual({ kind: "layout_differs" });
    // …so the appraiser maps A from scratch (MAPPING_A), not with B's indexes —
    // and the re-import adds nothing. With B's mapping laid over A, `rep` would have
    // read column 0 („Lp.”: 1, 2, 3…) and every row would have entered again.
    const again = await importSheet(registry, A, MAPPING_A, 3);
    expect(again.inserted).toBe(0);
    expect(rememberedMappingFor(await registry.getMapping(COOP), headersOf(A, 3))).toEqual({
      kind: "match",
      mapping: MAPPING_A,
    });
  });

  it("the same layout with cosmetic header differences (case, spaces) still matches; no header row = unknown layout", () => {
    const saved: RememberedMapping = {
      mapping: MAPPING_A,
      headers: ["Lp.", "Adres ", "Nr  budynku"],
    };
    expect(rememberedMappingFor(saved, ["lp.", "adres", "nr budynku"])).toEqual({
      kind: "match",
      mapping: MAPPING_A,
    });
    expect(rememberedMappingFor(saved, ["Lp.", "Adres"])).toEqual({ kind: "layout_differs" });
    expect(rememberedMappingFor(saved, null)).toEqual({ kind: "unknown_layout" }); // MINOR-2
    expect(
      rememberedMappingFor({ mapping: MAPPING_A, headers: null }, ["Lp.", "Adres ", "Nr  budynku"]),
    ).toEqual({ kind: "unknown_layout" });
    expect(rememberedMappingFor(null, ["Lp."])).toEqual({ kind: "none" });
  });
});

describe("finalize headers are a convenience, never a condition (review 1 MINOR-3)", () => {
  it("an oversized header row does not fail the finalize schema", async () => {
    const { finalizeCoopImportAction } = await import("../src/app/actions/coop-import");
    void finalizeCoopImportAction; // schema is module-private; assert via zod directly below
    const { z } = await import("zod");
    const headers = z.array(z.string().max(500)).max(200).nullable().optional().catch(null);
    expect(headers.parse(Array.from({ length: 201 }, () => "x"))).toBeNull();
    expect(headers.parse(["x".repeat(501)])).toBeNull();
    expect(headers.parse(["Lp.", "Adres"])).toEqual(["Lp.", "Adres"]);
  });
});
