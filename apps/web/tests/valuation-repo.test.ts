import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import { ApprovalBlockedError, assertNotSigned } from "../src/domain/valuation";
import type { KcsInput } from "../src/domain/kcs";
import type { NewValuationInput, SessionUser, Valuation } from "../src/ports/valuation";

const appraiserA: SessionUser = { id: "user-test-1", role: "appraiser" };
const appraiserB: SessionUser = { id: "user-test-2", role: "appraiser" };
const admin: SessionUser = { id: "user-test-admin", role: "admin" };

const repo = valuationRepo(db);

function valuationInput(ownerId: string, address: string): NewValuationInput {
  return {
    address,
    area: 33.3,
    wr: 333000,
    inputs: null,
    amountInWords: null,
    docUrl: null,
    // Document fields present by default so gate-passing approvals also clear
    // the document-field blockers (spec §4); the legacy-draft test overrides
    // them to null.
    purpose: "sprzedaz",
    kwNumber: "KW-TEST-1",
    client: "p. Jan Testowy",
    inspectionDate: "2026-07-01",
    ownerId,
  };
}

function approvableInputs(): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i,
      source: "rcn" as const,
      transactionId: `tx-${i}`,
      status: "to_verify" as const,
    })),
    features: [{ name: "standard", weight: 1, rating: "przecietna" as const }],
    sampleMeta: {
      lat: 52.4,
      lon: 16.9,
      fetchedAt: "2026-07-14T09:00:00.000Z",
      source: "rcn-wfs-gugik",
      query: { bbox: [1, 2, 3, 4], count: 5000, sort: "dok_data D" },
    },
    provenance: {
      address: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      area: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      weights: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      ratings: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      geocode: { source: "geokoder" as const, status: "to_verify" as const },
    },
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

describe("valuationRepo (integration, real Postgres)", () => {
  it("creates a Valuation and gets it back with the same fields, status in_progress", async () => {
    const input: NewValuationInput = {
      address: "ul. Testowa 1, Warszawa",
      area: 54.3,
      wr: 1044400,
      inputs: null,
      amountInWords: "milion czterdzieści cztery tysiące czterysta złotych",
      docUrl: null,
      ownerId: appraiserA.id,
    };

    const created = await repo.create(input);

    expect(created.id).toBeTruthy();
    expect(created.status).toBe("in_progress");
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created).toMatchObject(input);

    const fetched = await repo.get(created.id, appraiserA);

    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.status).toBe("in_progress");
    expect(fetched).toMatchObject(input);
  });

  it("listForUser returns only valuations owned by that user", async () => {
    const mine = await repo.create({
      address: "ul. Moja 1",
      area: 10,
      wr: 100000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      ownerId: appraiserA.id,
    });
    await repo.create({
      address: "ul. Cudza 2",
      area: 20,
      wr: 200000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      ownerId: appraiserB.id,
    });

    const list = await repo.listForUser(appraiserA);

    expect(list.some((w) => w.id === mine.id)).toBe(true);
    expect(list.every((w) => w.ownerId === appraiserA.id)).toBe(true);
  });

  it("throws when assertNotSigned is called on a signed Valuation (write-once, F-7)", async () => {
    const created = await repo.create({
      address: "ul. Podpisana 2, Kraków",
      area: 40,
      wr: 500000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      ownerId: appraiserA.id,
    });

    // No update/sign method exists (YAGNI) — simulate loading an already-signed
    // Valuation from persistence to prove the domain invariant holds
    // regardless of where the record came from.
    const signed: Valuation = { ...created, status: "signed" };

    expect(() => assertNotSigned(signed)).toThrow();
    expect(() => assertNotSigned(created)).not.toThrow();
  });

  it("persists and returns the KCS inputs snapshot (F-3 at the app level)", async () => {
    const created = await repo.create({
      address: "ul. Kościelna 33A, Poznań",
      area: 71.63,
      wr: 1_044_400,
      inputs: {
        area: 71.63,
        comparables: [{ date: "2024-07", area: 63.27, pricePerM2: 14698.91 }],
        features: [{ name: "standard wykończenia", weight: 1, rating: "lepsza" }],
      },
      amountInWords: null,
      docUrl: null,
      ownerId: appraiserA.id,
    });
    const fetched = await repo.get(created.id, appraiserA);
    expect(fetched?.wr).toBe(1_044_400);
    expect(fetched?.inputs?.comparables[0]?.pricePerM2).toBe(14698.91);
  });
});

describe("F-4: confirmSample + approve mutations (draft lifecycle)", () => {
  it("confirmSample flips rcn rows + geocode to confirmed and persists", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 1"),
      inputs: approvableInputs(),
    });
    const confirmed = await repo.confirmSample(created.id, appraiserA);
    expect(confirmed).not.toBeNull();
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
    expect(reread!.inputs!.provenance!.geocode!.status).toBe("confirmed");
  });

  it("confirmSample is owner-only: another appraiser AND a non-owner admin get null", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 2"),
      inputs: approvableInputs(),
    });
    expect(await repo.confirmSample(created.id, appraiserB)).toBeNull();
    expect(await repo.confirmSample(created.id, admin)).toBeNull();
  });

  it("approve rejects an unconfirmed draft with ApprovalBlockedError (server-side gate — API bypass impossible)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 3"),
      inputs: approvableInputs(),
    });
    await expect(repo.approve(created.id, appraiserA)).rejects.toThrow(ApprovalBlockedError);
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.status).toBe("in_progress");
    expect(reread!.approvedAt).toBeNull();
  });

  it("approve succeeds after confirmSample: status approved + approvedAt persisted", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 4"),
      inputs: approvableInputs(),
    });
    await repo.confirmSample(created.id, appraiserA);
    const approved = await repo.approve(created.id, appraiserA);
    expect(approved!.status).toBe("approved");
    expect(approved!.approvedAt).toBeInstanceOf(Date);
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.status).toBe("approved");
    expect(reread!.approvedAt).toBeInstanceOf(Date);
  });

  it("an approved valuation refuses further mutations (write-once at approval)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 5"),
      inputs: approvableInputs(),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.approve(created.id, appraiserA);
    await expect(repo.confirmSample(created.id, appraiserA)).rejects.toThrow(/not a draft/i);
    await expect(repo.approve(created.id, appraiserA)).rejects.toThrow(/not a draft/i);
  });

  it("approve blocks below 12 transactions even when all rows are confirmed", async () => {
    const inputs = approvableInputs();
    inputs.comparables = inputs.comparables.slice(0, 11).map((c) => ({
      ...c,
      status: "confirmed" as const,
    }));
    inputs.provenance = {
      ...inputs.provenance!,
      geocode: { source: "geokoder", status: "confirmed" },
    };
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 6"),
      inputs,
    });
    await expect(repo.approve(created.id, appraiserA)).rejects.toThrow(ApprovalBlockedError);
  });

  it("approve blocks when document fields are missing (legacy draft)", async () => {
    // A draft with a passing F-4 gate (confirmed sample) but null document
    // fields must still be refused — with a blocker naming path "purpose".
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 7"),
      inputs: approvableInputs(),
      purpose: null,
      kwNumber: null,
      client: null,
      inspectionDate: null,
    });
    await repo.confirmSample(created.id, appraiserA);
    try {
      await repo.approve(created.id, appraiserA);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalBlockedError);
      expect((e as ApprovalBlockedError).blockers.map((b) => b.path)).toContain("purpose");
    }
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.status).toBe("in_progress");
    expect(reread!.approvedAt).toBeNull();
  });

  it("approve persists docUrl + docxUrl when passed", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 8"),
      inputs: approvableInputs(),
    });
    await repo.confirmSample(created.id, appraiserA);
    const updated = await repo.approve(created.id, appraiserA, {
      docUrl: "/api/docs/operat-x.pdf",
      docxUrl: "/api/docs/operat-x.docx",
    });
    expect(updated?.docUrl).toBe("/api/docs/operat-x.pdf");
    expect(updated?.docxUrl).toBe("/api/docs/operat-x.docx");
    expect(updated?.status).toBe("approved");

    const reread = await repo.get(created.id, appraiserA);
    expect(reread?.docUrl).toBe("/api/docs/operat-x.pdf");
    expect(reread?.docxUrl).toBe("/api/docs/operat-x.docx");
  });
});

function subjectApprovableInputs(): KcsInput {
  return {
    area: 50,
    comparables: [{ pricePerM2: 10_000, source: "manual" as const, status: "confirmed" as const }],
    features: [{ name: "standard", weight: 1, rating: "przecietna" as const }],
    subject: { obreb: "Jeżyce", nrDzialki: "161" },
    subjectMeta: {
      x: 1,
      y: 2,
      teryt: "306401",
      fetchedAt: "2026-07-14T09:00:00.000Z",
      source: "geopoz-gugik",
      mpzpAbsent: false,
    },
    provenance: {
      address: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      area: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      weights: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      ratings: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      ewidencja: { source: "ewidencja" as const, status: "to_verify" as const },
      mpzp: { source: "mpzp" as const, status: "to_verify" as const },
    },
  };
}

describe("F-5: confirmSubject mutation (subject provenance, Task 6)", () => {
  it("confirmSubject flips ewidencja + mpzp to confirmed and persists", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 9"),
      inputs: subjectApprovableInputs(),
    });
    const confirmed = await repo.confirmSubject(created.id, appraiserA);
    expect(confirmed).not.toBeNull();
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.inputs!.provenance!.ewidencja!.status).toBe("confirmed");
    expect(reread!.inputs!.provenance!.mpzp!.status).toBe("confirmed");
  });

  it("confirmSubject is owner-only: another appraiser AND a non-owner admin get null", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 10"),
      inputs: subjectApprovableInputs(),
    });
    expect(await repo.confirmSubject(created.id, appraiserB)).toBeNull();
    expect(await repo.confirmSubject(created.id, admin)).toBeNull();
  });
});
