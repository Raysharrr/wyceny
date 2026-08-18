import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import { ApprovalBlockedError, NotSignableError } from "../src/domain/valuation";
import type { SessionUser } from "../src/ports/valuation";
import { approvalGate } from "../src/domain/provenance";
import { PROSE_SECTIONS, type ProseSection } from "../src/domain/prose-snapshot";
import { approvableInput, confirmedProse, confirmedProseFor } from "./fixtures/valuation-inputs";

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

/**
 * FR-6 (Task 7): the operat's prose lives inside `inputs`, so it is covered by
 * the write-once machinery already here — no new column, no new trigger, no
 * DDL. This block proves that rather than assuming it, and marks where the
 * protection actually starts.
 */
describe("F-7 + FR-6 — the confirmed prose is frozen with everything else", () => {
  async function draftWithProse() {
    const base = approvableInput(OWNER);
    const prose = confirmedProseFor(base.address, base.inputs!);
    return repo.create({ ...base, inputs: { ...base.inputs!, prose } });
  }

  it("the in-transaction gate itself refuses a draft without confirmed prose", async () => {
    // ADR-012: the gate is re-run inside the write transaction, not only in
    // the action — so a caller that skips the action gains nothing.
    const bare = await repo.create(approvableInput(OWNER));
    await expect(
      repo.approve(bare.id, ownerUser, undefined, undefined, undefined, undefined, {
        requireProse: true,
      }),
    ).rejects.toThrow(ApprovalBlockedError);

    const withProse = await draftWithProse();
    const approved = await repo.approve(
      withProse.id,
      ownerUser,
      {
        docUrl: `/api/docs/operat-${withProse.id}.pdf`,
        docxUrl: `/api/docs/operat-${withProse.id}.docx`,
      },
      undefined,
      undefined,
      undefined,
      { requireProse: true },
    );
    expect(approved!.status).toBe("approved");
  });

  it("the in-transaction gate derives the fingerprint ITSELF — a caller cannot walk stale prose past it", async () => {
    // Prose confirmed against some earlier state of the draft. The action
    // would refuse it; this goes straight to the repo, which recomputes the
    // fingerprint from its own row (ADR-012) instead of taking anyone's word.
    const base = approvableInput(OWNER);
    const stale = await repo.create({
      ...base,
      inputs: { ...base.inputs!, prose: confirmedProse("9".repeat(64)) },
    });

    await expect(
      repo.approve(stale.id, ownerUser, undefined, undefined, undefined, undefined, {
        requireProse: true,
      }),
    ).rejects.toThrow(ApprovalBlockedError);

    // …and one pass through step 6 — no regeneration, the same six texts —
    // clears it, because the confirm re-stamps the fingerprint (T7).
    const texts = Object.fromEntries(
      PROSE_SECTIONS.map((section) => [section, confirmedProse().sections[section]!.value]),
    );
    await repo.confirmProse(stale.id, ownerUser, texts);

    const approved = await repo.approve(
      stale.id,
      ownerUser,
      {
        docUrl: `/api/docs/operat-${stale.id}.pdf`,
        docxUrl: `/api/docs/operat-${stale.id}.docx`,
      },
      undefined,
      undefined,
      undefined,
      { requireProse: true },
    );
    expect(approved!.status).toBe("approved");
  });

  it("REPLACES the caller's fingerprints — matching hashes, or none at all, buy nothing", async () => {
    // The gate takes its per-section hashes as an OPTION (T4), and
    // `approveValuation` in the domain takes the whole options object as a
    // parameter — so a caller could hand in the snapshot's own hashes, or an
    // empty map (which disables the check section by section), and the domain
    // would have no way to know. ADR-012's answer is that the repo OVERWRITES
    // that field with hashes computed from the row it just read; these two
    // payloads pin it. Both would approve if the repo merged instead.
    const base = approvableInput(OWNER);
    const claimed: Array<Partial<Record<ProseSection, string>>> = [
      confirmedProse("9".repeat(64)).factsHashes,
      {},
    ];

    for (const currentSectionHashes of claimed) {
      const stale = await repo.create({
        ...base,
        inputs: { ...base.inputs!, prose: confirmedProse("9".repeat(64)) },
      });
      await expect(
        repo.approve(stale.id, ownerUser, undefined, undefined, undefined, undefined, {
          requireProse: true,
          currentSectionHashes,
        }),
      ).rejects.toThrow(ApprovalBlockedError);
    }
  });

  it("a new version inherits the text but NOT the confirmation (through the real jsonb round trip)", async () => {
    // The domain rule has its own unit test; this one walks the only
    // production caller — createNewVersion — so the reset is proven to
    // survive the write and the read back, not just the pure function.
    const v = await draftWithProse();
    await repo.approve(v.id, ownerUser, {
      docUrl: `/api/docs/operat-${v.id}.pdf`,
      docxUrl: `/api/docs/operat-${v.id}.docx`,
    });
    await repo.sign(v.id, ownerUser, {
      docUrl: `/api/docs/operat-${v.id}-signed.pdf`,
      docxUrl: `/api/docs/operat-${v.id}-signed.docx`,
      sha256Docx: "c".repeat(64),
      sha256Pdf: "d".repeat(64),
    });

    const successor = await repo.createNewVersion(v.id, ownerUser);
    const inherited = successor!.inputs!.prose!;
    const original = confirmedProse(); // same six texts, fingerprint irrelevant here

    for (const section of PROSE_SECTIONS) {
      expect(inherited.sections[section]!.provenance).toEqual({
        source: "rzeczoznawca",
        status: "to_verify",
      });
      expect(inherited.sections[section]!.value).toBe(original.sections[section]!.value);
    }
    // …and the successor is refused until the appraiser walks step 6 again.
    const gate = approvalGate(successor!.inputs!, { requireProse: true });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.blockers.map((b) => b.path)).toEqual(
        expect.arrayContaining(PROSE_SECTIONS.map((s) => `prose.${s}`)),
      );
    }
  });

  it("survives approve and sign byte-for-byte, and no mutation can touch it afterwards", async () => {
    const v = await draftWithProse();
    const before = JSON.stringify(v.inputs!.prose);

    await repo.approve(v.id, ownerUser, {
      docUrl: `/api/docs/operat-${v.id}.pdf`,
      docxUrl: `/api/docs/operat-${v.id}.docx`,
    });
    // An approved operat already refuses further prose writes — but that
    // refusal comes from the DOMAIN (`assertDraft`), not from the trigger.
    await expect(repo.confirmProse(v.id, ownerUser, { standard: "Podmiana." })).rejects.toThrow(
      /not a draft/,
    );

    await repo.sign(v.id, ownerUser, {
      docUrl: `/api/docs/operat-${v.id}-signed.pdf`,
      docxUrl: `/api/docs/operat-${v.id}-signed.docx`,
      sha256Docx: "a".repeat(64),
      sha256Pdf: "b".repeat(64),
    });

    const rows = await db.execute(sql`SELECT inputs FROM "valuation" WHERE id = ${v.id}`);
    const after = (rows.rows[0] as { inputs: { prose: unknown } }).inputs.prose;
    expect(JSON.stringify(after)).toBe(before);

    // Signed: the trigger takes over, so even raw SQL cannot rewrite the text.
    await expectRejectionMatching(
      db.execute(
        sql`UPDATE "valuation" SET inputs = jsonb_set(inputs, '{prose,sections,standard,value}', '"Podmieniony tekst."') WHERE id = ${v.id}`,
      ),
      /write-once/,
    );
  });

  it("KNOWN LIMIT: before signing, only application code protects an approved operat", async () => {
    // The write-once trigger fires on status='signed'. An approved-but-unsigned
    // row is guarded by `assertDraft` and the action's status check alone — raw
    // SQL still goes through. Named here on purpose (Slice 13 limitation, not a
    // regression) so nobody reads the block above as more than it is.
    const v = await draftWithProse();
    await repo.approve(v.id, ownerUser, {
      docUrl: `/api/docs/operat-${v.id}.pdf`,
      docxUrl: `/api/docs/operat-${v.id}.docx`,
    });

    await db.execute(
      sql`UPDATE "valuation" SET inputs = jsonb_set(inputs, '{prose,sections,standard,value}', '"Podmieniony poza aplikacją."') WHERE id = ${v.id}`,
    );

    const rows = await db.execute(sql`SELECT inputs FROM "valuation" WHERE id = ${v.id}`);
    const prose = (
      rows.rows[0] as { inputs: { prose: { sections: Record<string, { value: string }> } } }
    ).inputs.prose;
    expect(prose.sections.standard.value).toBe("Podmieniony poza aplikacją.");
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
