import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import type { SessionUser } from "../src/ports/valuation";
import { approvableInput, confirmableInput } from "./fixtures/valuation-inputs";

/** FR-12/NFR-6: every mutation leaves exactly one typed audit row, written
 * transactionally with the mutation itself. */
const owner: SessionUser = { id: "user-audit", role: "appraiser" };
const repo = valuationRepo(db);

async function auditRows(valuationId: string) {
  return db.select().from(schema.auditLog).where(eq(schema.auditLog.valuationId, valuationId));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db
    .insert(schema.user)
    .values({ id: owner.id, name: owner.id, email: `${owner.id}@example.test`, role: "appraiser" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await pool.end();
});

describe("audit_log per mutation", () => {
  it("create writes a 'created' row with the actor", async () => {
    const v = await repo.create({
      address: "Audit 1",
      area: 40,
      wr: 400000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      ownerId: owner.id,
    });
    const rows = await auditRows(v.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("created");
    expect(rows[0].actorId).toBe(owner.id);
  });

  it("confirmSample writes a 'sample_confirmed' row", async () => {
    const v = await repo.create(confirmableInput(owner.id));
    await repo.confirmSample(v.id, owner);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "sample_confirmed"]);
  });

  it("approve writes an 'approved' row with doc urls in meta", async () => {
    const v = await repo.create(approvableInput(owner.id));
    await repo.approve(v.id, owner, { docUrl: "/api/docs/a.pdf", docxUrl: "/api/docs/a.docx" });
    const rows = await auditRows(v.id);
    expect(rows.at(-1)!.action).toBe("approved");
    expect(rows.at(-1)!.meta).toMatchObject({ docUrl: "/api/docs/a.pdf" });
  });

  it("a failed mutation writes NO audit row (same transaction)", async () => {
    const v = await repo.create({
      address: "Audit fail",
      area: 40,
      wr: 400000,
      inputs: null, // confirmSample throws: no inputs snapshot
      amountInWords: null,
      docUrl: null,
      ownerId: owner.id,
    });
    await expect(repo.confirmSample(v.id, owner)).rejects.toThrow();
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created"]);
  });
});
