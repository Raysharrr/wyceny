import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";

/**
 * Office-level RLS on `coop_transaction` (migration 0014, spec §4.3, decision
 * 2026-09-12): the register is shared by the whole office, so — unlike
 * `valuation` (F-8, owner isolation) — a logged-in user A SEES a row user B
 * inserted. A connection with no `app.user_id` sees nothing. Proven at the DB
 * level as `app_role` with raw SQL, bypassing every adapter.
 */

const stamp = `rls-${Date.now()}`;
const userA = `coop-rls-a-${stamp}`;
const userB = `coop-rls-b-${stamp}`;
const rowId = `coop-tx-${stamp}`;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  // Inserted as the superuser pool connection — exactly how the import writes.
  await db.insert(schema.coopTransaction).values({
    id: rowId,
    cooperative: "SM Syntetyczna",
    address: "Zmyślona",
    buildingNumber: "1",
    flatNumber: "2",
    area: 40,
    priceTotal: 400000,
    date: "2025-01-02",
    priceKind: "nieustalona",
    rightType: null,
    source: "manual",
    dedupeKey: `zmyślona 1|2|2025-01-02|400000|${stamp}`,
    createdBy: userB,
  });
});

afterAll(async () => {
  await db.delete(schema.coopTransaction).where(sql`id = ${rowId}`);
  await pool.end();
});

async function countAsAppRole(userId: string | null): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_role`);
    if (userId !== null) await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    const res = await tx.execute(
      sql`select count(*)::int as n from coop_transaction where id = ${rowId}`,
    );
    return (res.rows[0] as { n: number }).n;
  });
}

describe("coop_transaction RLS (office-level, 0014)", () => {
  it("user A sees the row user B inserted", async () => {
    expect(await countAsAppRole(userA)).toBe(1);
  });

  it("the author sees it too (no owner filter at all)", async () => {
    expect(await countAsAppRole(userB)).toBe(1);
  });

  it("a connection without app.user_id sees nothing", async () => {
    expect(await countAsAppRole(null)).toBe(0);
  });

  it("migration 0014 is re-runnable (IF NOT EXISTS / DO $$ / DROP POLICY IF EXISTS)", async () => {
    // Replays the file verbatim against the already-migrated database. This
    // is the property 0003 lacks (bare CREATE ROLE) and the reason 0014 must
    // not inherit it — see HANDOFF Task 3.
    const { readFileSync } = await import("node:fs");
    const file = readFileSync("drizzle/0014_coop_registry.sql", "utf8");
    for (const stmt of file.split("--> statement-breakpoint")) {
      if (stmt.trim()) await db.execute(sql.raw(stmt));
    }
    expect(await countAsAppRole(userA)).toBe(1);
  });
});
