import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import {
  CalculationNotReadyError,
  type FeaturesUpdate,
  type SampleUpdate,
  type SubjectUpdate,
} from "../src/domain/valuation";
import type { Comparable, KcsInput } from "../src/domain/kcs";
import { approvalGate, type InputsProvenance } from "../src/domain/provenance";
import { normalizeKw } from "../src/domain/kw-snapshot";
import type { SessionUser, Valuation } from "../src/ports/valuation";
import { assignSampleProvenance, assignSubjectProvenance } from "../src/lib/assign-provenance";
import { isEmptySubject, step1DefaultsFromInputs } from "../src/lib/subject-form";
import { sampleStepSchema, step1Schema } from "../src/app/actions/wizard-schemas";
import {
  approvableInput,
  partialDraftInputs,
  valuationInput,
  withConfirmedProse,
} from "./fixtures/valuation-inputs";

/** Slice 11a wizard draft mutations (Task 4) — repo/adapter integration. */
const appraiserA: SessionUser = { id: "user-wizard-1", role: "appraiser" };
const appraiserB: SessionUser = { id: "user-wizard-2", role: "appraiser" };
const admin: SessionUser = { id: "user-wizard-admin", role: "admin" };

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

/** The gate's blocker paths for an inputs snapshot — the sample size and the
 * missing features block these partial drafts too, so tests assert on the
 * PRESENCE of one path rather than on an empty list. */
function gateBlockerPaths(inputs: KcsInput): string[] {
  const gate = approvalGate(inputs);
  return gate.ok ? [] : gate.blockers.map((b) => b.path);
}

function partialDraft(address: string) {
  return { ...valuationInput(appraiserA.id, address), wr: null, inputs: partialDraftInputs() };
}

const subjectUpdate: SubjectUpdate = {
  address: "ul. Nowa 10, Poznań",
  area: 77,
  purpose: "sprzedaz",
  kwNumber: "PO1P/5/5",
  client: "Jan Subject",
  subject: null,
  subjectMeta: null,
  kw: null,
  kwMeta: null,
  provenance: {
    address: { source: "rzeczoznawca", status: "confirmed" },
    area: { source: "rzeczoznawca", status: "confirmed" },
  },
};

const emptySampleUpdate: SampleUpdate = { comparables: [], sampleMeta: null };

const emptyFeaturesUpdate: FeaturesUpdate = {
  features: [],
  provenance: {
    weights: { source: "rzeczoznawca", status: "confirmed" },
    ratings: { source: "rzeczoznawca", status: "confirmed" },
  },
};

describe("wizard draft mutations (Slice 11a, Task 4)", () => {
  it("create with wr: null and a partial snapshot (empty comparables/features) comes back wr null", async () => {
    const created = await repo.create(partialDraft("Wizard Create 1"));
    expect(created.wr).toBeNull();
    expect(created.inputs!.comparables).toEqual([]);
    expect(created.inputs!.features).toEqual([]);
  });

  it("saveSample nulls wr, and confirmCalculation after sample+features sets a positive wr; a later saveSample invalidates it again", async () => {
    const created = await repo.create(partialDraft("Wizard Sample 1"));

    const comparables: Comparable[] = [
      { pricePerM2: 9_000, source: "manual", status: "confirmed" },
      { pricePerM2: 9_500, source: "manual", status: "confirmed" },
      { pricePerM2: 10_500, source: "manual", status: "confirmed" },
    ];
    const sampleUpdate: SampleUpdate = { comparables, sampleMeta: null };
    const afterSample = await repo.saveSample(created.id, appraiserA, sampleUpdate);
    expect(afterSample!.wr).toBeNull();
    expect(afterSample!.inputs!.comparables).toEqual(comparables);

    const featuresUpdate: FeaturesUpdate = {
      features: [{ name: "standard", weight: 1, rating: "przecietna" }],
      provenance: {
        weights: { source: "rzeczoznawca", status: "confirmed" },
        ratings: { source: "rzeczoznawca", status: "confirmed" },
      },
    };
    await repo.saveFeatures(created.id, appraiserA, featuresUpdate);

    const confirmed = await repo.confirmCalculation(created.id, appraiserA);
    expect(confirmed!.wr).toBeGreaterThan(0);

    const afterSecondSample = await repo.saveSample(created.id, appraiserA, sampleUpdate);
    expect(afterSecondSample!.wr).toBeNull();
  });

  it("saveFeatures persists features + the provenance fragment, keeping the detected source", async () => {
    const created = await repo.create(partialDraft("Wizard Features 1"));
    const update: FeaturesUpdate = {
      features: [{ name: "standard", weight: 1, rating: "przecietna", key: "preset-1" }],
      provenance: {
        weights: { source: "preset", status: "to_verify" },
        ratings: { source: "preset", status: "to_verify" },
      },
    };

    const updated = await repo.saveFeatures(created.id, appraiserA, update);

    expect(updated!.inputs!.features).toEqual(update.features);
    // The SOURCE still records that these weights came from the preset — only
    // the status moves, because the save is the appraiser's confirmation (T7).
    expect(updated!.inputs!.provenance!.weights).toEqual({ source: "preset", status: "confirmed" });
    expect(updated!.wr).toBeNull();
  });

  /**
   * T7 (spec §B): confirming happens on the step where the data is on screen.
   * Each step's save therefore performs the matching confirmation in the SAME
   * repository transaction — a save that persisted the data and left the
   * confirmation for a later click is the "confirm twelve transactions you
   * cannot see" ritual this slice removes.
   */
  it("saving step 3 confirms the RCN sample in the same transaction", async () => {
    const created = await repo.create(partialDraft("Wizard Confirm Sample"));
    const fetched: SampleUpdate = {
      comparables: Array.from({ length: 12 }, (_, i) => ({
        date: "2025-03",
        area: 50 + i,
        pricePerM2: 10_000 + i,
        source: "rcn" as const,
        transactionId: `tx-${i}`,
        status: "to_verify" as const,
      })),
      sampleMeta: null,
    };

    await repo.saveSample(created.id, appraiserA, fetched);

    const after = await repo.get(created.id, appraiserA);
    expect(after!.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
  });

  /**
   * The same rule end to end, through the real ACL and the real write
   * transaction: a second save that strips every fetched id and calls the
   * rows the appraiser's own still lands them as `rcn`. What the operat
   * prints about where its transactions came from must not be a function of
   * what the last request claimed (F-5).
   */
  it("a save that strips the ids and relabels the rows cannot turn RCN transactions into the appraiser's own", async () => {
    const created = await repo.create(partialDraft("Wizard Relabel"));
    const fetched = Array.from({ length: 12 }, (_, i) => ({
      date: "2025-03",
      area: 50 + i,
      pricePerM2: 10_000 + i,
      source: "rcn" as const,
      transactionId: `tx-${i}`,
    }));
    await repo.saveSample(created.id, appraiserA, {
      comparables: assignSampleProvenance({ comparables: fetched }),
      sampleMeta: null,
    });

    // The crafted payload: same numbers on screen, no ids, "manual" label.
    const relabelled = fetched.map(({ date, area, pricePerM2 }) => ({
      date,
      area,
      pricePerM2,
      source: "manual" as const,
    }));
    await repo.saveSample(created.id, appraiserA, {
      comparables: assignSampleProvenance({ comparables: relabelled }),
      sampleMeta: null,
    });

    const after = await repo.get(created.id, appraiserA);
    expect(after!.inputs!.comparables.every((c) => c.source === "rcn")).toBe(true);
  });

  it("saving step 1 confirms the subject snapshot, the KW extract and the geocoding", async () => {
    const created = await repo.create(partialDraft("Wizard Confirm Subject"));
    const fetched: SubjectUpdate = {
      address: "ul. Klonowa 4, m. Nowogród",
      area: 69.56,
      purpose: "sprzedaz",
      kwNumber: "KW-TEST-1",
      client: "p. Jan Testowy",
      subject: { obreb: "Nowogród", nrDzialki: "12" },
      subjectMeta: {
        x: 1,
        y: 2,
        teryt: "000000",
        fetchedAt: "2026-07-14T09:00:00.000Z",
        source: "geopoz-gugik",
        mpzpAbsent: false,
      },
      kw: {
        source: "odpis_kw",
        kwLokalu: "KW-TEST-1",
        kwGruntu: "KW-TEST-1",
        kwInne: [],
        deweloperski: false,
        powUzytkowaKw: 69.56,
        udzial: null,
        sad: null,
        wydzial: null,
        dataDokumentu: null,
        dzial3: null,
        dzial4: null,
      },
      kwMeta: {
        model: "test-model",
        extractedAt: "2026-07-14T09:00:00.000Z",
        docTypeDetected: "odpis_kw",
        docTypeDeclared: "odpis_kw",
      },
      provenance: {
        address: { source: "rzeczoznawca", status: "confirmed" },
        // Doc-sourced: the area matches the extract, so the ACL stamps it
        // `odpis_kw`/`to_verify` and the KW confirmation carries it along.
        area: { source: "odpis_kw", status: "to_verify" },
        ewidencja: { source: "ewidencja", status: "to_verify" },
        mpzp: { source: "mpzp", status: "to_verify" },
        kw: { source: "odpis_kw", status: "to_verify" },
      },
    };

    await repo.saveSubject(created.id, appraiserA, fetched);

    const after = await repo.get(created.id, appraiserA);
    const p = after!.inputs!.provenance!;
    expect(p.ewidencja!.status).toBe("confirmed");
    expect(p.mpzp!.status).toBe("confirmed");
    expect(p.kw!.status).toBe("confirmed");
    expect(p.area.status).toBe("confirmed");
    // The geocoding belongs to the address, so it is confirmed here — not on
    // the sample step, where the appraiser never sees the resolved point.
    expect(p.geocode).toEqual({ source: "geokoder", status: "confirmed" });
  });

  /**
   * `subjectMeta.buildingId` (Task 6, ADR-015's "same building" scoring
   * bonus) has to be DECLARED in `step1Schema` — zod strips unknown keys, so
   * a schema that forgot the field would silently drop it here before it
   * ever reached the repo, and `getSampleProposal` would never see it. Routed
   * through the real schema (not a hand-written `SubjectUpdate`, unlike the
   * test above) precisely to prove that.
   */
  it("subjectMeta.buildingId survives step1Schema, save, and get() (ADR-015 same-building bonus)", async () => {
    const created = await repo.create(partialDraft("Wizard BuildingId"));
    const raw = {
      address: "ul. Heweliusza 3, Poznań",
      area: 50,
      purpose: "sprzedaz" as const,
      kwNumber: "KW-TEST-1",
      client: "p. Jan Testowy",
      subject: { obreb: "0039", nrDzialki: "13/24" },
      subjectMeta: {
        x: 355300.15,
        y: 505330.31,
        teryt: "306401",
        fetchedAt: "2026-07-14T09:00:00.000Z",
        source: "geopoz-gugik",
        mpzpAbsent: false,
        buildingId: "306401_1.0021.AR_10.162.1_BUD",
      },
    };
    const parsed = step1Schema.parse(raw);

    await repo.saveSubject(created.id, appraiserA, {
      address: parsed.address,
      area: parsed.area,
      purpose: parsed.purpose,
      kwNumber: parsed.kwNumber?.trim() || null,
      client: parsed.client,
      subject: parsed.subject ?? null,
      subjectMeta: parsed.subjectMeta ?? null,
      kw: parsed.kw ? normalizeKw(parsed.kw) : null,
      kwMeta: parsed.kwMeta ?? null,
      provenance: assignSubjectProvenance(parsed),
    });

    const after = await repo.get(created.id, appraiserA);
    expect(after!.inputs!.subjectMeta!.buildingId).toBe("306401_1.0021.AR_10.162.1_BUD");
  });

  /**
   * The flow the geocode move has to survive: the appraiser never ran the
   * step-1 EGiB/MPZP fetch, so nothing geocoded the draft until the RCN fetch
   * on step 3 set `sampleMeta` — at which point the F-4 gate starts demanding
   * a geocoding confirmation for an entry that does not exist yet. Since only
   * step 1 can give that confirmation now, this proves the way out exists:
   * submitting step 1 stamps the entry AND confirms it. A blocker no step can
   * clear would deadlock approval, which is the failure mode opposite to (and
   * as bad as) confirming something unseen.
   */
  it("a draft geocoded only by the sample fetch still clears the gate — from step 1", async () => {
    const created = await repo.create(partialDraft("Wizard Geocode Reachable"));
    await repo.saveSample(created.id, appraiserA, {
      comparables: [{ pricePerM2: 10_000, source: "manual", status: "confirmed" }],
      sampleMeta: {
        point: { x: 355300.15, y: 505330.31, source: "subject" as const },
        maxRadiusM: 3000,
        counts: { fetched: 100, deduped: 10, noPos: 0 },
        fetchedAt: "2026-07-14T09:00:00.000Z",
        source: "rcn-wfs-gugik" as const,
        query: { bbox: [1, 2, 3, 4], count: 5000, sort: "dok_data D", pages: 1, truncated: false },
      },
    });

    const blocked = await repo.get(created.id, appraiserA);
    expect(blocked!.inputs!.provenance!.geocode).toBeUndefined();
    expect(gateBlockerPaths(blocked!.inputs!)).toContain("provenance.geocode");

    await repo.saveSubject(created.id, appraiserA, subjectUpdate);

    const cleared = await repo.get(created.id, appraiserA);
    expect(cleared!.inputs!.provenance!.geocode).toEqual({
      source: "geokoder",
      status: "confirmed",
    });
    expect(gateBlockerPaths(cleared!.inputs!)).not.toContain("provenance.geocode");
  });

  it("saving step 4 confirms the preset weights and the rating-scale definitions", async () => {
    const created = await repo.create(partialDraft("Wizard Confirm Features"));
    const update: FeaturesUpdate = {
      features: [{ name: "standard", weight: 1, rating: "przecietna", key: "preset-1" }],
      provenance: {
        weights: { source: "preset", status: "to_verify" },
        ratings: { source: "rzeczoznawca", status: "confirmed" },
        featureDefs: { source: "preset", status: "to_verify" },
      },
    };

    await repo.saveFeatures(created.id, appraiserA, update);

    const after = await repo.get(created.id, appraiserA);
    expect(after!.inputs!.provenance!.weights.status).toBe("confirmed");
    expect(after!.inputs!.provenance!.featureDefs!.status).toBe("confirmed");
  });

  it("saveSubject updates the address/area columns and inputs.area", async () => {
    const created = await repo.create(partialDraft("Wizard Subject 1"));

    const updated = await repo.saveSubject(created.id, appraiserA, subjectUpdate);

    expect(updated!.address).toBe(subjectUpdate.address);
    expect(updated!.area).toBe(77);
    expect(updated!.inputs!.area).toBe(77);
    expect(updated!.wr).toBeNull();
  });

  // The adapter used to write a literal `wr: null` here, overruling whatever
  // the domain decided. This is the end-to-end half of that fix: the amount
  // has to survive a real step-1 save through a real transaction, not only in
  // `applySubjectUpdate`'s return value.
  it("saveSubject keeps a confirmed wr when the area does not move", async () => {
    const created = await repo.create(partialDraft("Wizard Keep WR 1"));
    await repo.saveSample(created.id, appraiserA, {
      comparables: [
        { pricePerM2: 9_000, source: "manual", status: "confirmed" },
        { pricePerM2: 9_500, source: "manual", status: "confirmed" },
        { pricePerM2: 10_500, source: "manual", status: "confirmed" },
      ],
      sampleMeta: null,
    });
    await repo.saveFeatures(created.id, appraiserA, {
      features: [{ name: "standard", weight: 1, rating: "przecietna" }],
      provenance: {
        weights: { source: "rzeczoznawca", status: "confirmed" },
        ratings: { source: "rzeczoznawca", status: "confirmed" },
      },
    });
    const confirmed = await repo.confirmCalculation(created.id, appraiserA);
    expect(confirmed!.wr).toBeGreaterThan(0);

    // Everything but the area moves — address, purpose, KW number, client.
    const sameArea = await repo.saveSubject(created.id, appraiserA, {
      ...subjectUpdate,
      area: confirmed!.inputs!.area,
    });
    expect(sameArea!.wr).toBe(confirmed!.wr);

    // ...and moving the area still costs it, from that same state.
    const movedArea = await repo.saveSubject(created.id, appraiserA, {
      ...subjectUpdate,
      area: confirmed!.inputs!.area + 1,
    });
    expect(movedArea!.wr).toBeNull();
  });

  it("confirmCalculation on a partial draft (no comparables/features) rejects CalculationNotReadyError", async () => {
    const created = await repo.create(partialDraft("Wizard Partial 1"));

    await expect(repo.confirmCalculation(created.id, appraiserA)).rejects.toThrow(
      CalculationNotReadyError,
    );
  });

  it("owner isolation: another appraiser AND a non-owner admin get null from all four mutations, zero changes", async () => {
    const created = await repo.create(partialDraft("Wizard Owner 1"));

    for (const other of [appraiserB, admin]) {
      expect(await repo.saveSubject(created.id, other, subjectUpdate)).toBeNull();
      expect(await repo.saveSample(created.id, other, emptySampleUpdate)).toBeNull();
      expect(await repo.saveFeatures(created.id, other, emptyFeaturesUpdate)).toBeNull();
      expect(await repo.confirmCalculation(created.id, other)).toBeNull();
    }

    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.address).toBe(created.address);
    expect(reread!.inputs).toEqual(created.inputs);
  });

  it("draft-only: after approve, all four mutations throw (write-once at approval, like updateInspection)", async () => {
    const base = approvableInput(appraiserA.id);
    const created = await repo.create({
      ...base,
      inputs: withConfirmedProse(base.address, base.inputs!),
    });
    const approved = await repo.approve(created.id, appraiserA);
    expect(approved!.status).toBe("approved");

    await expect(repo.saveSubject(created.id, appraiserA, subjectUpdate)).rejects.toThrow(
      /not a draft/i,
    );
    await expect(repo.saveSample(created.id, appraiserA, emptySampleUpdate)).rejects.toThrow(
      /not a draft/i,
    );
    await expect(repo.saveFeatures(created.id, appraiserA, emptyFeaturesUpdate)).rejects.toThrow(
      /not a draft/i,
    );
    await expect(repo.confirmCalculation(created.id, appraiserA)).rejects.toThrow(/not a draft/i);
  });
});

/**
 * T8 removes the four bulk-confirmation buttons from step 7. Each of them was
 * the last exit for some `to_verify` a draft could be parked at, so before the
 * deletion every such state needs a proof that a step the appraiser can reach
 * still clears it. The bar is reachability, not convenience: an appraiser who
 * can never issue an operat is a worse failure than a button on the wrong
 * screen.
 *
 * Reachability itself is structural and holds for all of these: `StepOperat`
 * renders only inside the wizard branch (`status === "in_progress"`), and
 * `maxReachedStep` returns 7 exactly when `wr != null` — so a draft that can
 * show step 7 at all can also open steps 1–6, and `resolveStep` clamps to a
 * max that is already 7. What the tests below add is the other half: that the
 * owning step can still SAVE such a draft, and that its save confirms.
 *
 * These pass on arrival — the exits were built in T7. That is the point: they
 * are the guard that stops a later change from removing an exit silently. Each
 * was verified by mutation (see the task report).
 */
describe("every to_verify a legacy draft can hold has a step that clears it (T8)", () => {
  /**
   * The shape staging actually holds, and the one the deleted
   * `confirm-subject-button` was covering: a draft created BEFORE geocoding
   * moved to step 1 (T7). It never ran the step-1 EGiB/MPZP fetch — `subject`
   * is null, so there is no subject card on any screen — but the step-3 RCN
   * fetch resolved its address to a point, so `sampleMeta` is set and the F-4
   * gate demands a `geocode` confirmation. A KW extract is attached too, which
   * puts `provenance.kw` and the document-sourced `area` in the same state.
   */
  function legacyStuckDraft(address: string) {
    return {
      ...valuationInput(appraiserA.id, address),
      area: 54.3,
      wr: null,
      inputs: {
        area: 54.3,
        comparables: Array.from({ length: 12 }, (_, i) => ({
          date: "2025-03",
          area: 50 + i,
          pricePerM2: 10_000 + i,
          source: "rcn" as const,
          transactionId: `tx-${i}`,
          status: "to_verify" as const,
        })),
        features: [],
        sampleMeta: {
          point: { x: 355300.15, y: 505330.31, source: "subject" as const },
          maxRadiusM: 3000,
          counts: { fetched: 100, deduped: 10, noPos: 0 },
          fetchedAt: "2026-07-14T09:00:00.000Z",
          source: "rcn-wfs-gugik" as const,
          query: {
            bbox: [1, 2, 3, 4],
            count: 5000,
            sort: "dok_data D",
            pages: 1,
            truncated: false,
          },
        },
        subject: null,
        subjectMeta: null,
        kw: {
          source: "odpis_kw" as const,
          kwLokalu: "KW-TEST-1",
          kwGruntu: "KW-TEST-1",
          kwInne: [],
          deweloperski: false,
          powUzytkowaKw: 54.3,
          udzial: null,
          sad: null,
          wydzial: null,
          dataDokumentu: null,
          dzial3: null,
          dzial4: null,
        },
        kwMeta: {
          model: "test-model",
          extractedAt: "2026-07-14T09:00:00.000Z",
          docTypeDetected: "odpis_kw" as const,
          docTypeDeclared: "odpis_kw" as const,
        },
        provenance: {
          address: { source: "rzeczoznawca", status: "confirmed" },
          area: { source: "odpis_kw", status: "to_verify" },
          geocode: { source: "geokoder", status: "to_verify" },
          kw: { source: "odpis_kw", status: "to_verify" },
        } as InputsProvenance,
      } satisfies KcsInput,
    };
  }

  /**
   * The step-1 round trip as the appraiser performs it: the form seeds itself
   * from the STORED draft (`step1DefaultsFromInputs`), the step-1 schema
   * validates what it submits, and the ACL re-derives provenance — the chain
   * `saveSubjectAction` runs, minus its session guard.
   *
   * Deliberately not a hand-written `SubjectUpdate`: that would prove the repo
   * confirms, while the question T8 has to answer is whether a legacy draft
   * can still be SUBMITTED at all. A stored `kw`/`kwMeta` the current schema
   * rejects would leave `provenance.kw` and `provenance.geocode` permanent,
   * and only a round trip through the real schema can see that.
   */
  async function resubmitStep1(v: Valuation) {
    const parsed = step1Schema.parse(step1DefaultsFromInputs(v));
    const subjectTouched = !isEmptySubject(parsed.subject);
    const effSubject = subjectTouched ? parsed.subject : undefined;
    const effSubjectMeta = subjectTouched ? parsed.subjectMeta : undefined;
    return repo.saveSubject(v.id, appraiserA, {
      address: parsed.address,
      area: parsed.area,
      purpose: parsed.purpose,
      kwNumber: parsed.kwNumber?.trim() || null,
      client: parsed.client,
      subject: effSubject ?? null,
      subjectMeta: effSubjectMeta ?? null,
      kw: parsed.kw ? normalizeKw(parsed.kw) : null,
      kwMeta: parsed.kwMeta ?? null,
      provenance: assignSubjectProvenance({
        area: parsed.area,
        subject: effSubject,
        subjectMeta: effSubjectMeta,
        kw: parsed.kw,
        kwMeta: parsed.kwMeta,
      }),
    });
  }

  /** The step-3 round trip, same idea — the form's own default mapping
   * (`step-sample.tsx`) carries `source` and `transactionId` back. */
  async function resubmitStep3(v: Valuation) {
    const parsed = sampleStepSchema.parse({
      comparables: v.inputs!.comparables.map((c) => ({
        date: c.date ?? "",
        area: c.area != null ? String(c.area) : undefined,
        pricePerM2: String(c.pricePerM2),
        source: c.source,
        transactionId: c.transactionId,
      })),
      sampleMeta: v.inputs!.sampleMeta ?? undefined,
    });
    return repo.saveSample(v.id, appraiserA, {
      comparables: assignSampleProvenance(parsed),
      sampleMeta: parsed.sampleMeta ?? null,
    });
  }

  it("step 1 clears a geocoding, a KW extract and a document-sourced area on a subject-less draft", async () => {
    const created = await repo.create(legacyStuckDraft("Wizard Legacy Stuck Subject"));
    expect(gateBlockerPaths(created.inputs!)).toEqual(
      expect.arrayContaining(["provenance.geocode", "provenance.kw", "provenance.area"]),
    );

    await resubmitStep1((await repo.get(created.id, appraiserA))!);

    const cleared = await repo.get(created.id, appraiserA);
    const p = cleared!.inputs!.provenance!;
    // The subject stayed null — this draft has no EGiB/MPZP to show, which is
    // exactly why the deleted button asked the appraiser to vouch for nothing.
    expect(cleared!.inputs!.subject).toBeNull();
    expect(p.geocode).toEqual({ source: "geokoder", status: "confirmed" });
    expect(p.kw).toEqual({ source: "odpis_kw", status: "confirmed" });
    expect(p.area).toEqual({ source: "odpis_kw", status: "confirmed" });
    expect(gateBlockerPaths(cleared!.inputs!)).not.toEqual(
      expect.arrayContaining(["provenance.geocode", "provenance.kw", "provenance.area"]),
    );
    // The cost of turning that button into a link, stated rather than hidden:
    // a step-1 save invalidates the calculation, so the appraiser walks step 5
    // (and step 6) again. Reachable, not free.
    expect(cleared!.wr).toBeNull();
  });

  it("step 3 clears twelve stored RCN transactions resubmitted unchanged", async () => {
    const created = await repo.create(legacyStuckDraft("Wizard Legacy Stuck Sample"));
    expect(gateBlockerPaths(created.inputs!)).toEqual(
      expect.arrayContaining(["comparables[0]", "comparables[11]"]),
    );

    await resubmitStep3((await repo.get(created.id, appraiserA))!);

    const cleared = await repo.get(created.id, appraiserA);
    expect(cleared!.inputs!.comparables).toHaveLength(12);
    expect(cleared!.inputs!.comparables.every((c) => c.source === "rcn")).toBe(true);
    expect(cleared!.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
    expect(gateBlockerPaths(cleared!.inputs!).some((path) => path.startsWith("comparables["))).toBe(
      false,
    );
  });

  it("step 4 clears the feature group, including a legacy draft carrying no weights/ratings at all", async () => {
    const created = await repo.create(legacyStuckDraft("Wizard Legacy Stuck Features"));
    // Absent provenance is the harshest case: the gate default-denies, so a
    // pre-preset draft blocks on entries that were never written.
    expect(gateBlockerPaths(created.inputs!)).toEqual(
      expect.arrayContaining(["provenance.weights", "provenance.ratings"]),
    );

    // The fragment `assignFeaturesProvenance` produces for a preset the
    // appraiser left untouched: the weights and the rating scale enter
    // re-verification, the ratings are the appraiser's own by definition.
    // `confirmFeaturesProvenance` flips the first two and never touches
    // `ratings` — which is safe only because no ACL path ever stamps it
    // anything but `confirmed`.
    await repo.saveFeatures(created.id, appraiserA, {
      features: [{ name: "standard", weight: 1, rating: "przecietna", key: "standard" }],
      provenance: {
        weights: { source: "preset", status: "to_verify" },
        ratings: { source: "rzeczoznawca", status: "confirmed" },
        featureDefs: { source: "preset", status: "to_verify" },
      },
    });

    const cleared = await repo.get(created.id, appraiserA);
    const p = cleared!.inputs!.provenance!;
    expect(p.weights).toEqual({ source: "preset", status: "confirmed" });
    expect(p.ratings).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(p.featureDefs).toEqual({ source: "preset", status: "confirmed" });
    for (const path of ["provenance.weights", "provenance.ratings", "provenance.featureDefs"]) {
      expect(gateBlockerPaths(cleared!.inputs!)).not.toContain(path);
    }
  });
});
