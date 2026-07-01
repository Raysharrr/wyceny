import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { wycenyRepo } from "../src/adapters/wyceny-drizzle";
import type { NewWycenaInput, SessionUser } from "../src/ports/wyceny";

/**
 * Ownership isolation (F-8, ADR-013): a `rzeczoznawca` sees only their own
 * wyceny; an `admin` sees all. Two layers, both proven here:
 *  - app-layer filter in `wycenyRepo` (primary) — Task 7.
 *  - Postgres RLS on `wycena` (defense-in-depth) — proven at the DB level
 *    with a raw SQL query that bypasses `wycenyRepo` entirely.
 */

const rzeczoznawcaA: SessionUser = { id: "user-rls-a", role: "rzeczoznawca" };
const rzeczoznawcaB: SessionUser = { id: "user-rls-b", role: "rzeczoznawca" };
const admin: SessionUser = { id: "user-rls-admin", role: "admin" };

const repo = wycenyRepo(db);

function wycenaInput(ownerId: string, address: string): NewWycenaInput {
  return {
    address,
    area: 33.3,
    stubWr: 333000,
    slownie: null,
    docUrl: null,
    ownerId,
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  for (const u of [rzeczoznawcaA, rzeczoznawcaB, admin]) {
    await db
      .insert(schema.user)
      .values({ id: u.id, name: u.id, email: `${u.id}@example.test`, role: u.role })
      .onConflictDoNothing();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("ownership isolation (F-8)", () => {
  it("listForUser: rzeczoznawca sees only their own wyceny", async () => {
    const mineA = await repo.create(wycenaInput(rzeczoznawcaA.id, "ul. RLS-A 1"));
    const mineB = await repo.create(wycenaInput(rzeczoznawcaB.id, "ul. RLS-B 1"));

    const listA = await repo.listForUser(rzeczoznawcaA);
    expect(listA.some((w) => w.id === mineA.id)).toBe(true);
    expect(listA.some((w) => w.id === mineB.id)).toBe(false);
    expect(listA.every((w) => w.ownerId === rzeczoznawcaA.id)).toBe(true);

    const listB = await repo.listForUser(rzeczoznawcaB);
    expect(listB.some((w) => w.id === mineB.id)).toBe(true);
    expect(listB.some((w) => w.id === mineA.id)).toBe(false);
    expect(listB.every((w) => w.ownerId === rzeczoznawcaB.id)).toBe(true);
  });

  it("listForUser: admin sees all wyceny, across owners", async () => {
    const mineA = await repo.create(wycenaInput(rzeczoznawcaA.id, "ul. RLS-A 2"));
    const mineB = await repo.create(wycenaInput(rzeczoznawcaB.id, "ul. RLS-B 2"));

    const listAdmin = await repo.listForUser(admin);
    expect(listAdmin.some((w) => w.id === mineA.id)).toBe(true);
    expect(listAdmin.some((w) => w.id === mineB.id)).toBe(true);
  });

  it("get: rzeczoznawca cannot fetch another rzeczoznawca's wycena (returns null)", async () => {
    const mineA = await repo.create(wycenaInput(rzeczoznawcaA.id, "ul. RLS-A 3"));

    const asOwner = await repo.get(mineA.id, rzeczoznawcaA);
    expect(asOwner?.id).toBe(mineA.id);

    const asOther = await repo.get(mineA.id, rzeczoznawcaB);
    expect(asOther).toBeNull();
  });

  it("get: admin can fetch any wycena by id", async () => {
    const mineA = await repo.create(wycenaInput(rzeczoznawcaA.id, "ul. RLS-A 4"));

    const asAdmin = await repo.get(mineA.id, admin);
    expect(asAdmin?.id).toBe(mineA.id);
  });

  it("Postgres RLS enforces isolation at the DB level, independent of the app-layer filter", async () => {
    const mineA = await repo.create(wycenaInput(rzeczoznawcaA.id, "ul. RLS-A 5"));

    // Bypass wycenyRepo entirely: raw SQL, as `app_role` with the session
    // GUCs set to rzeczoznawca B, querying by id with NO ownership WHERE
    // clause. If this returns 0 rows, the DB itself is blocking the row —
    // not the app-layer branch (which isn't exercised at all here).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_role");
      await client.query("SELECT set_config('app.user_id', $1, true)", [rzeczoznawcaB.id]);
      await client.query("SELECT set_config('app.role', $1, true)", [rzeczoznawcaB.role]);
      const result = await client.query("SELECT * FROM wycena WHERE id = $1", [mineA.id]);
      expect(result.rows).toHaveLength(0);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  it("Postgres RLS: admin GUC sees the row at the DB level too", async () => {
    const mineA = await repo.create(wycenaInput(rzeczoznawcaA.id, "ul. RLS-A 6"));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_role");
      await client.query("SELECT set_config('app.user_id', $1, true)", [admin.id]);
      await client.query("SELECT set_config('app.role', $1, true)", [admin.role]);
      const result = await client.query("SELECT * FROM wycena WHERE id = $1", [mineA.id]);
      expect(result.rows).toHaveLength(1);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
});
