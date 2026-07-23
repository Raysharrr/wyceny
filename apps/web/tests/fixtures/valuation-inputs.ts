import type { KcsInput } from "../../src/domain/kcs";
import type { InputsProvenance } from "../../src/domain/provenance";
import type { NewValuationInput } from "../../src/ports/valuation";

/**
 * Shared `NewValuationInput` fixture (moved from `valuation-repo.test.ts`,
 * F-7 Task 4). Document fields present by default so gate-passing approvals
 * also clear the document-field blockers (spec §4); callers override them to
 * null for the legacy-draft scenario.
 */
export function valuationInput(ownerId: string, address: string): NewValuationInput {
  return {
    address,
    area: 33.3,
    wr: 333000,
    inputs: null,
    amountInWords: null,
    docUrl: null,
    purpose: "sprzedaz",
    kwNumber: "KW-TEST-1",
    client: "p. Jan Testowy",
    inspectionDate: "2026-07-01",
    ownerId,
  };
}

/**
 * `KcsInput` fixture with 12 rcn comparables + geocode, both `to_verify`
 * (moved from `valuation-repo.test.ts`, F-7 Task 4). Does NOT pass the F-4
 * gate on its own — `confirmSample` must flip the sample to `confirmed`
 * first; this is what makes it useful for testing that mutation.
 */
export function approvableInputs(): KcsInput {
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

/**
 * `NewValuationInput` wrapper that passes the F-4 gate AND the
 * document-field blockers already at creation time (sample + geocode
 * pre-confirmed) — lets a test call `repo.approve` directly with no
 * `confirmSample` round-trip (F-7 Task 4 audit-log coverage).
 */
export function approvableInput(ownerId: string): NewValuationInput {
  const base = approvableInputs();
  return {
    ...valuationInput(ownerId, "Audit approvable"),
    inputs: {
      ...base,
      comparables: base.comparables.map((c) => ({ ...c, status: "confirmed" as const })),
      provenance: {
        ...base.provenance!,
        geocode: { source: "geokoder" as const, status: "confirmed" as const },
      },
    },
    purpose: "sprzedaz",
    kwNumber: "PO1P/1/6",
    client: "Jan Testowy",
    inspectionDate: "2026-07-10",
  };
}

/**
 * Partial-draft `KcsInput` (Slice 11a wizard, Task 4): the shape a wizard
 * draft has right after step 1 (Przedmiot) — no sample, no features yet,
 * only the two scalar groups that step confirms (address/area). Exercises
 * the create-with-null-wr, saveSample/saveFeatures-"from nothing" and
 * confirmCalculation-not-ready paths.
 */
export function partialDraftInputs(): KcsInput {
  return {
    area: 50,
    comparables: [],
    features: [],
    sampleMeta: null,
    provenance: {
      address: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      area: { source: "rzeczoznawca" as const, status: "confirmed" as const },
    } as InputsProvenance,
  };
}

/**
 * Same as `approvableInput`, but one rcn comparable is reset to
 * `to_verify` — the F-4 gate blocks approval directly, so `confirmSample`
 * is required first (F-7 Task 4's confirmSample audit-row test).
 */
export function confirmableInput(ownerId: string): NewValuationInput {
  const input = approvableInput(ownerId);
  const inputs = input.inputs!;
  return {
    ...input,
    inputs: {
      ...inputs,
      comparables: [
        { ...inputs.comparables[0], status: "to_verify" as const },
        ...inputs.comparables.slice(1),
      ],
    },
  };
}
