import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import type { NewValuationInput, SessionUser } from "../src/ports/valuation";

/**
 * Ownership isolation (F-8, ADR-013): an `appraiser` sees only their own
 * valuations; an `admin` sees all. Two layers, both proven here:
 *  - app-layer filter in `valuationRepo` (primary) — Task 7.
 *  - Postgres RLS on `valuation` (defense-in-depth) — proven at the DB level
 *    with a raw SQL query that bypasses `valuationRepo` entirely.
 */

const appraiserA: SessionUser = { id: "user-rls-a", role: "appraiser" };
const appraiserB: SessionUser = { id: "user-rls-b", role: "appraiser" };
const admin: SessionUser = { id: "user-rls-admin", role: "admin" };

const repo = valuationRepo(db);

function valuationInput(ownerId: string, address: string): NewValuationInput {
  return {
    address,
    area: 33.3,
    stubWr: 333000,
    amountInWords: null,
    docUrl: null,
    ownerId,
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  for (const u of [appraiserA, appraiserB, admin]) {
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
  it("listForUser: appraiser sees only their own valuations", async () => {
    const mineA = await repo.create(valuationInput(appraiserA.id, "ul. RLS-A 1"));
    const mineB = await repo.create(valuationInput(appraiserB.id, "ul. RLS-B 1"));

    const listA = await repo.listForUser(appraiserA);
    expect(listA.some((w) => w.id === mineA.id)).toBe(true);
    expect(listA.some((w) => w.id === mineB.id)).toBe(false);
    expect(listA.every((w) => w.ownerId === appraiserA.id)).toBe(true);

    const listB = await repo.listForUser(appraiserB);
    expect(listB.some((w) => w.id === mineB.id)).toBe(true);
    expect(listB.some((w) => w.id === mineA.id)).toBe(false);
    expect(listB.every((w) => w.ownerId === appraiserB.id)).toBe(true);
  });

  it("listForUser: admin sees all valuations, across owners", async () => {
    const mineA = await repo.create(valuationInput(appraiserA.id, "ul. RLS-A 2"));
    const mineB = await repo.create(valuationInput(appraiserB.id, "ul. RLS-B 2"));

    const listAdmin = await repo.listForUser(admin);
    expect(listAdmin.some((w) => w.id === mineA.id)).toBe(true);
    expect(listAdmin.some((w) => w.id === mineB.id)).toBe(true);
  });

  it("get: appraiser cannot fetch another appraiser's valuation (returns null)", async () => {
    const mineA = await repo.create(valuationInput(appraiserA.id, "ul. RLS-A 3"));

    const asOwner = await repo.get(mineA.id, appraiserA);
    expect(asOwner?.id).toBe(mineA.id);

    const asOther = await repo.get(mineA.id, appraiserB);
    expect(asOther).toBeNull();
  });

  it("get: admin can fetch any valuation by id", async () => {
    const mineA = await repo.create(valuationInput(appraiserA.id, "ul. RLS-A 4"));

    const asAdmin = await repo.get(mineA.id, admin);
    expect(asAdmin?.id).toBe(mineA.id);
  });

  it("Postgres RLS enforces isolation at the DB level, independent of the app-layer filter", async () => {
    const mineA = await repo.create(valuationInput(appraiserA.id, "ul. RLS-A 5"));

    // Bypass valuationRepo entirely: raw SQL, as `app_role` with the session
    // GUCs set to appraiser B, querying by id with NO ownership WHERE
    // clause. If this returns 0 rows, the DB itself is blocking the row —
    // not the app-layer branch (which isn't exercised at all here).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_role");
      await client.query("SELECT set_config('app.user_id', $1, true)", [appraiserB.id]);
      await client.query("SELECT set_config('app.role', $1, true)", [appraiserB.role]);
      const result = await client.query("SELECT * FROM valuation WHERE id = $1", [mineA.id]);
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
    const mineA = await repo.create(valuationInput(appraiserA.id, "ul. RLS-A 6"));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_role");
      await client.query("SELECT set_config('app.user_id', $1, true)", [admin.id]);
      await client.query("SELECT set_config('app.role', $1, true)", [admin.role]);
      const result = await client.query("SELECT * FROM valuation WHERE id = $1", [mineA.id]);
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
