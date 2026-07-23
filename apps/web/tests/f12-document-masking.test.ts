import { describe, expect, it } from "vitest";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import {
  buildDocumentModel,
  documentFieldBlockers,
  formatNumber,
  formatPln,
} from "../src/domain/document-model";
import type { KwSnapshot } from "../src/domain/kw-snapshot";

const NBSP = "\u00A0"; // non-breaking space (escape — a pasted literal is invisible to review)

/** Synthetic inputs with FULL transaction dates and RCN ids — masking must strip both. */
function syntheticInputs(): KcsInput {
  return {
    area: 54.3,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 12_000 + i * 100,
      date: `2025-03-1${i % 10}`, // full date — must never reach the model
      area: 50 + i,
      source: "rcn" as const,
      transactionId: `rcn-tx-${i}`, // must never reach the model
      status: "confirmed" as const,
    })),
    features: [
      { name: "standard wykończenia", weight: 0.6, rating: "lepsza" as const },
      { name: "lokalizacja", weight: 0.4, rating: "gorsza" as const },
    ],
    sampleMeta: null,
    provenance: null,
  };
}

function goldenInput() {
  const inputs = syntheticInputs();
  return {
    address: "ul. Testowa 7, Poznań",
    area: 54.3,
    purpose: "sprzedaz" as const,
    kwNumber: "KW-TEST-1",
    client: "p. Test Testowy",
    inspectionDate: "2026-07-01",
    approvedAt: new Date("2026-07-15T10:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "sto tysięcy złotych zero groszy",
  };
}

function buildModel() {
  return buildDocumentModel(goldenInput());
}

describe("F-12: professional-secrecy masking in the document model", () => {
  it("shows only YYYY-MM for comparable transaction dates", () => {
    const model = buildModel();
    for (const row of model.transakcje) {
      expect(row.data_msc).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("never leaks full dates, transactionIds or provenance internals anywhere in the model", () => {
    const json = JSON.stringify(buildModel());
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no full ISO date survives
    expect(json).not.toContain("rcn-tx-");
    expect(json).not.toContain("transactionId");
    expect(json).not.toContain("to_verify");
  });

  it("maps purpose to Polish document text and drives the credit conditional", () => {
    const model = buildModel();
    expect(model.cel).toBe("dla potrzeb sprzedaży");
    expect(model.kredyt).toBe(false);
    const inputs = syntheticInputs();
    const credit = buildDocumentModel({
      address: "x",
      area: 1,
      purpose: "zabezpieczenie_kredytu",
      kwNumber: "KW-TEST-1",
      client: "k",
      inspectionDate: "2026-07-01",
      approvedAt: new Date("2026-07-15T10:00:00Z"),
      inputs,
      kcs: computeKcs(inputs),
      amountInWords: "słownie",
    });
    expect(credit.kredyt).toBe(true);
  });

  it("formats dates as DD.MM.YYYY and amounts with NBSP grouping + comma decimals", () => {
    const model = buildModel();
    expect(model.data_ogledzin).toBe("01.07.2026");
    expect(model.data_sporzadzenia).toBe("15.07.2026");
    expect(formatPln(1044400)).toBe(`1${NBSP}044${NBSP}400,00`);
    expect(formatNumber(0.92, 3)).toBe("0,920");
    expect(formatNumber(12061.94, 2)).toBe(`12${NBSP}061,94`);
  });

  it("builds one cechy row per feature with Ui range values", () => {
    const model = buildModel();
    expect(model.cechy).toHaveLength(2);
    const [standard] = model.cechy;
    expect(standard.nazwa).toBe("standard wykończenia");
    expect(standard.waga_pct).toBe("60");
    // ui_sr is the bare weight, 3dp
    expect(standard.ui_sr).toBe("0,600");
  });

  it("builds 12.2 description bullets from ratings", () => {
    const model = buildModel();
    expect(model.opis_przedmiot).toEqual([
      "standard wykończenia – wartość najwyższa cechy,",
      "lokalizacja – wartość najniższa cechy,",
    ]);
    expect(model.opis_cmin).toHaveLength(2);
    expect(model.opis_cmin[0]).toContain("wartość najniższa");
    expect(model.opis_cmax[0]).toContain("wartość najwyższa");
  });
});

describe("F-12: KW examination masking (Slice 6, defense-in-depth)", () => {
  // The worker's scrub_extract (layer 2) already replaces PESEL/person-context
  // fragments with the "[dane osobowe usunięte]" marker before a KwSnapshot
  // ever reaches the web app — this fixture is post-scrub, as a real snapshot
  // would arrive. The model must not reintroduce an 11-digit run anywhere
  // (e.g. via sad/wydzial/udział passthrough) even given this input shape.
  function kwFixtureWithScrubMarker(): KwSnapshot {
    return {
      source: "odpis_kw",
      kwLokalu: "PO1P/1/6",
      kwGruntu: "PO1P/2/4",
      kwInne: [],
      deweloperski: false,
      powUzytkowaKw: 50.55,
      udzial: "1/1",
      sad: "Sąd Rejonowy Poznań-Stare Miasto",
      wydzial: "V Wydział Ksiąg Wieczystych",
      dataDokumentu: "2026-06-01",
      dzial3: {
        wpisy: true,
        tresc: ["roszczenie, [dane osobowe usunięte], o wpis"],
      },
      dzial4: { wpisy: false, tresc: [] },
    };
  }

  it("never leaks an 11-digit (PESEL-shaped) run anywhere in the serialized model", () => {
    const inputs = { ...syntheticInputs(), kw: kwFixtureWithScrubMarker() };
    const model = buildDocumentModel({ ...goldenInput(), inputs, kcs: computeKcs(inputs) });
    const json = JSON.stringify(model);
    expect(json).not.toMatch(/\d{11}/);
    expect(json).toContain("[dane osobowe usunięte]");
  });
});

describe("F-12: subject snapshot mapped into document facts + mpzp variants", () => {
  it("maps subject snapshot into document fields", () => {
    const model = buildDocumentModel({
      ...goldenInput(),
      inputs: {
        ...syntheticInputs(),
        subject: {
          obreb: "Jeżyce",
          arkusz: "10",
          nrDzialki: "161",
          powEwidHa: 0.0772,
          uzytek: "B",
          budynekRodzaj: "budynki mieszkalne",
          kondygnacjeNadziemne: 6,
          kondygnacjePodziemne: 1,
          mpzpAbsent: false,
          mpzpSymbol: "1MW/U",
          mpzpNazwa: "Plan Testowy",
          mpzpUchwala: "I/1/2020",
          mpzpData: "2020-01-01",
          mpzpPubl: "Rocznik 2020, poz. 1",
        },
      },
    });
    expect(model.obreb).toBe("Jeżyce");
    expect(model.pow_dzialki).toBe("0,0772");
    expect(model.kondygnacje).toBe("6 / 1");
    expect(model.rok_budowy).toBe("b.d. (brak w publicznej ewidencji)");
    expect(model.mpzp).toEqual({
      symbol: "1MW/U",
      nazwa: "Plan Testowy",
      uchwala: "I/1/2020",
      data: "01.01.2020",
      publ: "Rocznik 2020, poz. 1",
    });
    expect(model.mpzp_brak).toBe(false);
  });

  it("mpzp absent renders brak variant fields", () => {
    const model = buildDocumentModel({
      ...goldenInput(),
      inputs: {
        ...syntheticInputs(),
        subject: {
          obreb: "Łazarz",
          mpzpAbsent: true,
          przeznaczenieStudium: "zabudowa mieszkaniowa (studium)",
        },
      },
    });
    expect(model.mpzp).toBeNull();
    expect(model.mpzp_brak).toBe(true);
    expect(model.przeznaczenie_studium).toBe("zabudowa mieszkaniowa (studium)");
  });

  it("legacy inputs without subject render dashes and neither mpzp variant", () => {
    const model = buildDocumentModel(goldenInput());
    expect(model.obreb).toBe("—");
    expect(model.mpzp).toBeNull();
    expect(model.mpzp_brak).toBe(false);
  });

  it("pins the 'neither' state (mpzp null, mpzp_brak false) to legacy subject-null inputs (Fix C)", () => {
    // Legacy: subject explicitly null (pre-EGiB/MPZP inputs — and, with Fix A
    // in place, what an untouched "Dane przedmiotu" section resolves to).
    const legacy = buildDocumentModel({
      ...goldenInput(),
      inputs: { ...syntheticInputs(), subject: null },
    });
    expect(legacy.mpzp).toBeNull();
    expect(legacy.mpzp_brak).toBe(false);

    // A persisted, non-empty subject with plan info resolves to the `mpzp` variant.
    const withMpzp = buildDocumentModel({
      ...goldenInput(),
      inputs: {
        ...syntheticInputs(),
        subject: { obreb: "Jeżyce", mpzpAbsent: false, mpzpSymbol: "1MW/U" },
      },
    });
    expect(withMpzp.mpzp).not.toBeNull();
    expect(withMpzp.mpzp_brak).toBe(false);

    // A persisted, non-empty subject flagged mpzpAbsent resolves to the `mpzp_brak` variant.
    const withMpzpAbsent = buildDocumentModel({
      ...goldenInput(),
      inputs: { ...syntheticInputs(), subject: { obreb: "Łazarz", mpzpAbsent: true } },
    });
    expect(withMpzpAbsent.mpzp).toBeNull();
    expect(withMpzpAbsent.mpzp_brak).toBe(true);

    // Residual edge case Fix A makes rare but doesn't eliminate at the model
    // layer: a non-empty subject (e.g. only rokBudowy) with mpzpAbsent falsy
    // and zero mpzp fields still yields neither variant — current behavior,
    // asserted as-is rather than endorsed as ideal.
    const nonEmptyNoMpzpInfo = buildDocumentModel({
      ...goldenInput(),
      inputs: { ...syntheticInputs(), subject: { rokBudowy: 1938 } },
    });
    expect(nonEmptyNoMpzpInfo.mpzp).toBeNull();
    expect(nonEmptyNoMpzpInfo.mpzp_brak).toBe(false);
  });

  it("rok budowy set renders the year", () => {
    const model = buildDocumentModel({
      ...goldenInput(),
      inputs: { ...syntheticInputs(), subject: { rokBudowy: 1938 } },
    });
    expect(model.rok_budowy).toBe("1938");
  });

  it("never leaks the subject snapshot's raw iso mpzp date, transactionId or to_verify status", () => {
    const model = buildDocumentModel({
      ...goldenInput(),
      inputs: {
        ...syntheticInputs(),
        subject: {
          obreb: "Jeżyce",
          mpzpAbsent: false,
          mpzpSymbol: "1MW/U",
          mpzpData: "2020-01-01",
        },
      },
    });
    const json = JSON.stringify(model);
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no full ISO date survives, incl. mpzp.data
    expect(json).not.toContain("rcn-tx-");
    expect(json).not.toContain("transactionId");
    expect(json).not.toContain("to_verify");
    expect(model.mpzp?.data).toBe("01.01.2020");
  });

  it("mpzpData free-text (Polish format, not schema-ISO) passes through raw rather than 'undefined.undefined.…' (Fix B)", () => {
    const model = buildDocumentModel({
      ...goldenInput(),
      inputs: {
        ...syntheticInputs(),
        subject: {
          obreb: "Jeżyce",
          mpzpAbsent: false,
          mpzpSymbol: "1MW/U",
          mpzpData: "26.02.2019",
        },
      },
    });
    expect(model.mpzp?.data).toBe("26.02.2019");
    expect(JSON.stringify(model)).not.toContain("undefined");
  });
});

describe("documentFieldBlockers", () => {
  it("returns one Polish blocker per missing field, empty when complete", () => {
    expect(
      documentFieldBlockers({
        purpose: null,
        kwNumber: null,
        client: null,
        inspectionDate: null,
        wr: 1_044_400,
      }),
    ).toHaveLength(4);
    const blockers = documentFieldBlockers({
      purpose: "sprzedaz",
      kwNumber: null,
      client: "k",
      inspectionDate: "2026-07-01",
      wr: 1_044_400,
    });
    expect(blockers).toEqual([{ path: "kwNumber", label: "Numer księgi wieczystej — brak." }]);
    expect(
      documentFieldBlockers({
        purpose: "sprzedaz",
        kwNumber: "KW-TEST-1",
        client: "k",
        inspectionDate: "2026-07-01",
        wr: 1_044_400,
      }),
    ).toEqual([]);
  });
});
