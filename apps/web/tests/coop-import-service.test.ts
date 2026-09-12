import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import { eventLogRepo } from "../src/adapters/event-log-drizzle";
import { parseCoopSheet } from "../src/domain/coop-import";
import { runCoopImport } from "../src/lib/coop-import-service";
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
  const registry: PortCoopRegistry = {
    async upsertMany(rows) {
      calls.push("upsertMany");
      const fresh = rows.filter((r) => !stored.some((s) => s.dedupeKey === r.dedupeKey));
      stored.push(...fresh);
      return { inserted: fresh.length, duplicates: rows.length - fresh.length };
    },
    async recordBatch() {
      calls.push("recordBatch");
    },
    async saveMapping() {
      calls.push("saveMapping");
    },
    list: async () => ({ rows: [], total: 0, hasMore: false, truncated: false }),
    save: async () => ({ ok: false, reason: "invalid" }),
    remove: async () => {},
    stats: async () => ({ total: 0, byCooperative: {}, needsGeocoding: 0, lastImport: null }),
    getMapping: async () => null,
  };
  return { registry, stored, calls };
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
    const { registry, stored, calls } = fakeRegistry();
    const traceId = newTraceId();
    const input = {
      rows: parsed.rows,
      skipped: parsed.skipped,
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
    expect(calls).toEqual(["upsertMany", "recordBatch", "saveMapping"]);

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
    ]);
  });
});
