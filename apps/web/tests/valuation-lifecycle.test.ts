import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTIONS,
  ApprovalBlockedError,
  NotSignableError,
  applyFeaturesUpdate,
  applySampleUpdate,
  applySubjectUpdate,
  approveValuation,
  type FeaturesUpdate,
  type SubjectUpdate,
  confirmFeaturesProvenance,
  confirmKwProvenance,
  confirmSampleProvenance,
  confirmSubjectProvenance,
  newVersionOf,
  signValuation,
} from "../src/domain/valuation";
import type { Valuation } from "../src/ports/valuation";
import type { Comparable, KcsInput } from "../src/domain/kcs";
import { approvalGate, type InputsProvenance } from "../src/domain/provenance";
import { confirmProseSnapshot, PROSE_SECTIONS } from "../src/domain/prose-snapshot";
import { confirmedProse } from "./fixtures/valuation-inputs";
import { assignSampleProvenance } from "../src/lib/assign-provenance";

const confirmedScalars: InputsProvenance = {
  address: { source: "rzeczoznawca", status: "confirmed" },
  area: { source: "rzeczoznawca", status: "confirmed" },
  weights: { source: "rzeczoznawca", status: "confirmed" },
  ratings: { source: "rzeczoznawca", status: "confirmed" },
};

function draftWith(inputs: KcsInput | null, overrides: Partial<Valuation> = {}): Valuation {
  return {
    id: "v-1",
    address: "ul. Testowa 1, Poznań",
    area: 50,
    wr: 500_000,
    inputs,
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    // Document fields present by default so the gate-passing tests also clear
    // the document-field blockers (spec §4). The legacy-draft test overrides
    // them to null to prove approval blocks on a missing purpose/kw/etc.
    purpose: "sprzedaz",
    kwNumber: "KW-TEST-1",
    client: "p. Jan Testowy",
    inspectionDate: "2026-07-01",
    ownerId: "owner-1",
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
    mapsFrozenFor: null,
    createdAt: new Date("2026-07-14T10:00:00Z"),
    ...overrides,
  };
}

function rcnInputs(): KcsInput {
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
      point: { x: 355300.15, y: 505330.31, source: "subject" as const },
      maxRadiusM: 3000,
      counts: { fetched: 100, deduped: 10, noPos: 0 },
      fetchedAt: "2026-07-14T09:00:00.000Z",
      source: "rcn-wfs-gugik" as const,
      query: { bbox: [1, 2, 3, 4], count: 5000, sort: "dok_data D", pages: 1, truncated: false },
    },
    provenance: { ...confirmedScalars, geocode: { source: "geokoder", status: "to_verify" } },
  };
}

describe("confirmSampleProvenance", () => {
  it("flips rcn rows to confirmed, leaves scalars untouched", () => {
    const v = confirmSampleProvenance(draftWith(rcnInputs()));
    expect(v.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
    expect(v.inputs!.provenance!.address.status).toBe("confirmed");
    expect(v.status).toBe("in_progress");
  });

  /**
   * T7: geocoding is a property of the ADDRESS, and the address is read on
   * step 1 — so step 1 confirms it (`confirmSubjectProvenance`) and step 3
   * must not. Confirming it here meant the appraiser vouched, from a screen
   * that never shows the point, for the coordinate the whole RCN/map chain
   * hangs off.
   */
  it("leaves the geocode entry to step 1", () => {
    const v = confirmSampleProvenance(draftWith(rcnInputs()));
    expect(v.inputs!.provenance!.geocode).toEqual({ source: "geokoder", status: "to_verify" });
  });

  it("does not touch manual rows (already confirmed) and is idempotent", () => {
    const first = confirmSampleProvenance(draftWith(rcnInputs()));
    const second = confirmSampleProvenance(first);
    expect(second.inputs).toEqual(first.inputs);
  });

  it("throws when the valuation is not a draft", () => {
    const approved = { ...draftWith(rcnInputs()), status: "approved" as const };
    expect(() => confirmSampleProvenance(approved)).toThrow(/draft/i);
  });

  it("throws when there is no inputs snapshot", () => {
    expect(() => confirmSampleProvenance(draftWith(null))).toThrow(/inputs/i);
  });
});

/** A provenance map as it looks before anything geocoded the draft. */
function withoutGeocode(p: InputsProvenance): InputsProvenance {
  const copy = { ...p };
  delete copy.geocode;
  return copy;
}

function subjectInputs(): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
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
      ...confirmedScalars,
      ewidencja: { source: "ewidencja", status: "to_verify" },
      mpzp: { source: "mpzp", status: "to_verify" },
    },
  };
}

describe("confirmSubjectProvenance", () => {
  it("flips ewidencja and mpzp to confirmed", () => {
    const v = confirmSubjectProvenance(draftWith(subjectInputs()));
    expect(v.inputs!.provenance!.ewidencja).toEqual({ source: "ewidencja", status: "confirmed" });
    expect(v.inputs!.provenance!.mpzp).toEqual({ source: "mpzp", status: "confirmed" });
  });

  /** T7: the address's geocoding is confirmed on the step that reads the address. */
  it("flips geocode to confirmed — it belongs to the address, not to the sample", () => {
    const inputs = subjectInputs();
    const v = confirmSubjectProvenance(
      draftWith({
        ...inputs,
        provenance: {
          ...inputs.provenance!,
          geocode: { source: "geokoder", status: "to_verify" },
        },
      }),
    );
    expect(v.inputs!.provenance!.geocode).toEqual({ source: "geokoder", status: "confirmed" });
  });

  it("no-op on legacy inputs without subject", () => {
    // Geocode stripped from the fixture: since T7 this function owns that key
    // too, so inputs carrying one are no longer an untouched-map case.
    const legacy = draftWith({
      ...rcnInputs(),
      provenance: withoutGeocode(rcnInputs().provenance!),
    });
    const v = confirmSubjectProvenance(legacy);
    expect(v.inputs).toEqual(legacy.inputs);
  });

  it("throws when the valuation is not a draft (mirrors confirmSampleProvenance's guard — F-7)", () => {
    const approved = { ...draftWith(subjectInputs()), status: "approved" as const };
    expect(() => confirmSubjectProvenance(approved)).toThrow(/draft/i);
  });

  it("throws when there is no inputs snapshot (mirrors confirmSampleProvenance's guard)", () => {
    expect(() => confirmSubjectProvenance(draftWith(null))).toThrow(/inputs/i);
  });
});

function kwInputs(provenanceOverrides: Partial<InputsProvenance> = {}): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features: [{ name: "standard", weight: 1, rating: "przecietna" as const }],
    provenance: { ...confirmedScalars, ...provenanceOverrides },
  };
}

describe("confirmKwProvenance (Slice 6)", () => {
  it("flips kw and document-sourced area to confirmed, leaves others", () => {
    const v = draftWith(
      kwInputs({
        kw: { source: "akt", status: "to_verify" },
        area: { source: "akt", status: "to_verify" },
      }),
    );
    const out = confirmKwProvenance(v);
    expect(out.inputs!.provenance!.kw!.status).toBe("confirmed");
    expect(out.inputs!.provenance!.area.status).toBe("confirmed");
  });

  it("does not touch manual area provenance", () => {
    const v = draftWith(
      kwInputs({
        kw: { source: "odpis_kw", status: "to_verify" },
      }),
    );
    const out = confirmKwProvenance(v);
    expect(out.inputs!.provenance!.area.source).toBe("rzeczoznawca");
  });

  it("throws on non-draft and on missing inputs (F-7 guards)", () => {
    const approved = {
      ...draftWith(kwInputs({ kw: { source: "akt", status: "to_verify" } })),
      status: "approved" as const,
    };
    expect(() => confirmKwProvenance(approved)).toThrow();
    expect(() => confirmKwProvenance(draftWith(null))).toThrow();
  });
});

describe("confirmFeaturesProvenance (Slice 7)", () => {
  it("flips weights + featureDefs to confirmed, draft-only", () => {
    const draft = draftWith(
      kwInputs({
        weights: { source: "preset", status: "to_verify" },
        featureDefs: { source: "preset", status: "to_verify" },
      }),
    );
    const updated = confirmFeaturesProvenance(draft);
    expect(updated.inputs!.provenance!.weights).toEqual({ source: "preset", status: "confirmed" });
    expect(updated.inputs!.provenance!.featureDefs).toEqual({
      source: "preset",
      status: "confirmed",
    });
  });

  it("on legacy provenance (no featureDefs) flips weights only", () => {
    const draft = draftWith(kwInputs({ weights: { source: "preset", status: "to_verify" } }));
    const updated = confirmFeaturesProvenance(draft);
    expect(updated.inputs!.provenance!.featureDefs).toBeUndefined();
    expect(updated.inputs!.provenance!.weights.status).toBe("confirmed");
  });

  it("throws on non-draft and on missing inputs (F-7 guards)", () => {
    const approved = {
      ...draftWith(kwInputs({ weights: { source: "preset", status: "to_verify" } })),
      status: "approved" as const,
    };
    expect(() => confirmFeaturesProvenance(approved)).toThrow(/draft/i);
    expect(() => confirmFeaturesProvenance(draftWith(null))).toThrow(/inputs/i);
  });
});

/**
 * Twelve rcn rows waiting for the bulk confirm — `confirmSampleProvenance`
 * turns this into the twelve confirmed transactions the edit tests below
 * work on.
 */
const draftWithTwelveConfirmed = draftWith(rcnInputs());

/**
 * Task 6 — an edit unconfirms exactly what changed, and nothing else. Until
 * now every step-3 save re-derived the whole sample as `to_verify` (the ACL
 * reads the status off the source alone), so correcting one price charged the
 * appraiser eleven re-verifications they had already done.
 */
describe("applySampleUpdate — punktowe zdejmowanie potwierdzeń (Task 6)", () => {
  it("editing one comparable unconfirms that row and no other", () => {
    const confirmed = confirmSampleProvenance(draftWithTwelveConfirmed);
    const edited = applySampleUpdate(confirmed, {
      comparables: confirmed.inputs!.comparables.map((c, i) =>
        i === 6 ? { ...c, pricePerM2: 9999 } : c,
      ),
      sampleMeta: confirmed.inputs!.sampleMeta ?? null,
    });
    const statuses = edited.inputs!.comparables.map((c) => c.status);
    expect(statuses[6]).toBe("to_verify");
    expect(statuses.filter((s) => s === "confirmed")).toHaveLength(11);
  });

  it("deleting a row does not slide another row's confirmation onto it", () => {
    const confirmed = confirmSampleProvenance(draftWithTwelveConfirmed);
    const withoutThird = confirmed.inputs!.comparables.filter((_, i) => i !== 2);
    const edited = applySampleUpdate(confirmed, {
      comparables: withoutThird,
      sampleMeta: confirmed.inputs!.sampleMeta ?? null,
    });
    // The eleven survivors keep their own confirmations — matched by content,
    // so nothing shifted onto a neighbour.
    expect(edited.inputs!.comparables).toHaveLength(11);
    expect(edited.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
  });

  /**
   * The manual-row exemption, and why it is not an oversight: the step-3 form
   * has a "Dodaj transakcję" button, `confirmSampleProvenance` flips only rcn
   * rows, and `isBlocking` blocks on `to_verify` whatever the source. Sending
   * a hand-typed row to `to_verify` would therefore park it in a state nothing
   * in the app can clear — approval blocked forever on data the appraiser
   * entered themselves.
   */
  it("leaves a transaction the appraiser typed themselves confirmed — nothing else could clear it", () => {
    // Step 1's confirmation too: since T7 the geocoding is confirmed there,
    // and this assertion is about the gate seeing no SAMPLE blocker.
    const confirmed = confirmSubjectProvenance(confirmSampleProvenance(draftWithTwelveConfirmed));
    const typed: Comparable = { pricePerM2: 11_000, source: "manual", status: "confirmed" };
    const edited = applySampleUpdate(confirmed, {
      comparables: [...confirmed.inputs!.comparables, typed],
      sampleMeta: confirmed.inputs!.sampleMeta ?? null,
    });
    expect(edited.inputs!.comparables[12].status).toBe("confirmed");
    expect(approvalGate(edited.inputs!).ok).toBe(true);
  });

  /**
   * A live shape, not a hypothetical: the worker emits
   * `"transaction_id": get("tran_lokalny_id_iip") or ""` (`rcn.py:68`) and
   * `sample-http.ts` casts the response without validating it, so a genuinely
   * fetched row can reach the snapshot with an EMPTY id. `??` would take that
   * `""` as the row's key and file every such row under one bucket; `||` lets
   * it fall through to the content key like any other missing id.
   */
  const twelveWithEmptyIds = () =>
    Array.from({ length: 12 }, (_, i) => ({
      date: `2025-${String(i + 1).padStart(2, "0")}`,
      area: 50 + i,
      pricePerM2: 10_000 + i,
      source: "rcn" as const,
      transactionId: "",
      status: "to_verify" as const,
    }));

  it("keys a row with an empty fetched id by content: editing one unconfirms only it", () => {
    const confirmed = confirmSampleProvenance(
      draftWith({ ...rcnInputs(), comparables: twelveWithEmptyIds() }),
    );
    const edited = applySampleUpdate(confirmed, {
      comparables: confirmed.inputs!.comparables.map((c, i) =>
        i === 6 ? { ...c, pricePerM2: 9_999 } : c,
      ),
      sampleMeta: confirmed.inputs!.sampleMeta ?? null,
    });
    const statuses = edited.inputs!.comparables.map((c) => c.status);
    expect(statuses[6]).toBe("to_verify");
    expect(statuses.filter((s) => s === "confirmed")).toHaveLength(11);
  });

  it("keeps every empty-id survivor confirmed when a row is deleted", () => {
    const confirmed = confirmSampleProvenance(
      draftWith({ ...rcnInputs(), comparables: twelveWithEmptyIds() }),
    );
    const edited = applySampleUpdate(confirmed, {
      comparables: confirmed.inputs!.comparables.filter((_, i) => i !== 2),
      sampleMeta: confirmed.inputs!.sampleMeta ?? null,
    });
    expect(edited.inputs!.comparables).toHaveLength(11);
    expect(edited.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
  });

  /**
   * The matcher is only worth anything if the boundary preserves what it
   * matches on. This runs the REAL step-3 ACL over form-shaped rows, exactly
   * as `saveSampleAction` does — `assignSampleProvenance` re-derives every
   * status from the source alone, which is what used to wipe the whole
   * sample. `status` is deliberately absent from what the form posts: the
   * server owns it (ADR-010).
   */
  it("survives the real step-3 ACL: one corrected price costs exactly one confirmation", () => {
    const fetched = Array.from({ length: 12 }, (_, i) => ({
      date: "2025-03",
      area: 50 + i,
      pricePerM2: 10_000 + i,
      source: "rcn" as const,
      transactionId: `tx-${i}`,
    }));
    const confirmed = confirmSampleProvenance(
      draftWith({
        ...rcnInputs(),
        comparables: fetched.map((c) => ({ ...c, status: "to_verify" as const })),
      }),
    );
    const posted = fetched.map((c, i) => (i === 6 ? { ...c, pricePerM2: 9_999 } : c));
    const comparables = assignSampleProvenance({ comparables: posted });

    const edited = applySampleUpdate(confirmed, {
      comparables,
      sampleMeta: confirmed.inputs!.sampleMeta ?? null,
    });

    const statuses = edited.inputs!.comparables.map((c) => c.status);
    expect(statuses[6]).toBe("to_verify");
    expect(statuses.filter((s) => s === "confirmed")).toHaveLength(11);
  });

  /**
   * The last path where the request's own label decided trust: strip the
   * fetched id AND rewrite `source`, and the row would enter as the
   * appraiser's own measurement. `sameComparable` cannot catch it (it
   * compares `transactionId`, and dropping the id is the move), so the
   * SNAPSHOT answers instead — it is the server's record of what the RCN
   * fetch returned, and here it is the row the write transaction holds
   * locked, not one read moments earlier.
   */
  it("re-labels a row the snapshot holds as rcn, whatever the request called it", () => {
    const confirmed = confirmSampleProvenance(draftWithTwelveConfirmed);
    // Exactly what the step-3 ACL stamps for rows posted with no id and a
    // "manual" label: manual/confirmed, no click required.
    const posted = confirmed.inputs!.comparables.map((c) => ({
      date: c.date,
      area: c.area,
      pricePerM2: c.pricePerM2,
      source: "manual" as const,
      status: "confirmed" as const,
    }));

    const saved = applySampleUpdate(confirmed, {
      comparables: posted,
      sampleMeta: confirmed.inputs!.sampleMeta ?? null,
    });

    expect(saved.inputs!.comparables.every((c) => c.source === "rcn")).toBe(true);
    expect(saved.inputs!.comparables.every((c) => c.status === "to_verify")).toBe(true);
  });

  it("promotes only: a snapshot manual row never demotes an incoming rcn one", () => {
    const manual = draftWith({
      ...rcnInputs(),
      comparables: [
        { pricePerM2: 10_000, source: "manual" as const, status: "confirmed" as const },
      ],
    });

    const saved = applySampleUpdate(manual, {
      comparables: [{ pricePerM2: 10_000, source: "rcn" as const, status: "to_verify" as const }],
      sampleMeta: manual.inputs!.sampleMeta ?? null,
    });

    expect(saved.inputs!.comparables[0].source).toBe("rcn");
    expect(saved.inputs!.comparables[0].status).toBe("to_verify");
  });

  it("leaves a hand-typed row matching nothing in the snapshot alone", () => {
    const confirmed = confirmSampleProvenance(draftWithTwelveConfirmed);
    const typed: Comparable = { pricePerM2: 7_777, source: "manual", status: "confirmed" };

    const saved = applySampleUpdate(confirmed, {
      comparables: [...confirmed.inputs!.comparables, typed],
      sampleMeta: confirmed.inputs!.sampleMeta ?? null,
    });

    expect(saved.inputs!.comparables[12]).toEqual(typed);
  });

  /**
   * Legacy snapshots carry rows with no `status` at all (the field is
   * optional so they keep parsing). Stamping that absence onto the incoming
   * row would re-open the same trap from the other side: `to_verify` is what
   * `confirmSampleProvenance` looks for, and `undefined` is not it.
   */
  it("hands an unstamped snapshot row back to the ACL's verdict, so it stays confirmable", () => {
    const unstamped = rcnInputs().comparables.map((c) => {
      const row: Comparable = { ...c };
      delete row.status;
      return row;
    });
    const legacy = draftWith({ ...rcnInputs(), comparables: unstamped });
    const saved = applySampleUpdate(legacy, {
      // Exactly what the step-3 ACL re-derives for these rows.
      comparables: unstamped.map((c) => ({ ...c, status: "to_verify" as const })),
      sampleMeta: legacy.inputs!.sampleMeta ?? null,
    });
    expect(saved.inputs!.comparables.every((c) => c.status === "to_verify")).toBe(true);
    expect(
      confirmSampleProvenance(saved).inputs!.comparables.every((c) => c.status === "confirmed"),
    ).toBe(true);
  });
});

/**
 * What `assignSubjectProvenance` re-derives on EVERY step-1 save: the source
 * decides the status, so the auto-fetched groups always come back
 * `to_verify`. Handing that straight through is what used to wipe a
 * confirmation the edit never touched.
 */
function reassignedSubjectProvenance(): SubjectUpdate["provenance"] {
  return {
    address: { source: "rzeczoznawca", status: "confirmed" },
    area: { source: "rzeczoznawca", status: "confirmed" },
    ewidencja: { source: "ewidencja", status: "to_verify" },
    mpzp: { source: "mpzp", status: "to_verify" },
  };
}

function subjectUpdateFrom(v: Valuation, overrides: Partial<SubjectUpdate> = {}): SubjectUpdate {
  return {
    address: v.address,
    area: v.inputs!.area,
    purpose: "sprzedaz",
    kwNumber: v.kwNumber,
    client: v.client!,
    subject: v.inputs!.subject ?? null,
    subjectMeta: v.inputs!.subjectMeta ?? null,
    kw: v.inputs!.kw ?? null,
    kwMeta: v.inputs!.kwMeta ?? null,
    provenance: reassignedSubjectProvenance(),
    ...overrides,
  };
}

describe("applySubjectUpdate — the subject group survives an unrelated save (Task 6)", () => {
  const confirmedSubject = () => confirmSubjectProvenance(draftWith(subjectInputs()));

  it("keeps ewidencja/mpzp confirmed when the parcel data came back unchanged", () => {
    // Only the client's name moved — the EGiB/MPZP snapshot is the same one
    // the appraiser already read.
    const v = confirmedSubject();
    const updated = applySubjectUpdate(v, subjectUpdateFrom(v, { client: "p. Anna Testowa" }));
    expect(updated.inputs!.provenance!.ewidencja!.status).toBe("confirmed");
    expect(updated.inputs!.provenance!.mpzp!.status).toBe("confirmed");
  });

  it("sends the whole group back to weryfikacja when the parcel changed", () => {
    const v = confirmedSubject();
    const updated = applySubjectUpdate(
      v,
      subjectUpdateFrom(v, { subject: { obreb: "Jeżyce", nrDzialki: "162" } }),
    );
    expect(updated.inputs!.provenance!.ewidencja!.status).toBe("to_verify");
    expect(updated.inputs!.provenance!.mpzp!.status).toBe("to_verify");
  });

  /**
   * The address is compared HERE, in the domain, rather than left to the UI:
   * today `onAddressBlur` re-fetches EGiB/MPZP on any address change, which
   * moves `subjectMeta.fetchedAt` and lapses the group as a side effect — but
   * that is a UI invariant the domain cannot see, and it is the one place
   * this file could drift toward `confirmed`. So: hold the whole snapshot
   * constant (the autofetch-off shape) and move only the address.
   */
  it("lapses the group on an address change alone, with no re-fetch to lean on", () => {
    const v = confirmedSubject();
    const updated = applySubjectUpdate(
      v,
      subjectUpdateFrom(v, { address: "ul. Klonowa 5, Nowogród" }),
    );
    expect(updated.inputs!.subjectMeta!.fetchedAt).toBe(v.inputs!.subjectMeta!.fetchedAt);
    expect(updated.inputs!.provenance!.ewidencja!.status).toBe("to_verify");
    expect(updated.inputs!.provenance!.mpzp!.status).toBe("to_verify");
  });

  it("treats a changed area as a changed group — it is one snapshot, read together", () => {
    const v = confirmedSubject();
    const updated = applySubjectUpdate(v, subjectUpdateFrom(v, { area: 55 }));
    expect(updated.inputs!.provenance!.ewidencja!.status).toBe("to_verify");
  });
});

describe("applyFeaturesUpdate — the feature group survives an unrelated save (Task 6)", () => {
  const presetFeatures = () => [
    { name: "lokalizacja", weight: 0.6, rating: "przecietna" as const, key: "lokalizacja" },
    { name: "standard", weight: 0.4, rating: "lepsza" as const, key: "standard" },
  ];

  /** What `assignFeaturesProvenance` re-derives when the weights still match
   * the preset: `to_verify`, on every save, regardless of what changed. */
  const reassigned: FeaturesUpdate["provenance"] = {
    weights: { source: "preset", status: "to_verify" },
    ratings: { source: "rzeczoznawca", status: "confirmed" },
    featureDefs: { source: "preset", status: "to_verify" },
  };

  const confirmedFeatures = () =>
    confirmFeaturesProvenance(
      draftWith({
        ...kwInputs({
          weights: { source: "preset", status: "to_verify" },
          featureDefs: { source: "preset", status: "to_verify" },
        }),
        features: presetFeatures(),
      }),
    );

  it("keeps preset weights confirmed when the features came back unchanged", () => {
    const v = confirmedFeatures();
    const updated = applyFeaturesUpdate(v, {
      features: presetFeatures(),
      provenance: reassigned,
    });
    expect(updated.inputs!.provenance!.weights.status).toBe("confirmed");
    expect(updated.inputs!.provenance!.featureDefs!.status).toBe("confirmed");
  });

  it("sends the group back to weryfikacja when a weight moved", () => {
    const v = confirmedFeatures();
    const updated = applyFeaturesUpdate(v, {
      features: [
        { ...presetFeatures()[0], weight: 0.7 },
        { ...presetFeatures()[1], weight: 0.3 },
      ],
      provenance: reassigned,
    });
    expect(updated.inputs!.provenance!.weights.status).toBe("to_verify");
    expect(updated.inputs!.provenance!.featureDefs!.status).toBe("to_verify");
  });
});

describe("approveValuation", () => {
  const now = new Date("2026-07-14T12:00:00Z");

  /**
   * Everything the appraiser confirms before an approval can pass. Since T7
   * that is TWO acts, not one: the sample lives on step 3 and the address's
   * geocoding on step 1, so a draft confirmed only through the sample still
   * blocks on `provenance.geocode` — which is the point of the move.
   */
  const fullyConfirmed = (overrides: Partial<Valuation> = {}) =>
    confirmSubjectProvenance(confirmSampleProvenance(draftWith(rcnInputs(), overrides)));

  it("blocks (ApprovalBlockedError with blockers) while anything is to_verify", () => {
    try {
      approveValuation(draftWith(rcnInputs()), now);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalBlockedError);
      expect((e as ApprovalBlockedError).blockers.length).toBeGreaterThan(0);
    }
  });

  it("approves after confirmation: status approved + approvedAt set", () => {
    const confirmed = fullyConfirmed();
    const approved = approveValuation(confirmed, now);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe(now);
  });

  it("blocks a snapshot-less draft", () => {
    expect(() => approveValuation(draftWith(null), now)).toThrow(ApprovalBlockedError);
  });

  it("throws for non-draft status (write-once after approval)", () => {
    const approved = { ...fullyConfirmed(), status: "approved" as const };
    expect(() => approveValuation(approved, now)).toThrow(/draft/i);
  });

  it("blocks a legacy draft missing document fields, naming purpose (spec §4)", () => {
    const legacy = fullyConfirmed({
      purpose: null,
      kwNumber: null,
      client: null,
      inspectionDate: null,
    });
    try {
      approveValuation(legacy, now);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalBlockedError);
      expect((e as ApprovalBlockedError).blockers.map((b) => b.path)).toContain("purpose");
    }
  });

  it("persists docUrl + docxUrl when passed, alongside status approved", () => {
    const confirmed = fullyConfirmed();
    const approved = approveValuation(confirmed, now, {
      docUrl: "/api/docs/operat-x.pdf",
      docxUrl: "/api/docs/operat-x.docx",
    });
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe(now);
    expect(approved.docUrl).toBe("/api/docs/operat-x.pdf");
    expect(approved.docxUrl).toBe("/api/docs/operat-x.docx");
  });
});

const approvedValuation: Valuation = {
  ...draftWith(rcnInputs()),
  status: "approved",
  docUrl: "/api/docs/operat-y.pdf",
  docxUrl: "/api/docs/operat-y.docx",
  approvedAt: new Date("2026-07-15T10:00:00Z"),
  signedAt: null,
  supersedesId: null,
  mapsFrozenFor: null,
};

describe("signValuation (F-7)", () => {
  it("flips approved → signed and stamps signedAt", () => {
    const now = new Date("2026-07-19T12:00:00Z");
    const signed = signValuation(approvedValuation, now);
    expect(signed.status).toBe("signed");
    expect(signed.signedAt).toBe(now);
  });

  it("refuses a draft", () => {
    expect(() =>
      signValuation({ ...approvedValuation, status: "in_progress" }, new Date()),
    ).toThrow(NotSignableError);
  });

  it("refuses an already-signed valuation", () => {
    expect(() => signValuation({ ...approvedValuation, status: "signed" }, new Date())).toThrow(
      NotSignableError,
    );
  });

  it("refuses a legacy approved row without inputs or docx (not signable)", () => {
    expect(() => signValuation({ ...approvedValuation, inputs: null }, new Date())).toThrow(
      NotSignableError,
    );
    expect(() => signValuation({ ...approvedValuation, docxUrl: null }, new Date())).toThrow(
      NotSignableError,
    );
  });
});

describe("newVersionOf (NFR-3)", () => {
  it("copies a signed valuation into a linked draft", () => {
    const signed = signValuation(approvedValuation, new Date());
    const draft = newVersionOf(signed);
    expect(draft.status).toBe("in_progress");
    expect(draft.supersedesId).toBe(signed.id);
    expect(draft.approvedAt).toBeNull();
    expect(draft.signedAt).toBeNull();
    expect(draft.docUrl).toBeNull();
    expect(draft.docxUrl).toBeNull();
    expect(draft.address).toBe(signed.address);
  });

  it("resets machine-sourced provenance to to_verify, keeps appraiser-sourced confirmed", () => {
    const signed = signValuation(
      {
        ...approvedValuation,
        inputs: {
          ...approvedValuation.inputs!,
          comparables: [
            { ...approvedValuation.inputs!.comparables[0], source: "rcn", status: "confirmed" },
            {
              ...approvedValuation.inputs!.comparables[1],
              source: "manual",
              status: "confirmed",
            },
          ],
          provenance: {
            ...approvedValuation.inputs!.provenance!,
            geocode: { source: "geokoder", status: "confirmed" },
            weights: { source: "rzeczoznawca", status: "confirmed" },
          },
        },
      },
      new Date(),
    );
    const draft = newVersionOf(signed);
    expect(draft.inputs!.comparables[0].status).toBe("to_verify");
    expect(draft.inputs!.comparables[1].status).toBe("confirmed");
    expect(draft.inputs!.provenance!.geocode!.status).toBe("to_verify");
    expect(draft.inputs!.provenance!.weights.status).toBe("confirmed");
  });

  it("refuses a non-signed source", () => {
    expect(() => newVersionOf(approvedValuation)).toThrow(/signed/);
  });

  /**
   * Prose (FR-6, Task 7). Every other snapshot loses its confirmations in a
   * new version; prose must too. Without this the successor would inherit
   * paragraphs stamped "confirmed by the appraiser" that the appraiser never
   * saw in THIS version — and the F-4 gate would let them into a signed
   * operat without a single click. The TEXT survives (deleting it would
   * destroy handwritten work and buy a fresh generation); only the
   * confirmation does not.
   */
  it("resets every prose section to to_verify, keeping the text and its source", () => {
    const signed = signValuation(
      {
        ...approvedValuation,
        inputs: { ...approvedValuation.inputs!, prose: confirmedProse() },
      },
      new Date(),
    );
    const draft = newVersionOf(signed);
    const sections = draft.inputs!.prose!.sections;

    for (const section of PROSE_SECTIONS) {
      expect(sections[section]!.provenance).toEqual({
        source: "rzeczoznawca",
        status: "to_verify",
      });
      expect(sections[section]!.value).toBe(confirmedProse().sections[section]!.value);
    }
    // The generation metadata is not a confirmation — it describes which facts
    // the text was written from and stays as it is.
    expect(draft.inputs!.prose!.factsHashes).toEqual(confirmedProse().factsHashes);
  });

  it("the reset actually blocks the successor's approval (this is the point of it)", () => {
    const signed = signValuation(
      {
        ...approvedValuation,
        inputs: {
          ...confirmSampleProvenance(draftWith(rcnInputs())).inputs!,
          prose: confirmedProse(),
        },
        status: "approved" as const,
      },
      new Date(),
    );
    const draft = newVersionOf(signed);

    const gate = approvalGate(draft.inputs!, { requireProse: true });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      // The sample and the geocode are re-verified too (the pre-existing
      // rule), so this asserts the prose blockers are all THERE, not that
      // they are the only ones.
      expect(gate.blockers.map((b) => b.path)).toEqual(
        expect.arrayContaining(PROSE_SECTIONS.map((s) => `prose.${s}`)),
      );
    }
  });

  it("re-reading the inherited text is enough to clear the gate again — no regeneration needed", () => {
    // The way out has to be one pass through step 6, not a paid round trip:
    // the editors are seeded from `sections[…].value`, and the submit
    // re-stamps whatever the appraiser left there.
    const signed = signValuation(
      {
        ...approvedValuation,
        inputs: {
          ...confirmSampleProvenance(draftWith(rcnInputs())).inputs!,
          prose: confirmedProse(),
        },
        status: "approved" as const,
      },
      new Date(),
    );
    const successor = newVersionOf(signed);
    const inherited = successor.inputs!.prose!;

    // Exactly what step 6 submits: the text already in the fields.
    const texts = Object.fromEntries(
      PROSE_SECTIONS.map((s) => [s, inherited.sections[s]!.value]),
    ) as Record<(typeof PROSE_SECTIONS)[number], string>;
    const reconfirmed = confirmProseSnapshot(inherited, texts, {
      factsHashes: Object.fromEntries(PROSE_SECTIONS.map((s) => [s, "1".repeat(64)])),
      now: new Date("2026-08-18T09:00:00.000Z"),
    });

    const gate = approvalGate({ ...successor.inputs!, prose: reconfirmed }, { requireProse: true });
    // The whole prose group is gone — not just one section, and not merely
    // "some other path shape appeared instead".
    const proseBlockers = (gate.ok ? [] : gate.blockers.map((b) => b.path)).filter((p) =>
      p.startsWith("prose"),
    );
    expect(proseBlockers).toEqual([]);
    for (const section of PROSE_SECTIONS) {
      expect(reconfirmed.sections[section]!.provenance.status).toBe("confirmed");
    }
  });

  it("a valuation that never had prose survives the copy untouched", () => {
    const signed = signValuation(approvedValuation, new Date());
    expect(newVersionOf(signed).inputs!.prose).toBeUndefined();
  });
});

describe("AUDIT_ACTIONS (FR-12)", () => {
  it("is the closed action list", () => {
    expect(AUDIT_ACTIONS).toEqual([
      "created",
      "subject_updated",
      "sample_updated",
      "features_updated",
      "calculation_confirmed",
      "sample_confirmed",
      "subject_confirmed",
      "kw_confirmed",
      "features_confirmed",
      "inspection_updated",
      "prose_generated",
      "prose_confirmed",
      "approved",
      "signed",
      "version_created",
    ]);
  });
});
