import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { like } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { coopRegistryRepo } from "../src/adapters/coop-registry-drizzle";
import { coopDedupeKey, parseCoopSheet } from "../src/domain/coop-import";
import fixture from "./fixtures/coop-registry-synthetic.sheets.json";

/**
 * Adapter on the real Postgres (T-13, S2a Task 7): import of the synthetic
 * fixture lands in `coop_transaction`, a re-import inserts nothing, the
 * radius query skips `pos = null`, stats count what needs geocoding.
 */
const stamp = `repo-${Date.now()}`;
const COOP = `SM Syntetyczna ${stamp}`;
const USER = `coop-repo-user-${stamp}`;
const repo = coopRegistryRepo(db);

const parsed = parseCoopSheet(
  fixture.sheets[0]!.rows,
  { address: 1, buildingNumber: 2, flatNumber: 3, area: 4, priceTotal: 5, date: 6, rightType: 7 },
  { cooperative: COOP, priceKind: "nieustalona", headerRow: 3 },
);
// Salt the FACTS (flat number), not the key: save() derives the key from the
// facts, so a hand-salted key would collide with the same fixture imported by
// another run or by the E2E on the shared local DB.
const rows = parsed.rows.map((r, i) => {
  const salted = { ...r, flatNumber: `${r.flatNumber}|${stamp}` };
  return {
    ...salted,
    dedupeKey: coopDedupeKey(salted),
    // Three rows geocoded around (360000, 504000); two left "do poprawki".
    pos: i < 3 ? { x: 360000 + i * 100, y: 504000 } : null,
  };
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await db
    .delete(schema.coopTransaction)
    .where(like(schema.coopTransaction.dedupeKey, `%${stamp}`));
  await db
    .delete(schema.coopImportBatch)
    .where(like(schema.coopImportBatch.cooperative, `%${stamp}`));
  await db
    .delete(schema.coopColumnMapping)
    .where(like(schema.coopColumnMapping.cooperative, `%${stamp}`));
  await pool.end();
});

describe("coopRegistryRepo", () => {
  it("upsertMany inserts the fixture rows; the same file again inserts 0", async () => {
    expect(parsed.rows).toHaveLength(5);
    expect(await repo.upsertMany(rows, { userId: USER, batchId: "batch-1" })).toEqual({
      inserted: 5,
      duplicates: 0,
    });
    expect(await repo.upsertMany(rows, { userId: USER, batchId: "batch-2" })).toEqual({
      inserted: 0,
      duplicates: 5,
    });
  });

  it("list by cooperative returns every row with pricePerM2 derived, newest first", async () => {
    const { rows: listed, total } = await repo.list({ cooperative: COOP });
    expect(total).toBe(5);
    expect(listed.map((r) => r.date)).toEqual([...listed.map((r) => r.date)].sort().reverse());
    const orla = listed.find((r) => r.address === "Orła Białego" && r.flatNumber === `3|${stamp}`)!;
    expect(orla.pricePerM2).toBeCloseTo(520000 / 52.1, 6);
    expect(orla.rightType).toBe("wlasnosc_lokalu");
    expect(orla.priceKind).toBe("nieustalona");
  });

  it("list({ near }) filters by radius and never returns pos = null rows", async () => {
    const near = await repo.list({
      cooperative: COOP,
      near: { x: 360000, y: 504000, radiusM: 150 },
    });
    expect(near.total).toBe(2);
    expect(near.rows.every((r) => r.pos !== null)).toBe(true);
    const wide = await repo.list({
      cooperative: COOP,
      near: { x: 360000, y: 504000, radiusM: 10_000 },
    });
    expect(wide.total).toBe(3);
  });

  it("list as a session user goes through app_role + RLS and still sees the office's rows", async () => {
    const asUser = await repo.list(
      { cooperative: COOP },
      { id: `other-${stamp}`, role: "appraiser" },
    );
    expect(asUser.total).toBe(5);
  });

  it("stats: totals, per cooperative, needsGeocoding, lastImport from the batch table", async () => {
    await repo.recordBatch({
      id: `batch-${stamp}`,
      cooperative: COOP,
      fileName: "syntetyczny.xlsx",
      mapping: { address: 1 },
      rowsInserted: 5,
      rowsSkipped: parsed.skipped,
      rowsWarned: parsed.warnings,
      createdBy: USER,
    });
    const s = await repo.stats();
    expect(s.total).toBeGreaterThanOrEqual(5);
    expect(s.byCooperative[COOP]).toBe(5);
    expect(s.needsGeocoding).toBeGreaterThanOrEqual(2);
    expect(s.lastImport).toMatchObject({ file: "syntetyczny.xlsx", rows: 5 });
  });

  it("save inserts a manual row and corrects it by id (pos); remove deletes it", async () => {
    // rows[4] is the fixture's blank-flat row; give it a flat so its derived key is unique.
    const saved = await repo.save(
      { ...rows[4]!, source: "manual", flatNumber: `m-${stamp}`, pos: null },
      { userId: USER },
    );
    if (!saved.ok) throw new Error(saved.reason);
    expect(saved.row.pos).toBeNull();
    const fixed = await repo.save({ ...saved.row, pos: { x: 1, y: 2 } }, { userId: USER });
    if (!fixed.ok) throw new Error(fixed.reason);
    expect(fixed.row.id).toBe(saved.row.id);
    expect(fixed.row.pos).toEqual({ x: 1, y: 2 });
    await repo.remove(saved.row.id);
    expect((await repo.list({ text: rows[4]!.address, cooperative: COOP })).total).toBe(1);
  });

  it("save derives the key itself: the same facts as an imported row answer { ok: false, duplicate }", async () => {
    const dup = await repo.save({ ...rows[0]!, source: "manual" }, { userId: USER });
    expect(dup).toEqual({ ok: false, reason: "duplicate" });
    expect(await repo.save({ ...rows[0]!, area: 0 }, { userId: USER })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("correcting an imported row keeps its source and import batch", async () => {
    // Pick the imported row explicitly: the previous test added a manual row with the
    // same date, and same-date rows order by random id.
    const imported = (await repo.list({ cooperative: COOP, text: "Zmyślona" })).rows.find(
      (r) => r.source === "xls",
    )!;
    const fixed = await repo.save({ ...imported, pos: { x: 9, y: 9 } }, { userId: "someone-else" });
    if (!fixed.ok) throw new Error(fixed.reason);
    expect(fixed.row.source).toBe("xls");
    const [raw] = await db
      .select()
      .from(schema.coopTransaction)
      .where(like(schema.coopTransaction.id, fixed.row.id));
    expect(raw!.importBatchId).toBe("batch-1");
    expect(raw!.createdBy).toBe(USER);
  });

  it("remembers one column mapping per cooperative", async () => {
    expect(await repo.getMapping(COOP)).toBeNull();
    await repo.saveMapping(COOP, { address: 1, area: 4 });
    await repo.saveMapping(COOP, { address: 2, area: 5 });
    expect(await repo.getMapping(COOP)).toEqual({ address: 2, area: 5 });
  });
});
