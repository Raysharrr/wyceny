import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";

/**
 * F-7 (ADR-011, adversarial): editing a signed valuation is REFUSED on every
 * path. This file proves the DB layer — raw SQL that bypasses domain and
 * adapter entirely, exactly how rls-isolation.test.ts proves F-8.
 */
const OWNER = "user-f7-db";

// drizzle-orm 0.45 wraps the raw pg error in a DrizzleQueryError whose
// `.message` is "Failed query: ..."; the trigger's RAISE EXCEPTION text
// lands in `.cause.message`. Assert there instead of on the outer message.
async function expectRejectionMatching(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toHaveProperty("cause.message", expect.stringMatching(pattern));
}

async function insertValuation(status: string): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO "valuation" (address, area, stub_wr, owner_id, status, doc_url, docx_url)
    VALUES ('F7 test', 40, 400000, ${OWNER}, ${status},
            '/api/docs/f7-doc-' || gen_random_uuid(), '/api/docs/f7-docx-' || gen_random_uuid())
    RETURNING id`);
  return (rows.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db
    .insert(schema.user)
    .values({ id: OWNER, name: OWNER, email: `${OWNER}@example.test`, role: "appraiser" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await pool.end();
});

describe("F-7 DB-level write-once (triggers)", () => {
  it("refuses UPDATE of any column on a signed valuation", async () => {
    const id = await insertValuation("signed");
    await expectRejectionMatching(
      db.execute(sql`UPDATE "valuation" SET address = 'tampered' WHERE id = ${id}`),
      /write-once/,
    );
  });

  it("refuses un-signing (status downgrade)", async () => {
    const id = await insertValuation("signed");
    await expectRejectionMatching(
      db.execute(sql`UPDATE "valuation" SET status = 'in_progress' WHERE id = ${id}`),
      /write-once/,
    );
  });

  it("refuses DELETE of a signed valuation", async () => {
    const id = await insertValuation("signed");
    await expectRejectionMatching(
      db.execute(sql`DELETE FROM "valuation" WHERE id = ${id}`),
      /write-once/,
    );
  });

  it("still allows UPDATE of a draft (trigger is WHEN-scoped)", async () => {
    const id = await insertValuation("in_progress");
    await db.execute(sql`UPDATE "valuation" SET address = 'still editable' WHERE id = ${id}`);
    const rows = await db.execute(sql`SELECT address FROM "valuation" WHERE id = ${id}`);
    expect((rows.rows[0] as { address: string }).address).toBe("still editable");
  });

  it("audit_log accepts INSERT but refuses UPDATE and DELETE", async () => {
    await db.execute(sql`INSERT INTO "audit_log" (actor_id, action) VALUES (${OWNER}, 'created')`);
    await expectRejectionMatching(
      db.execute(sql`UPDATE "audit_log" SET action = 'tampered' WHERE actor_id = ${OWNER}`),
      /append-only/,
    );
    await expectRejectionMatching(
      db.execute(sql`DELETE FROM "audit_log" WHERE actor_id = ${OWNER}`),
      /append-only/,
    );
  });

  it("freezes document rows referenced by a signed valuation, leaves others mutable", async () => {
    const id = await insertValuation("signed");
    const rows = await db.execute(sql`SELECT doc_url FROM "valuation" WHERE id = ${id}`);
    const frozenKey = (rows.rows[0] as { doc_url: string }).doc_url.replace("/api/docs/", "");
    await db.execute(
      sql`INSERT INTO "document" (key, content_bytes) VALUES (${frozenKey}, ${Buffer.from("frozen")})`,
    );
    await expectRejectionMatching(
      db.execute(
        sql`UPDATE "document" SET content_bytes = ${Buffer.from("tampered")} WHERE key = ${frozenKey}`,
      ),
      /frozen/,
    );
    await expectRejectionMatching(
      db.execute(sql`DELETE FROM "document" WHERE key = ${frozenKey}`),
      /frozen/,
    );
    // Unreferenced key (approve-retry orphan path) stays overwritable. Random
    // suffix keeps the row unique across repeated runs against a persistent
    // dev DB (this table has no cleanup step).
    const orphanRows = await db.execute(
      sql`INSERT INTO "document" (key, content_bytes) VALUES ('f7-orphan-' || gen_random_uuid(), ${Buffer.from("v1")}) RETURNING key`,
    );
    const orphanKey = (orphanRows.rows[0] as { key: string }).key;
    await db.execute(
      sql`UPDATE "document" SET content_bytes = ${Buffer.from("v2")} WHERE key = ${orphanKey}`,
    );
  });
});
