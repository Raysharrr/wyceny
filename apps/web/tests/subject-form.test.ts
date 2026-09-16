import { describe, expect, it } from "vitest";
import { EMPTY_SUBJECT, isEmptySubject, proposalToSubjectValues } from "../src/lib/subject-form";

const proposal = {
  parcel: {
    parcelId: "306401_1.0021.AR_10.161",
    obreb: "Jeżyce",
    arkusz: "10",
    nrDzialki: "161",
    powEwidHa: 0.0772,
    uzytek: "B",
  },
  building: { rodzaj: "budynki mieszkalne", kondygnacjeNadziemne: 6, kondygnacjePodziemne: 1 },
  mpzp: {
    symbol: "4MW/U",
    nazwaPlanu: "Testowo",
    uchwala: "VII/84/VIII/2019",
    dataUchwaly: "2019-02-26",
    publikator: "Rocznik 2019, poz. 2776",
  },
  meta: {
    x: 357604.98,
    y: 507623.88,
    teryt: "306401",
    fetchedAt: "2026-07-17T10:00:00Z",
    source: "geopoz-gugik",
    mpzpAbsent: false,
    buildingId: null,
  },
};

describe("proposalToSubjectValues", () => {
  it("flattens parcel, building and mpzp", () => {
    const v = proposalToSubjectValues(proposal);
    expect(v.obreb).toBe("Jeżyce");
    expect(v.powEwidHa).toBe(0.0772);
    expect(v.kondygnacjeNadziemne).toBe(6);
    expect(v.przeznaczenieSymbol).toBe("4MW/U");
    // A plan the fetch read off the city layer IS the MPZP branch — nothing
    // left for the appraiser to decide (M-10).
    expect(v.przeznaczenieRodzaj).toBe("mpzp");
    expect(v.rokBudowy).toBeUndefined(); // never auto-filled — not publicly available
  });

  it("null building leaves building fields empty", () => {
    const v = proposalToSubjectValues({ ...proposal, building: null });
    expect(v.budynekRodzaj).toBe("");
    expect(v.kondygnacjeNadziemne).toBeUndefined();
  });

  // The fetch knows the MPZP is absent, NOT what stands in its place — a plan
  // ogólny and a studium are different documents and different §9 wording. So
  // it leaves the choice open and B-02 asks (M-10).
  it("null mpzp leaves the designation unchosen and the fields empty", () => {
    const v = proposalToSubjectValues({
      ...proposal,
      mpzp: null,
      meta: { ...proposal.meta, mpzpAbsent: true },
    });
    expect(v.przeznaczenieRodzaj).toBeNull();
    expect(v.przeznaczenieSymbol).toBe("");
  });

  it("EMPTY_SUBJECT has no numeric zeros (coerce trap)", () => {
    expect(EMPTY_SUBJECT.powEwidHa).toBeUndefined();
    expect(EMPTY_SUBJECT.rokBudowy).toBeUndefined();
    expect(EMPTY_SUBJECT.obreb).toBe("");
  });
});

describe("isEmptySubject (Fix A)", () => {
  it("is empty for null/undefined", () => {
    expect(isEmptySubject(null)).toBe(true);
    expect(isEmptySubject(undefined)).toBe(true);
  });

  it("is empty for EMPTY_SUBJECT (the untouched-section shape)", () => {
    expect(isEmptySubject(EMPTY_SUBJECT)).toBe(true);
  });

  // `przeznaczenieRodzaj` defaults to null, and an untouched section must keep
  // reading as untouched — otherwise every new draft persists an empty snapshot
  // and stamps ewidencja/mpzp provenance for data nobody entered.
  it("is empty when the designation is unchosen and everything else is empty", () => {
    expect(isEmptySubject({ ...EMPTY_SUBJECT, przeznaczenieRodzaj: null })).toBe(true);
    expect(isEmptySubject({ ...EMPTY_SUBJECT, przeznaczenieRodzaj: undefined })).toBe(true);
  });

  it("is non-empty when a single string field is set", () => {
    expect(isEmptySubject({ ...EMPTY_SUBJECT, obreb: "Jeżyce" })).toBe(false);
  });

  it("is non-empty when a single numeric field is set", () => {
    expect(isEmptySubject({ ...EMPTY_SUBJECT, rokBudowy: 1938 })).toBe(false);
  });

  it("is non-empty once a designation is chosen, even with everything else empty", () => {
    expect(isEmptySubject({ ...EMPTY_SUBJECT, przeznaczenieRodzaj: "plan_ogolny" })).toBe(false);
  });
});

/**
 * FH.2 — piętro przedmiotu (ADR-016 reg. 5). Pole ręczne kroku 1: ewidencja
 * zna liczbę kondygnacji budynku, ale nie piętro lokalu.
 */
describe("subject.pietro (FH.2)", () => {
  it("nie jest wypełniane z propozycji EGiB/MPZP i startuje puste", () => {
    expect(EMPTY_SUBJECT.pietro).toBeUndefined();
    expect(proposalToSubjectValues(proposal).pietro).toBeUndefined();
  });

  it("parter (0) liczy się jako wypełniony przedmiot", () => {
    expect(isEmptySubject({ ...EMPTY_SUBJECT, pietro: 0 })).toBe(false);
  });
});
