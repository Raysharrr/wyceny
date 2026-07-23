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
import type { Comparable } from "../src/domain/kcs";
import type { SessionUser } from "../src/ports/valuation";
import { approvableInput, partialDraftInputs, valuationInput } from "./fixtures/valuation-inputs";

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

  it("saveFeatures persists features + the provenance fragment (preset -> weights to_verify)", async () => {
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
    expect(updated!.inputs!.provenance!.weights).toEqual({ source: "preset", status: "to_verify" });
    expect(updated!.wr).toBeNull();
  });

  it("saveSubject updates the address/area columns and inputs.area", async () => {
    const created = await repo.create(partialDraft("Wizard Subject 1"));

    const updated = await repo.saveSubject(created.id, appraiserA, subjectUpdate);

    expect(updated!.address).toBe(subjectUpdate.address);
    expect(updated!.area).toBe(77);
    expect(updated!.inputs!.area).toBe(77);
    expect(updated!.wr).toBeNull();
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
    const created = await repo.create(approvableInput(appraiserA.id));
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
