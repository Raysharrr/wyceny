import { describe, expect, it } from "vitest";
import { EMPTY_SUBJECT, proposalToSubjectValues } from "../src/lib/subject-form";

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
  },
};

describe("proposalToSubjectValues", () => {
  it("flattens parcel, building and mpzp", () => {
    const v = proposalToSubjectValues(proposal);
    expect(v.obreb).toBe("Jeżyce");
    expect(v.powEwidHa).toBe(0.0772);
    expect(v.kondygnacjeNadziemne).toBe(6);
    expect(v.mpzpSymbol).toBe("4MW/U");
    expect(v.mpzpAbsent).toBe(false);
    expect(v.rokBudowy).toBeUndefined(); // never auto-filled — not publicly available
  });

  it("null building leaves building fields empty", () => {
    const v = proposalToSubjectValues({ ...proposal, building: null });
    expect(v.budynekRodzaj).toBe("");
    expect(v.kondygnacjeNadziemne).toBeUndefined();
  });

  it("null mpzp sets mpzpAbsent true and empty plan fields", () => {
    const v = proposalToSubjectValues({
      ...proposal,
      mpzp: null,
      meta: { ...proposal.meta, mpzpAbsent: true },
    });
    expect(v.mpzpAbsent).toBe(true);
    expect(v.mpzpSymbol).toBe("");
  });

  it("EMPTY_SUBJECT has no numeric zeros (coerce trap)", () => {
    expect(EMPTY_SUBJECT.powEwidHa).toBeUndefined();
    expect(EMPTY_SUBJECT.rokBudowy).toBeUndefined();
    expect(EMPTY_SUBJECT.obreb).toBe("");
  });
});
