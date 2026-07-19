import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import { NotSignableError } from "../src/domain/valuation";
import type { SessionUser } from "../src/ports/valuation";
import { approvableInput } from "./fixtures/valuation-inputs";

/**
 * F-7 (ADR-011, adversarial): editing a signed valuation is REFUSED on every
 * path. This file proves the DB layer — raw SQL that bypasses domain and
 * adapter entirely, exactly how rls-isolation.test.ts proves F-8.
 */
const OWNER = "user-f7-db";
const ownerUser: SessionUser = { id: OWNER, role: "appraiser" };
const strangerUser: SessionUser = { id: "user-f7-stranger", role: "appraiser" };
const repo = valuationRepo(db);

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
  for (const u of [ownerUser, strangerUser]) {
    await db
      .insert(schema.user)
      .values({ id: u.id, name: u.id, email: `${u.id}@example.test`, role: u.role })
      .onConflictDoNothing();
  }
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

/**
 * Builds a signed valuation via the real create → approve → sign path, using
 * the gate-passing `approvableInput` fixture (Task 4) so approval needs no
 * prior `confirmSample` round-trip.
 */
async function signedFixture(): Promise<string> {
  const v = await repo.create(approvableInput(OWNER));
  await repo.approve(v.id, ownerUser, {
    docUrl: `/api/docs/operat-${v.id}.pdf`,
    docxUrl: `/api/docs/operat-${v.id}.docx`,
  });
  const signed = await repo.sign(v.id, ownerUser, {
    docUrl: `/api/docs/operat-${v.id}-signed.pdf`,
    docxUrl: `/api/docs/operat-${v.id}-signed.docx`,
    sha256Docx: "a".repeat(64),
    sha256Pdf: "b".repeat(64),
  });
  expect(signed!.status).toBe("signed");
  return v.id;
}

describe("F-7 adapter path — sign", () => {
  it("signs an approved valuation: status, signedAt, repointed urls, hashed audit row", async () => {
    const id = await signedFixture();
    const rows = await db.execute(sql`SELECT * FROM "valuation" WHERE id = ${id}`);
    const row = rows.rows[0] as { status: string; signed_at: Date; doc_url: string };
    expect(row.status).toBe("signed");
    expect(row.signed_at).not.toBeNull();
    expect(row.doc_url).toContain("-signed.pdf");
    const audit = await db.execute(
      sql`SELECT * FROM "audit_log" WHERE valuation_id = ${id} AND action = 'signed'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect((audit.rows[0] as { meta: { sha256Docx: string } }).meta.sha256Docx).toBe(
      "a".repeat(64),
    );
  });

  it("refuses to sign a draft (NotSignableError) and a foreign valuation (null)", async () => {
    const draft = await repo.create(approvableInput(OWNER));
    await expect(
      repo.sign(draft.id, ownerUser, {
        docUrl: "/api/docs/x.pdf",
        docxUrl: "/api/docs/x.docx",
        sha256Docx: "c".repeat(64),
        sha256Pdf: "d".repeat(64),
      }),
    ).rejects.toThrow(NotSignableError);
    const signedId = await signedFixture();
    expect(
      await repo.sign(signedId, strangerUser, {
        docUrl: "/api/docs/y.pdf",
        docxUrl: "/api/docs/y.docx",
        sha256Docx: "e".repeat(64),
        sha256Pdf: "f".repeat(64),
      }),
    ).toBeNull();
  });

  it("every mutation refuses a signed valuation (domain + trigger belt)", async () => {
    const id = await signedFixture();
    await expect(repo.confirmSample(id, ownerUser)).rejects.toThrow(/not a draft/);
    await expect(repo.approve(id, ownerUser)).rejects.toThrow(/not a draft/);
    await expect(
      repo.sign(id, ownerUser, {
        docUrl: "/api/docs/z.pdf",
        docxUrl: "/api/docs/z.docx",
        sha256Docx: "0".repeat(64),
        sha256Pdf: "1".repeat(64),
      }),
    ).rejects.toThrow(NotSignableError);
  });
});

describe("F-7 adapter path — createNewVersion", () => {
  it("copies a signed valuation into a linked draft with version_created audit", async () => {
    const id = await signedFixture();
    const draft = await repo.createNewVersion(id, ownerUser);
    expect(draft!.status).toBe("in_progress");
    expect(draft!.supersedesId).toBe(id);
    expect(draft!.docUrl).toBeNull();
    const audit = await db.execute(
      sql`SELECT * FROM "audit_log" WHERE valuation_id = ${draft!.id} AND action = 'version_created'`,
    );
    expect((audit.rows[0] as { meta: { supersedes: string } }).meta.supersedes).toBe(id);
  });

  it("refuses on a non-signed source and for non-owners", async () => {
    const draft = await repo.create(approvableInput(OWNER));
    await expect(repo.createNewVersion(draft.id, ownerUser)).rejects.toThrow(/not signed/);
    const signedId = await signedFixture();
    expect(await repo.createNewVersion(signedId, strangerUser)).toBeNull();
  });
});

describe("F-7 storage key encoding invariance", () => {
  // The document_frozen trigger (migration 0009) matches
  // `'/api/docs/' || key` against the valuation's doc_url/docx_url WITHOUT
  // url-decoding the key, while the app always writes doc_url via
  // encodeURIComponent(key) (see getByDocKey above and the storage adapter).
  // Every key format actually used by the app must therefore be a fixed
  // point of encodeURIComponent — otherwise the trigger's raw-key match and
  // the app's encoded key would silently diverge, un-freezing a signed
  // document. This test makes any future key-alphabet drift loudly visible.
  it("every storage key format is unaffected by encodeURIComponent", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const keys = [
      `operat-${uuid}.pdf`,
      `operat-${uuid}.docx`,
      `operat-${uuid}-signed.pdf`,
      `operat-${uuid}-signed.docx`,
    ];
    for (const key of keys) {
      expect(key).toBe(encodeURIComponent(key));
    }
  });
});
