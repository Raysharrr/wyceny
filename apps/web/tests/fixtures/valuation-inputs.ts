import type { KcsInput } from "../../src/domain/kcs";
import type { InputsProvenance } from "../../src/domain/provenance";
import { currentSectionFactsHash } from "../../src/domain/prose-hash";
import { PROSE_SECTIONS, type ProseSnapshot } from "../../src/domain/prose-snapshot";
import type { NewValuationInput } from "../../src/ports/valuation";

/**
 * A prose snapshot in the ONLY shape that clears the T7 gate: all six
 * sections written, every one `rzeczoznawca`/`confirmed` — i.e. what
 * `confirmProseSnapshot` leaves behind after the appraiser submits step 6.
 * Fictional text (F-9): no sentence here describes a real property.
 *
 * ⚠️ `factsHash` names the SAME made-up fingerprint for all six sections (T2:
 * the snapshot carries one hash per section), and it is not any real draft's —
 * so to the F-4 gate EVERY section of this snapshot reads STALE, and a gate
 * test built on it blocks on all six no matter what the code under test does.
 * That makes it the right fixture for exactly two things: callers that only
 * need "some fingerprint present" (e.g. checking that a confirm mutates it),
 * and the migration path (a snapshot whose hashes predate today's facts).
 * Anything that has to CLEAR a per-section staleness check — or prove that one
 * section blocks while the others do not — wants {@link confirmedProseFor},
 * which fingerprints against the draft it is attached to.
 */
export function confirmedProse(factsHash = "0".repeat(64)): ProseSnapshot {
  return {
    sections: Object.fromEntries(
      PROSE_SECTIONS.map((section) => [
        section,
        {
          value: `Tekst sekcji ${section} — dane testowe, nie opisują żadnej rzeczywistej nieruchomości.`,
          provenance: { source: "rzeczoznawca" as const, status: "confirmed" as const },
        },
      ]),
    ) as ProseSnapshot["sections"],
    rejected: {},
    factsHashes: Object.fromEntries(PROSE_SECTIONS.map((section) => [section, factsHash])),
    model: "test-model",
    generatedAt: "2026-07-10T09:00:00.000Z",
  };
}

/**
 * The same snapshot, but carrying each section's OWN fingerprint of the
 * draft it is attached to — i.e. prose that describes THESE facts. Anything
 * else now reads as stale to the F-4 gate (T6 review, I-2), which is the
 * whole point: a fixture that clears the gate has to be one the appraiser
 * could actually have produced. `inputs.prose` itself is not part of any
 * fingerprint, so passing the inputs without it is exactly right.
 */
export function confirmedProseFor(address: string, inputs: KcsInput): ProseSnapshot {
  const base = confirmedProse();
  return {
    ...base,
    factsHashes: Object.fromEntries(
      PROSE_SECTIONS.map((section) => [
        section,
        currentSectionFactsHash(section, { address, inputs }),
      ]),
    ) as ProseSnapshot["factsHashes"],
  };
}

/**
 * Attaches to `inputs` the prose the appraiser would have confirmed on THIS
 * draft — six sections, `rzeczoznawca`/`confirmed`, fingerprinted against
 * these facts and this address.
 *
 * Needed by every repo-level approve test since T4 fix round 1: the repo now
 * derives `requireProse` from the FR-6 kill switch inside its own transaction
 * instead of taking it from the caller, so a draft with no prose is refused
 * there exactly as it is in the action. `approvableInput`/`approvableInputs`
 * deliberately stay prose-less — the tests that prove the gate REFUSES a bare
 * draft need that shape.
 *
 * Survives `confirmSample`: flipping provenance statuses moves none of the
 * six fingerprints (measured, not assumed), so this can be attached at
 * creation time and the draft still clears the gate after the sample is
 * confirmed.
 */
export function withConfirmedProse(address: string, inputs: KcsInput): KcsInput {
  return { ...inputs, prose: confirmedProseFor(address, inputs) };
}

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
 * `NewValuationInput` wrapper that clears the F-4 gate's PRE-PROSE groups AND
 * the document-field blockers already at creation time (sample + geocode
 * pre-confirmed) — lets a test call `repo.approve` directly with no
 * `confirmSample` round-trip (F-7 Task 4 audit-log coverage).
 *
 * ⚠️ It carries NO prose, so on its own it does NOT clear the whole gate any
 * more: since T4 fix round 1 the repo derives `requireProse` from the FR-6
 * kill switch inside its own transaction, so `repo.approve` refuses this
 * shape exactly as the action does. That is deliberate — the tests proving
 * the gate REFUSES a bare draft need it. A test that wants an approval to
 * SUCCEED wraps the inputs in {@link withConfirmedProse}.
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
