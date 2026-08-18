import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import type { FeaturesUpdate, SampleUpdate, SubjectUpdate } from "../src/domain/valuation";
import type { SessionUser } from "../src/ports/valuation";
import type { ProseSnapshot } from "../src/domain/prose-snapshot";
import {
  approvableInput,
  confirmableInput,
  partialDraftInputs,
  valuationInput,
  withConfirmedProse,
} from "./fixtures/valuation-inputs";

/** FR-12/NFR-6: every mutation leaves its typed audit row(s), written
 * transactionally with the mutation itself. Since T7 a wizard step save is
 * TWO recorded acts — the write and the appraiser's confirmation of it —
 * because after T8 the save is the only place a confirmation can happen, and
 * a trail that stopped recording it would stop showing who vouched for the
 * data under the signature. */
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

  /**
   * T7 fix round 1: the create path performs the step-1 confirmation, so it
   * has to NAME it. "Implied by the `created` row" is a footnote nobody
   * reconstructing who confirmed what will have — and in this domain that
   * reconstruction is the trail's whole job.
   */
  it("a create that carries the step-1 confirmation records it as its own act", async () => {
    const v = await repo.create(
      {
        ...valuationInput(owner.id, "Audit Create Confirm"),
        wr: null,
        inputs: partialDraftInputs(),
      },
      { confirmed: ["subject_confirmed", "kw_confirmed"] },
    );
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "subject_confirmed", "kw_confirmed"]);
    expect(rows.every((r) => r.actorId === owner.id)).toBe(true);
  });

  it("a create with no confirmation to record writes only 'created'", async () => {
    const v = await repo.create({
      ...valuationInput(owner.id, "Audit Create Plain"),
      wr: null,
      inputs: partialDraftInputs(),
    });
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created"]);
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
  it("saveProse writes a 'prose_generated' row carrying the model and the token cost", async () => {
    const v = await repo.create({
      ...valuationInput(owner.id, "Audit Prose"),
      wr: null,
      inputs: partialDraftInputs(),
    });
    const snapshot: ProseSnapshot = {
      sections: {
        opis_lokalu: {
          value: "Lokal obejmuje dwa pokoje z kuchnią.",
          provenance: { source: "ai", status: "to_verify" },
        },
      },
      rejected: { analiza_rynku: ["9 871,00"] },
      // T2 fix round 1: this must be a per-section map, not the old single
      // `factsHash` string — the adapter now normalizes a legacy-shaped
      // (single-hash) `prose` on read by adding an EMPTY `factsHashes`, so a
      // fixture still using the old field would no longer round-trip
      // byte-for-byte through `saveProse`/`toEqual` below.
      factsHashes: { opis_lokalu: "a".repeat(64) },
      model: "claude-sonnet-5",
      generatedAt: "2026-08-18T07:30:00.000Z",
    };

    const saved = await repo.saveProse(v.id, owner, snapshot, {
      inputTokens: 3120,
      outputTokens: 480,
    });

    expect(saved?.inputs?.prose).toEqual(snapshot);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "prose_generated"]);
    // FR-6: the cost of a generation is logged even when a section failed —
    // those tokens were spent too. The prose TEXT never enters the audit row.
    expect(rows[1].meta).toEqual({
      model: "claude-sonnet-5",
      sections: ["opis_lokalu"],
      rejected: { analiza_rynku: ["9 871,00"] },
      inputTokens: 3120,
      outputTokens: 480,
    });
  });

  it("confirmProse writes a 'prose_confirmed' row and flips the sections to the appraiser", async () => {
    const v = await repo.create({
      ...valuationInput(owner.id, "Audit Prose Confirm"),
      wr: null,
      inputs: partialDraftInputs(),
    });
    await repo.saveProse(
      v.id,
      owner,
      {
        sections: {
          opis_lokalu: {
            value: "Lokal obejmuje dwa pokoje z kuchnią.",
            provenance: { source: "ai", status: "to_verify" },
          },
          otoczenie: {
            value: "Zabudowa wielorodzinna.",
            provenance: { source: "ai", status: "to_verify" },
          },
        },
        rejected: { analiza_rynku: ["9 871,00"] },
        factsHashes: { opis_lokalu: "a".repeat(64), otoczenie: "a".repeat(64) },
        model: "claude-sonnet-5",
        generatedAt: "2026-08-18T07:30:00.000Z",
      },
      { inputTokens: 3120, outputTokens: 480 },
    );

    // The appraiser accepted the first section, edited nothing into the
    // second and left it blank — the blank one must NOT survive as `ai`.
    const saved = await repo.confirmProse(v.id, owner, {
      opis_lokalu: "Lokal obejmuje dwa pokoje, kuchnię w aneksie i łazienkę.",
      otoczenie: "",
    });

    expect(saved?.inputs?.prose?.sections).toEqual({
      opis_lokalu: {
        value: "Lokal obejmuje dwa pokoje, kuchnię w aneksie i łazienkę.",
        provenance: { source: "rzeczoznawca", status: "confirmed" },
      },
    });
    // T7 (T6 review, I-2): the confirm re-stamps the fingerprint with the
    // facts the appraiser accepted the text against — computed by the adapter
    // from the row inside this transaction, so it is NOT the "a"*64 the
    // generation carried. Per section since T2, and only for the section that
    // survived the confirm: the blank one carries no text to fingerprint.
    expect(saved?.inputs?.prose?.factsHashes?.opis_lokalu).not.toBe("a".repeat(64));
    expect(saved?.inputs?.prose?.factsHashes?.opis_lokalu).toMatch(/^[0-9a-f]{64}$/);
    expect(saved?.inputs?.prose?.factsHashes?.otoczenie).toBeUndefined();
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "prose_generated", "prose_confirmed"]);
    // FR-12: the audit says WHICH sections the appraiser took responsibility
    // for — never their text (the operat itself carries that).
    expect(rows[2].meta).toEqual({ sections: ["opis_lokalu"] });
  });

  it("saveSubject writes 'subject_updated' + the confirmations that save performs", async () => {
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
    // No `kw_confirmed`: this update attaches no KW extract, so there is
    // nothing of the sort for the appraiser to have confirmed.
    expect(rows.map((r) => r.action)).toEqual(["created", "subject_updated", "subject_confirmed"]);
  });

  it("saveSubject with a KW extract attached records the kw confirmation too", async () => {
    const v = await repo.create({
      ...valuationInput(owner.id, "Audit Subject KW"),
      wr: null,
      inputs: partialDraftInputs(),
    });
    const update: SubjectUpdate = {
      address: "ul. Klonowa 4, m. Nowogród",
      area: 33,
      purpose: "sprzedaz",
      kwNumber: "KW-TEST-1",
      client: "p. Jan Testowy",
      subject: null,
      subjectMeta: null,
      kw: {
        source: "odpis_kw",
        kwLokalu: "KW-TEST-1",
        kwGruntu: "KW-TEST-1",
        kwInne: [],
        deweloperski: false,
        powUzytkowaKw: null,
        udzial: null,
        sad: null,
        wydzial: null,
        dataDokumentu: null,
        dzial3: null,
        dzial4: null,
      },
      kwMeta: null,
      provenance: {
        address: { source: "rzeczoznawca", status: "confirmed" },
        area: { source: "rzeczoznawca", status: "confirmed" },
        kw: { source: "odpis_kw", status: "to_verify" },
      },
    };
    await repo.saveSubject(v.id, owner, update);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual([
      "created",
      "subject_updated",
      "subject_confirmed",
      "kw_confirmed",
    ]);
  });

  it("saveSample writes 'sample_updated' + 'sample_confirmed'", async () => {
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
    expect(rows.map((r) => r.action)).toEqual(["created", "sample_updated", "sample_confirmed"]);
  });

  it("saveFeatures writes 'features_updated' + 'features_confirmed'", async () => {
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
    expect(rows.map((r) => r.action)).toEqual([
      "created",
      "features_updated",
      "features_confirmed",
    ]);
  });

  it("confirmCalculation writes a 'calculation_confirmed' row", async () => {
    const v = await repo.create(confirmableInput(owner.id));
    await repo.confirmCalculation(v.id, owner);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "calculation_confirmed"]);
  });

  it("approve writes an 'approved' row with doc urls in meta", async () => {
    const base = approvableInput(owner.id);
    const v = await repo.create({
      ...base,
      inputs: withConfirmedProse(base.address, base.inputs!),
    });
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
