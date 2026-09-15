import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import {
  ApprovalBlockedError,
  InputsChangedError,
  NotReopenableError,
  assertNotSigned,
} from "../src/domain/valuation";
import { buildPhotoKey } from "../src/domain/inspection";
import { approvedOperatKeys } from "../src/lib/operat-doc-keys";
import type { KcsInput } from "../src/domain/kcs";
import type { ProseSnapshot } from "../src/domain/prose-snapshot";
import type { NewValuationInput, SessionUser, Valuation } from "../src/ports/valuation";
import {
  approvableInputs,
  approvableWr,
  partialDraftInputs,
  valuationInput,
  withConfirmedProse,
} from "./fixtures/valuation-inputs";

const appraiserA: SessionUser = { id: "user-test-1", role: "appraiser" };
const appraiserB: SessionUser = { id: "user-test-2", role: "appraiser" };
const admin: SessionUser = { id: "user-test-admin", role: "admin" };

const repo = valuationRepo(db);

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
      // One comparable, one feature rated on its described scale: Ui = 1 × Vmax
      // = 1, so the amount is simply the unit price × area. Spelled out rather
      // than invented, because a `wr` that does not follow from the snapshot is
      // dropped on read (`readFeatureScale`, ADR-016).
      wr: 1_052_900,
      inputs: {
        area: 71.63,
        comparables: [{ date: "2024-07", area: 63.27, pricePerM2: 14698.91 }],
        features: [
          {
            name: "standard wykończenia",
            weight: 1,
            rating: "lepsza",
            definitions: { lepsza: "opis lepszej", gorsza: "opis gorszej" },
          },
        ],
      },
      amountInWords: null,
      docUrl: null,
      ownerId: appraiserA.id,
    });
    const fetched = await repo.get(created.id, appraiserA);
    expect(fetched?.wr).toBe(1_052_900);
    expect(fetched?.inputs?.comparables[0]?.pricePerM2).toBe(14698.91);
  });

  it("saveSample persists a sampleSelection snapshot (ADR-015, Task 7) — round-trips through get() and nulls wr", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Sample Selection 1"),
      wr: 500_000,
      inputs: partialDraftInputs(),
    });
    expect(created.wr).toBe(500_000);

    const sampleSelection: NonNullable<KcsInput["sampleSelection"]> = {
      version: 3,
      proposed: [],
      alternates: [],
      flags: {},
      rejectedCounts: { no_price: 2, out_of_area_band: 1 },
      radiusUsedM: 500,
      radiusWalk: [{ radiusM: 500, inRadius: 40, afterHygiene: 38, afterBand: 30 }],
      counts: { pool: 40, inRadius: 40, afterHygiene: 38, afterBand: 30, proposed: 0 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };

    const updated = await repo.saveSample(created.id, appraiserA, {
      comparables: [],
      sampleMeta: null,
      sampleSelection,
    });
    expect(updated?.wr).toBeNull();

    const fetched = await repo.get(created.id, appraiserA);
    expect(fetched?.wr).toBeNull();
    expect(fetched?.inputs?.sampleSelection).toEqual(sampleSelection);
  });
});

describe("F-4: confirmSample + approve mutations (draft lifecycle)", () => {
  it("confirmSample flips rcn rows to confirmed and persists, leaving geocode to step 1", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 1"),
      wr: approvableWr(),
      inputs: approvableInputs(),
    });
    const confirmed = await repo.confirmSample(created.id, appraiserA);
    expect(confirmed).not.toBeNull();
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
    // T7: geocoding belongs to the address — `confirmSubject` flips it.
    expect(reread!.inputs!.provenance!.geocode!.status).toBe("to_verify");
    const withSubject = await repo.confirmSubject(created.id, appraiserA);
    expect(withSubject!.inputs!.provenance!.geocode!.status).toBe("confirmed");
  });

  it("confirmSample is owner-only: another appraiser AND a non-owner admin get null", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 2"),
      wr: approvableWr(),
      inputs: approvableInputs(),
    });
    expect(await repo.confirmSample(created.id, appraiserB)).toBeNull();
    expect(await repo.confirmSample(created.id, admin)).toBeNull();
  });

  it("approve rejects an unconfirmed draft with ApprovalBlockedError (server-side gate — API bypass impossible)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 3"),
      wr: approvableWr(),
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
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Gating 4", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
    const approved = await repo.approve(created.id, appraiserA);
    expect(approved!.status).toBe("approved");
    expect(approved!.approvedAt).toBeInstanceOf(Date);
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.status).toBe("approved");
    expect(reread!.approvedAt).toBeInstanceOf(Date);
  });

  /**
   * ADR-020: the operat's storage key is `approvedAt.getTime()`
   * (`approvedOperatKeys`), written by approve and read back by the signature
   * from a fresh `get`. A column that dropped milliseconds would move the key
   * between the two, and every signature would fail with „zatwierdzono przed
   * aktualizacją” on a valuation that is perfectly fine — invisible to every
   * test with a mocked repository. Hence this one, on real Postgres.
   */
  it("approvedAt survives the round-trip to the millisecond, so the operat key does", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Milisekundowa 1"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Milisekundowa 1", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
    // A time whose millisecond part is not zero — the part that gets lost.
    const now = new Date("2026-09-15T08:00:00.123Z");

    const approved = await repo.approve(created.id, appraiserA, undefined, now);
    const reread = await repo.get(created.id, appraiserA);

    expect(approved!.approvedAt!.getTime()).toBe(now.getTime());
    expect(reread!.approvedAt!.getTime()).toBe(now.getTime());
  });

  /**
   * B-15/B-16 W TRANSAKCJI (ADR-020 reg. 3). Bramka na ekranie i fail-fast w
   * akcji to wygoda; rozstrzyga ta, która biegnie wewnątrz transakcji zapisu
   * (ADR-012), a jej jedynym nośnikiem danych profilu jest `...gate` w
   * `valuation-drizzle.ts`. Testy akcji tego nie pilnują — mockują
   * repozytorium, więc zawężenie przekazywanego kontekstu do
   * `{ requireProse }` (regresja z PR #50) zostawiłoby je zielone.
   *
   * Kryterium: oba przypadki czerwienią się, gdy `...gate` zniknie z wywołania
   * `approveValuation` w adapterze.
   *
   * Dane profilu poniżej są FIKCYJNE (F-9).
   */
  it("approve odmawia w transakcji przy niekompletnym profilu autora (B-15)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Profilowa 1"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Profilowa 1", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);

    const niepelnyProfil = {
      fullName: "Jan Testowy",
      licenseNo: null,
      officeBlock: "Biuro Wycen Testowe",
      insuranceDocKey: "polisa/user-test-1/fikcyjna",
      insuranceValidUntil: "2099-12-31",
    };
    try {
      await repo.approve(created.id, appraiserA, undefined, new Date(), undefined, undefined, {
        author: niepelnyProfil,
      });
      throw new Error("approve powinno odmówić");
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalBlockedError);
      expect((e as ApprovalBlockedError).blockers.map((b) => b.code)).toContain("B-15");
    }
    // Odmowa jest atomowa: status nie drgnął.
    expect((await repo.get(created.id, appraiserA))!.status).toBe("in_progress");
  });

  it("approve odmawia w transakcji przy polisie po terminie (B-16)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Profilowa 2"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Profilowa 2", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);

    const wygaslaPolisa = {
      fullName: "Jan Testowy",
      licenseNo: "0000",
      officeBlock: "Biuro Wycen Testowe",
      insuranceDocKey: "polisa/user-test-1/fikcyjna",
      insuranceValidUntil: "2000-01-01",
    };
    try {
      await repo.approve(created.id, appraiserA, undefined, new Date(), undefined, undefined, {
        author: wygaslaPolisa,
      });
      throw new Error("approve powinno odmówić");
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalBlockedError);
      expect((e as ApprovalBlockedError).blockers.map((b) => b.code)).toContain("B-16");
    }
    expect((await repo.get(created.id, appraiserA))!.status).toBe("in_progress");
  });

  /**
   * Druga połowa tej samej reguły: kompletny profil z ważną polisą przechodzi.
   * Bez tego przypadku oba testy wyżej zieleniłyby się także wtedy, gdyby
   * bramka zaczęła odmawiać KAŻDEMU profilowi.
   */
  it("approve przechodzi w transakcji przy kompletnym profilu i ważnej polisie", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Profilowa 3"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Profilowa 3", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);

    const approved = await repo.approve(
      created.id,
      appraiserA,
      undefined,
      new Date(),
      undefined,
      undefined,
      {
        author: {
          fullName: "Jan Testowy",
          licenseNo: "0000",
          officeBlock: "Biuro Wycen Testowe",
          insuranceDocKey: "polisa/user-test-1/fikcyjna",
          insuranceValidUntil: "2099-12-31",
        },
      },
    );
    expect(approved!.status).toBe("approved");
  });

  it("an approved valuation refuses further mutations (write-once at approval)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 5"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Gating 5", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
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
      wr: approvableWr(),
      inputs: approvableInputs(),
      purpose: null,
      kwNumber: null,
      client: null,
      inspectionDate: null,
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
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
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Gating 8", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
    const updated = await repo.approve(created.id, appraiserA, {
      docUrl: "/api/docs/operat-x.pdf",
      docxUrl: "/api/docs/operat-x.docx",
      amountInWords: "czterysta osiemdziesiąt tysięcy złotych zero groszy",
    });
    expect(updated?.docUrl).toBe("/api/docs/operat-x.pdf");
    expect(updated?.docxUrl).toBe("/api/docs/operat-x.docx");
    expect(updated?.status).toBe("approved");

    const reread = await repo.get(created.id, appraiserA);
    expect(reread?.docUrl).toBe("/api/docs/operat-x.pdf");
    expect(reread?.docxUrl).toBe("/api/docs/operat-x.docx");
    // `amount_in_words` had never been written by anything: NULL on every row,
    // approved and signed alike, while the flat view showed a dash beside an
    // operat that spells the amount out in full. It is written with the
    // document, from the same string the render was handed.
    expect(reread?.amountInWords).toBe("czterysta osiemdziesiąt tysięcy złotych zero groszy");
  });

  it("approve without amountInWords leaves the column alone (older callers, and sign)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 8b"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Gating 8b", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);

    const updated = await repo.approve(created.id, appraiserA, {
      docUrl: "/api/docs/operat-x2.pdf",
      docxUrl: "/api/docs/operat-x2.docx",
    });

    expect(updated?.status).toBe("approved");
    expect(updated?.amountInWords).toBeNull();
  });

  it("approve with audit.mapsSkipped writes an 'approved' audit row whose meta contains mapsSkipped: true (Slice 9)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 9"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Gating 9", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
    await repo.approve(
      created.id,
      appraiserA,
      { docUrl: "/api/docs/operat-y.pdf", docxUrl: "/api/docs/operat-y.docx" },
      new Date(),
      { mapsSkipped: true },
    );

    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.valuationId, created.id))
      .orderBy(schema.auditLog.id);
    expect(rows.at(-1)!.action).toBe("approved");
    expect(rows.at(-1)!.meta).toMatchObject({ mapsSkipped: true });
  });

  /**
   * „Cofnij zatwierdzenie i popraw” (ADR-020 reguła 6) — end to end on real
   * Postgres, because the interesting part is the audit row: with `approvedAt`
   * cleared, that row is the only record of which documents the withdrawn
   * approval issued, and the whole promise („Obecny plik zostanie w historii
   * wyceny”) rests on being able to read their keys back.
   */
  async function approvedFixture(address: string, now = new Date()) {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, address),
      wr: approvableWr(),
      inputs: withConfirmedProse(address, approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
    const keys = approvedOperatKeys(created.id, now);
    await repo.approve(
      created.id,
      appraiserA,
      {
        docUrl: `/api/docs/${keys.pdf}`,
        docxUrl: `/api/docs/${keys.docx}`,
        amountInWords: "czterysta osiemdziesiąt tysięcy złotych zero groszy",
      },
      now,
    );
    return { id: created.id, keys };
  }

  const auditRowsFor = (id: string) =>
    db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.valuationId, id))
      .orderBy(schema.auditLog.id);

  it("reopen sends an unsigned approval back to editing and clears what the approval produced", async () => {
    const { id } = await approvedFixture("ul. Cofnieta 1");

    const reopened = await repo.reopen(id, appraiserA);

    expect(reopened!.status).toBe("in_progress");
    expect(reopened!.approvedAt).toBeNull();
    expect(reopened!.docUrl).toBeNull();
    expect(reopened!.docxUrl).toBeNull();
    expect(reopened!.amountInWords).toBeNull();
    expect(reopened!.wr).toBeNull();
    // And it is the row that changed, not just the object handed back.
    const reread = await repo.get(id, appraiserA);
    expect(reread!.status).toBe("in_progress");
    expect(reread!.docxUrl).toBeNull();
    // The valuation is editable again — which is the point of the button.
    await repo.confirmSubject(id, appraiserA);
  });

  it("the reopened audit row names the withdrawn documents by their storage keys", async () => {
    const now = new Date("2026-09-15T09:30:00.500Z");
    const { id, keys } = await approvedFixture("ul. Cofnieta 2", now);

    await repo.reopen(id, appraiserA);

    const rows = await auditRowsFor(id);
    expect(rows.at(-1)!.action).toBe("reopened");
    expect(rows.at(-1)!.actorId).toBe(appraiserA.id);
    expect(rows.at(-1)!.meta).toMatchObject({
      docKey: keys.pdf,
      docxKey: keys.docx,
      approvedAt: now.toISOString(),
    });
    // The `approved` row stays: the trail shows both that it was issued and
    // that it was withdrawn.
    expect(rows.map((r) => r.action)).toContain("approved");
  });

  it("names the keys of a row approved BEFORE the per-approval keys existed", async () => {
    // The seven valuations waiting on staging: their files sit under the old
    // fixed `operat-<id>.docx`, and reopening them is exactly the way out that
    // the signature refusal points at. The audit row has to name THOSE keys.
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Cofnieta 6"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Cofnieta 6", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
    await repo.approve(created.id, appraiserA, {
      docUrl: `/api/docs/operat-${created.id}.pdf`,
      docxUrl: `/api/docs/operat-${created.id}.docx`,
    });

    await repo.reopen(created.id, appraiserA);

    const rows = await auditRowsFor(created.id);
    expect(rows.at(-1)!.meta).toMatchObject({
      docKey: `operat-${created.id}.pdf`,
      docxKey: `operat-${created.id}.docx`,
    });
  });

  it("after a reopen the stale amount in words cannot come back (D-57)", async () => {
    const { id } = await approvedFixture("ul. Cofnieta 5");
    expect((await repo.get(id, appraiserA))!.amountInWords).not.toBeNull();

    await repo.reopen(id, appraiserA);
    // The calculation has to be confirmed again — reopening cleared `wr`, so
    // the F-4 gate refuses until the appraiser has looked at the numbers once
    // more. That refusal is the point: the corrections happen in between.
    await expect(repo.approve(id, appraiserA)).rejects.toThrow(ApprovalBlockedError);
    await repo.confirmCalculation(id, appraiserA);
    // Re-approved by a caller that does NOT recompute the words: `approve`
    // only WRITES `amountInWords` when given one, so without the clearing
    // above this would print the withdrawn amount beside a corrected Tabela 4.
    const keys = approvedOperatKeys(id, new Date());
    const reapproved = await repo.approve(id, appraiserA, {
      docUrl: `/api/docs/${keys.pdf}`,
      docxUrl: `/api/docs/${keys.docx}`,
    });

    expect(reapproved!.status).toBe("approved");
    expect(reapproved!.amountInWords).toBeNull();
  });

  it("a lost CAS is a status refusal, not a missing valuation", async () => {
    const { id } = await approvedFixture("ul. Cofnieta 7");

    // The CAS branch needs an INTERLEAVING, not merely two callers. Running
    // `reopen` twice at once does not produce one: the second SELECT lands
    // after the first transaction has committed, so it reads `in_progress` and
    // the DOMAIN refuses before any UPDATE is attempted. Both refusals are
    // `NotReopenableError`, so a test asserting only the type passed with the
    // CAS branch deleted — which is what round 2 measured (review PR #56).
    //
    // So the interleaving is built by hand: a second connection takes the row
    // and flips it WITHOUT committing. `reopen` then reads the still-committed
    // `approved` (READ COMMITTED), passes the domain, and its UPDATE blocks on
    // the row lock. Releasing the blocker makes Postgres re-evaluate the
    // predicate against the new row version — `status = 'approved'` no longer
    // matches, zero rows come back, and the branch under test runs.
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    let refusal: unknown;
    try {
      await blocker.query("begin");
      await blocker.query("update valuation set status = 'in_progress' where id = $1", [id]);

      // The rejection handler is attached the moment the promise exists, and
      // awaited ONCE: a second `await` on a rejected promise reports an
      // unhandled rejection, and so does a `commit` that fails below while
      // this promise is still pending.
      const racing = repo.reopen(id, appraiserA).catch((e: unknown) => e);
      // Long enough for the UPDATE inside `reopen` to reach the lock; the
      // assertions below fail loudly if it has not.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await blocker.query("commit");
      refusal = await racing;
    } finally {
      // Releasing the connection is ALL this block does. Asserting here would
      // mask the real cause when the setup itself fails (`begin`/`update`
      // throwing), and an early `return` to avoid that would be worse still —
      // it discards the in-flight exception and the test goes green on broken
      // infrastructure.
      await blocker.end();
    }

    expect(refusal).toBeInstanceOf(NotReopenableError);
    // The message is what separates this branch from the domain's refusal —
    // the two throw the same type, and only the wording says which ran.
    expect((refusal as Error).message).toMatch(/mid-reopen/);

    // The refusal wrote nothing: the withdrawal that did happen was the
    // blocker's raw UPDATE, which leaves no audit row of its own.
    const rows = await auditRowsFor(id);
    expect(rows.filter((r) => r.action === "reopened")).toHaveLength(0);
  });

  it("reopen refuses a draft, and answers null for someone else's valuation", async () => {
    const draft = await repo.create(valuationInput(appraiserA.id, "ul. Cofnieta 3"));
    await expect(repo.reopen(draft.id, appraiserA)).rejects.toThrow(NotReopenableError);

    const { id } = await approvedFixture("ul. Cofnieta 4");
    expect(await repo.reopen(id, appraiserB)).toBeNull();
    // Refused, not half-done: the valuation is still approved.
    expect((await repo.get(id, appraiserA))!.status).toBe("approved");
    expect(await auditRowsFor(id).then((r) => r.map((x) => x.action))).not.toContain("reopened");
  });

  it("approve rejects with InputsChangedError when expectedInputs no longer matches the row (approve-window drift guard, final review)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 10"),
      wr: approvableWr(),
      inputs: approvableInputs(),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
    const current = (await repo.get(created.id, appraiserA))!.inputs!;
    // Simulates a photo added mid-render via updateInspection — the caller
    // rendered from `current`, but the row has since drifted.
    const staleInputs: KcsInput = {
      ...current,
      inspection: {
        note: null,
        photos: { otoczenie: ["ogledziny-otoczenie-mid-render.jpg"], budynekZewn: [], wnetrza: [] },
      },
    };

    await expect(
      repo.approve(created.id, appraiserA, undefined, new Date(), undefined, staleInputs),
    ).rejects.toThrow(InputsChangedError);

    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.status).toBe("in_progress");
    expect(reread!.approvedAt).toBeNull();
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.valuationId, created.id));
    expect(rows.some((r) => r.action === "approved")).toBe(false);
  });

  it("approve succeeds when expectedInputs matches the row exactly (no drift)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 11"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Gating 11", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
    const current = (await repo.get(created.id, appraiserA))!.inputs!;

    const approved = await repo.approve(
      created.id,
      appraiserA,
      undefined,
      new Date(),
      undefined,
      current,
    );
    expect(approved!.status).toBe("approved");
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

function kwApprovableInputs(): KcsInput {
  const base = approvableInputs();
  return {
    ...base,
    kw: {
      source: "odpis_kw",
      // Short synthetic KW numbers — deliberately NOT the real 8-digit-middle
      // format (2 letters + digit + letter / 8 digits / digit) so the F-9 PII
      // scan stays clean (mirrors rtl-kw-section.test.tsx).
      kwLokalu: "PO1P/1/6",
      kwGruntu: "PO1P/2/4",
      kwInne: [],
      deweloperski: false,
      powUzytkowaKw: 50,
      udzial: "1/1",
      sad: "Sąd Rejonowy Poznań-Stare Miasto",
      wydzial: "V Wydział Ksiąg Wieczystych",
      dataDokumentu: "2026-06-01",
      dzial3: { wpisy: false, tresc: [] },
      dzial4: { wpisy: true, tresc: ["Hipoteka umowna na rzecz banku X"] },
    },
    provenance: {
      ...base.provenance!,
      area: { source: "odpis_kw" as const, status: "to_verify" as const },
      kw: { source: "odpis_kw" as const, status: "to_verify" as const },
    },
  };
}

describe("F-5: confirmKw mutation (KW-extract provenance, Task 8)", () => {
  it("confirmKw flips kw + document-sourced area to confirmed and persists", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 11"),
      inputs: kwApprovableInputs(),
    });
    const confirmed = await repo.confirmKw(created.id, appraiserA);
    expect(confirmed).not.toBeNull();
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.inputs!.provenance!.kw!.status).toBe("confirmed");
    expect(reread!.inputs!.provenance!.area!.status).toBe("confirmed");
  });

  it("confirmKw is owner-only: another appraiser AND a non-owner admin get null", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 12"),
      inputs: kwApprovableInputs(),
    });
    expect(await repo.confirmKw(created.id, appraiserB)).toBeNull();
    expect(await repo.confirmKw(created.id, admin)).toBeNull();
  });

  it("confirmKw on an approved valuation throws (write-once at approval)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 13"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Gating 13", kwApprovableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
    await repo.confirmKw(created.id, appraiserA);
    const approved = await repo.approve(created.id, appraiserA);
    expect(approved!.status).toBe("approved");
    await expect(repo.confirmKw(created.id, appraiserA)).rejects.toThrow(/not a draft/i);
  });
});

describe("FR-2: updateInspection mutation (photo manifest + note, Slice 10, Task 4)", () => {
  it("adds a photo key, audits inspection_updated with op meta, in one tx", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Ogledziny 1"),
      wr: approvableWr(),
      inputs: approvableInputs(),
    });
    const key = buildPhotoKey("wnetrza", "u-1", created.id);
    const updated = await repo.updateInspection(created.id, appraiserA, {
      kind: "add_photo",
      section: "wnetrza",
      key,
    });
    expect(updated!.inputs!.inspection!.photos.wnetrza).toEqual([key]);
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.inputs!.inspection!.photos.wnetrza).toEqual([key]);

    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.valuationId, created.id))
      .orderBy(schema.auditLog.id);
    expect(rows.at(-1)!.action).toBe("inspection_updated");
    expect(rows.at(-1)!.meta).toMatchObject({ op: "photo_added", section: "wnetrza", total: 1 });
  });

  it("updateInspection is owner-only: another appraiser AND a non-owner admin get null", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Ogledziny 2"),
      wr: approvableWr(),
      inputs: approvableInputs(),
    });
    const key = buildPhotoKey("wnetrza", "u-2", created.id);
    const op = { kind: "add_photo" as const, section: "wnetrza" as const, key };
    expect(await repo.updateInspection(created.id, appraiserB, op)).toBeNull();
    expect(await repo.updateInspection(created.id, admin, op)).toBeNull();
  });

  it("updateInspection on an approved valuation throws (write-once at approval)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Ogledziny 3"),
      wr: approvableWr(),
      inputs: withConfirmedProse("ul. Ogledziny 3", approvableInputs()),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.confirmSubject(created.id, appraiserA);
    const approved = await repo.approve(created.id, appraiserA);
    expect(approved!.status).toBe("approved");
    await expect(
      repo.updateInspection(created.id, appraiserA, { kind: "set_note", note: "x" }),
    ).rejects.toThrow(/not a draft/i);
  });

  it("set_note persists the trimmed note", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Ogledziny 4"),
      wr: approvableWr(),
      inputs: approvableInputs(),
    });
    const updated = await repo.updateInspection(created.id, appraiserA, {
      kind: "set_note",
      note: " N ",
    });
    expect(updated!.inputs!.inspection!.note).toBe("N");
  });

  it("set_date persists inspectionDate (column), audits 'date_updated', and survives a re-read", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Ogledziny 5"),
      wr: approvableWr(),
      inputs: approvableInputs(),
    });
    const updated = await repo.updateInspection(created.id, appraiserA, {
      kind: "set_date",
      date: "2026-07-20",
    });
    expect(updated!.inspectionDate).toBe("2026-07-20");

    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.inspectionDate).toBe("2026-07-20");

    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.valuationId, created.id))
      .orderBy(schema.auditLog.id);
    expect(rows.at(-1)!.action).toBe("inspection_updated");
    expect(rows.at(-1)!.meta).toMatchObject({ op: "date_updated" });
  });
});

describe("toValuation — normalizeProse (T2 fix round 2: legacy jsonb, read through the real adapter)", () => {
  // `normalizeProse` (adapters/valuation-drizzle.ts) is the single narrowing
  // point protecting every draft already persisted on staging. Its only
  // previous coverage was accidental — an audit-log.test.ts fixture that
  // happened to use the legacy shape — and that fixture was converted to
  // the modern shape in fix round 1, silently deleting the coverage. This
  // exercises it directly, through the real repo/Postgres round trip rather
  // than calling the (unexported) helper in isolation.
  it("a legacy prose jsonb (old factsHash, no factsHashes) reads back with factsHashes: {} — nothing synthesized, the rest untouched", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "Legacy Prose Read"),
      wr: null,
      inputs: partialDraftInputs(),
    });

    // Simulate a row persisted before eb09bcf: write the OLD single-hash
    // shape straight into the untyped jsonb column, bypassing every domain
    // function (none of which can build this shape today — this is exactly
    // why the write has to go around the domain, direct to the DB).
    const legacyProse = {
      sections: {
        opis_lokalu: {
          value: "Lokal obejmuje dwa pokoje.",
          provenance: { source: "ai", status: "to_verify" },
        },
      },
      rejected: { analiza_rynku: ["9 871,00"] },
      factsHash: "a".repeat(64),
      model: "claude-sonnet-5",
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    await db
      .update(schema.valuation)
      .set({ inputs: { ...partialDraftInputs(), prose: legacyProse } })
      .where(eq(schema.valuation.id, created.id));

    const read = await repo.get(created.id, appraiserA);

    expect(read?.inputs?.prose?.factsHashes).toEqual({});
    // NOT synthesized from the old hash — an empty object, never e.g. every
    // section stamped with "a".repeat(64), which would mark stale prose as
    // fresh: the exact failure this normalization exists to prevent.
    expect(read?.inputs?.prose?.factsHashes).not.toHaveProperty("opis_lokalu");
    expect(read?.inputs?.prose?.sections).toEqual(legacyProse.sections);
    expect(read?.inputs?.prose?.rejected).toEqual(legacyProse.rejected);
    expect(read?.inputs?.prose?.model).toBe(legacyProse.model);
    expect(read?.inputs?.prose?.generatedAt).toBe(legacyProse.generatedAt);
  });

  it("a modern prose jsonb (factsHashes already present) round-trips byte-for-byte — normalization is a no-op", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "Modern Prose Read"),
      wr: null,
      inputs: partialDraftInputs(),
    });
    const modernProse = {
      sections: {
        opis_lokalu: {
          value: "Lokal obejmuje dwa pokoje.",
          provenance: { source: "ai", status: "to_verify" },
        },
      },
      rejected: {},
      factsHashes: { opis_lokalu: "b".repeat(64) },
      model: "claude-sonnet-5",
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    await db
      .update(schema.valuation)
      .set({ inputs: { ...partialDraftInputs(), prose: modernProse } })
      .where(eq(schema.valuation.id, created.id));

    const read = await repo.get(created.id, appraiserA);

    expect(read?.inputs?.prose).toEqual(modernProse);
  });

  it("no prose at all reads back as no prose — normalization does not invent one", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "No Prose Read"),
      wr: null,
      inputs: partialDraftInputs(),
    });

    const read = await repo.get(created.id, appraiserA);

    expect(read?.inputs?.prose).toBeFalsy();
  });
});

/**
 * `proseUsage` — the read side of the `prose_generated` audit rows (T5).
 *
 * Step 6 shows the appraiser what the generations have already cost before
 * offering another one, and the only record of that cost is the audit trail.
 * Rows written for a run whose every section was rejected count too: those
 * tokens were spent.
 */
describe("proseUsage (integration, real Postgres)", () => {
  const generated = (over: Partial<ProseSnapshot> = {}): ProseSnapshot => ({
    sections: {
      opis_lokalu: {
        value: "Lokal obejmuje dwa pokoje z kuchnią.",
        provenance: { source: "ai", status: "to_verify" },
      },
    },
    rejected: {},
    factsHashes: { opis_lokalu: "a".repeat(64) },
    model: "claude-sonnet-5",
    generatedAt: "2026-08-18T07:30:00.000Z",
    ...over,
  });

  async function draftWithGenerations(address: string) {
    const v = await repo.create({
      ...valuationInput(appraiserA.id, address),
      wr: null,
      inputs: partialDraftInputs(),
    });
    await repo.saveProse(v.id, appraiserA, generated(), { inputTokens: 3120, outputTokens: 480 });
    // A second run whose every section the worker's guard refused — no text,
    // full bill.
    await repo.saveProse(
      v.id,
      appraiserA,
      generated({ sections: {}, rejected: { opis_lokalu: ["9 871,00"] } }),
      { inputTokens: 2900, outputTokens: 0 },
    );
    return v;
  }

  it("sums the tokens over every generation, the wholly rejected one included", async () => {
    const v = await draftWithGenerations("Prose Usage Sum");

    expect(await repo.proseUsage(v.id, appraiserA)).toEqual({
      generations: 2,
      inputTokens: 6020,
      outputTokens: 480,
    });
  });

  it("a draft nobody has generated for costs nothing", async () => {
    const v = await repo.create({
      ...valuationInput(appraiserA.id, "Prose Usage Zero"),
      wr: null,
      inputs: partialDraftInputs(),
    });

    expect(await repo.proseUsage(v.id, appraiserA)).toEqual({
      generations: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("another appraiser reads zeros — the same non-answer `get` gives (F-8)", async () => {
    const v = await draftWithGenerations("Prose Usage Foreign");

    expect(await repo.proseUsage(v.id, appraiserB)).toEqual({
      generations: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("an admin sees the owner's cost, exactly as they can see the draft", async () => {
    const v = await draftWithGenerations("Prose Usage Admin");

    expect((await repo.proseUsage(v.id, admin)).generations).toBe(2);
  });

  it("a prose_generated row predating the token fields counts as a generation, not as NaN", async () => {
    // The audit trail is append-only (F-7): rows written before `saveProse`
    // recorded usage cannot be backfilled, and one of them must not turn the
    // whole sum into null.
    const v = await draftWithGenerations("Prose Usage Legacy");
    await db.insert(schema.auditLog).values({
      valuationId: v.id,
      actorId: appraiserA.id,
      action: "prose_generated",
      meta: { model: "claude-sonnet-5", sections: ["opis_lokalu"] },
    });

    expect(await repo.proseUsage(v.id, appraiserA)).toEqual({
      generations: 3,
      inputTokens: 6020,
      outputTokens: 480,
    });
  });
});
