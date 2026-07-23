import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import type { FeaturesUpdate, SampleUpdate, SubjectUpdate } from "../src/domain/valuation";
import type { SessionUser } from "../src/ports/valuation";
import {
  approvableInput,
  confirmableInput,
  partialDraftInputs,
  valuationInput,
} from "./fixtures/valuation-inputs";

/** FR-12/NFR-6: every mutation leaves exactly one typed audit row, written
 * transactionally with the mutation itself. */
const owner: SessionUser = { id: "user-audit", role: "appraiser" };
const repo = valuationRepo(db);

async function auditRows(valuationId: string) {
  return db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.valuationId, valuationId))
    .orderBy(schema.auditLog.id); // bigserial — ascending = insertion order (Postgres gives no order without this)
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

  // confirmSubject/confirmKw/confirmFeatures share confirmSample's
  // select→domain→CAS-update→audit shape (valuation-drizzle.ts) — one
  // assertion each closes FR-12 coverage across all four confirm mutations.
  it("confirmSubject writes a 'subject_confirmed' row", async () => {
    const v = await repo.create(confirmableInput(owner.id));
    await repo.confirmSubject(v.id, owner);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "subject_confirmed"]);
  });

  it("confirmKw writes a 'kw_confirmed' row", async () => {
    const v = await repo.create(confirmableInput(owner.id));
    await repo.confirmKw(v.id, owner);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "kw_confirmed"]);
  });

  it("confirmFeatures writes a 'features_confirmed' row", async () => {
    const v = await repo.create(confirmableInput(owner.id));
    await repo.confirmFeatures(v.id, owner);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "features_confirmed"]);
  });

  // Wizard draft mutations (Slice 11a, Task 4) — same select->domain->CAS
  // update->audit shape as confirmSample above; one assertion each closes
  // FR-12 coverage across all four.
  it("saveSubject writes a 'subject_updated' row", async () => {
    const v = await repo.create({
      ...valuationInput(owner.id, "Audit Subject"),
      wr: null,
      inputs: partialDraftInputs(),
    });
    const update: SubjectUpdate = {
      address: "ul. Audytowa 1",
      area: 33,
      purpose: "sprzedaz",
      kwNumber: null,
      client: "Audit Subject Client",
      subject: null,
      subjectMeta: null,
      kw: null,
      kwMeta: null,
      provenance: {
        address: { source: "rzeczoznawca", status: "confirmed" },
        area: { source: "rzeczoznawca", status: "confirmed" },
      },
    };
    await repo.saveSubject(v.id, owner, update);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "subject_updated"]);
  });

  it("saveSample writes a 'sample_updated' row", async () => {
    const v = await repo.create({
      ...valuationInput(owner.id, "Audit Sample"),
      wr: null,
      inputs: partialDraftInputs(),
    });
    const update: SampleUpdate = {
      comparables: [{ pricePerM2: 10_000, source: "manual", status: "confirmed" }],
      sampleMeta: null,
    };
    await repo.saveSample(v.id, owner, update);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "sample_updated"]);
  });

  it("saveFeatures writes a 'features_updated' row", async () => {
    const v = await repo.create({
      ...valuationInput(owner.id, "Audit Features"),
      wr: null,
      inputs: partialDraftInputs(),
    });
    const update: FeaturesUpdate = {
      features: [{ name: "standard", weight: 1, rating: "przecietna" }],
      provenance: {
        weights: { source: "rzeczoznawca", status: "confirmed" },
        ratings: { source: "rzeczoznawca", status: "confirmed" },
      },
    };
    await repo.saveFeatures(v.id, owner, update);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "features_updated"]);
  });

  it("confirmCalculation writes a 'calculation_confirmed' row", async () => {
    const v = await repo.create(confirmableInput(owner.id));
    await repo.confirmCalculation(v.id, owner);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "calculation_confirmed"]);
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
