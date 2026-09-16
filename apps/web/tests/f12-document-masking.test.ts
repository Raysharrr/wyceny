import { describe, expect, it } from "vitest";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import {
  buildDocumentModel,
  documentFieldBlockers,
  formatNumber,
  formatPln,
  OCENA_SPOZA_REJESTRU,
  PURPOSE_TEXT,
} from "../src/domain/document-model";
import type { KwSnapshot } from "../src/domain/kw-snapshot";
import { AUTOR_TESTOWY } from "./fixtures/document-model-fixture";

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
    // Trzy opisane poziomy w każdej cesze (ADR-016 reg. 1) — bez opisów ocena nie
    // ma pozycji w skali, a od FH.3 to z pozycji bierze się opis słowny (D-54).
    features: [
      {
        name: "standard wykończenia",
        weight: 0.6,
        rating: "lepsza" as const,
        definitions: {
          lepsza: "opis lepszej",
          przecietna: "opis przeciętnej",
          gorsza: "opis gorszej",
        },
      },
      {
        name: "lokalizacja",
        weight: 0.4,
        rating: "gorsza" as const,
        definitions: {
          lepsza: "opis lepszej",
          przecietna: "opis przeciętnej",
          gorsza: "opis gorszej",
        },
      },
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
    propertyRight: "wlasnosc_lokalu" as const,
    client: "p. Test Testowy",
    inspectionDate: "2026-07-01",
    approvedAt: new Date("2026-07-15T10:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "sto tysięcy złotych zero groszy",
    author: AUTOR_TESTOWY,
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
    expect(model.cel).toBe("sprzedaży");
    // The template already writes "dla potrzeb {cel}." in §3 AND in the Wyciąg
    // row, so a phrase carrying the preposition here printed "dla potrzeb dla
    // potrzeb …" in every operat issued so far. Asserted over every purpose, so
    // a new one cannot reintroduce it.
    for (const text of Object.values(PURPOSE_TEXT)) expect(text).not.toContain("dla potrzeb");
    expect(model.kredyt).toBe(false);
    const inputs = syntheticInputs();
    const credit = buildDocumentModel({
      address: "x",
      area: 1,
      purpose: "zabezpieczenie_kredytu",
      kwNumber: "KW-TEST-1",
      propertyRight: "wlasnosc_lokalu" as const,
      client: "k",
      inspectionDate: "2026-07-01",
      approvedAt: new Date("2026-07-15T10:00:00Z"),
      inputs,
      kcs: computeKcs(inputs),
      amountInWords: "słownie",
      author: AUTOR_TESTOWY,
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
    expect(model.lokale_cmin[0].cechy).toHaveLength(2);
    // FH.3 (D-52): żadna z tych cech nie ma progów liczbowych, a rejestr nie
    // niesie standardu ani lokalizacji — operat mówi to wprost, zamiast
    // przypisywać lokalowi Cmin same wartości najniższe.
    expect(model.lokale_cmin[0].cechy[0].opis).toContain(OCENA_SPOZA_REJESTRU);
    expect(model.lokale_cmax[0].cechy[0].opis).toContain(OCENA_SPOZA_REJESTRU);
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

  /**
   * SCOPE, narrowed by b1-kw-read. This guards the FIELD-READ path, whose
   * snapshot arrives post-`scrub_extract` and must not have an 11-digit run
   * reintroduced by a passthrough (sąd, wydział, udział, dział III/IV text).
   *
   * It is no longer true of every model, and saying so would be a false
   * assurance. `inputs.kw.tresc` — the full transcription of the five dzialy —
   * carries persons and PESELs ON PURPOSE: ADR-018 reg. 7 (decyzja usera 15.09)
   * has §8.2 print the dzialy as the office's own operat does. That exception is
   * pinned in the opposite direction by "carries persons' data from the
   * transcription on purpose" in `tests/document-model-kw.test.ts`, so
   * tightening F-12 back over `tresc` has to face the decision instead of
   * quietly undoing it. The fixture below therefore has no `tresc`.
   */
  it("never leaks an 11-digit (PESEL-shaped) run from the FIELD READ into the model", () => {
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
          przeznaczenieRodzaj: "mpzp",
          przeznaczenieSymbol: "1MW/U – tereny zabudowy mieszkaniowej wielorodzinnej",
          przeznaczenieNazwa: "Plan Testowy",
          przeznaczenieUchwala: "Nr I/1/2020 Rady Miasta Poznania",
          przeznaczenieData: "2020-01-01",
        },
      },
    });
    expect(model.obreb).toBe("Jeżyce");
    expect(model.pow_dzialki).toBe("0,0772");
    expect(model.kondygnacje).toBe("6 / 1");
    expect(model.rok_budowy).toBe("b.d. (brak w publicznej ewidencji)");
    expect(model.prz_mpzp).toBe(true);
    expect(model.prz_plan_ogolny).toBe(false);
    expect(model.prz_studium).toBe(false);
    expect(model.prz_brak_mpzp).toBe(false);
    expect(model.ma_przeznaczenie).toBe(true);
    expect(model.prz_nazwa).toBe("Plan Testowy");
    expect(model.prz_uchwala).toBe("Nr I/1/2020 Rady Miasta Poznania");
    expect(model.prz_data).toBe("01.01.2020");
    expect(model.prz_symbol).toBe("1MW/U – tereny zabudowy mieszkaniowej wielorodzinnej");
    // No MPZP sentence in any reference operat names a publikator — only the
    // plan ogólny branch does (Folwarczna, Wojska Polskiego).
    expect(model.ma_publikator).toBe(false);
  });

  // M-10: "no MPZP" is two different documents after the 2023 reform, and the
  // operat has to name the one it actually read. The plan ogólny branch is the
  // only one that prints a status/publikator clause.
  it("plan ogólny renders the negative deciding sentence and the publikator clause", () => {
    const model = buildDocumentModel({
      ...goldenInput(),
      inputs: {
        ...syntheticInputs(),
        subject: {
          obreb: "Łazarz",
          przeznaczenieRodzaj: "plan_ogolny",
          przeznaczenieNazwa: "miasta Poznania",
          przeznaczenieUchwala: "Nr XXIX/529/IX/2025 Rady Miasta Poznania",
          przeznaczenieData: "2025-12-18",
          przeznaczenieSymbol: "742SW – strefa wielofunkcyjna",
          przeznaczeniePublikator: "obowiązujący od 14 stycznia 2026 r.",
        },
      },
    });
    expect(model.prz_plan_ogolny).toBe(true);
    expect(model.prz_mpzp).toBe(false);
    expect(model.prz_studium).toBe(false);
    expect(model.prz_brak_mpzp).toBe(true);
    expect(model.ma_przeznaczenie).toBe(true);
    expect(model.ma_publikator).toBe(true);
    expect(model.prz_publikator).toBe("obowiązujący od 14 stycznia 2026 r.");
  });

  // Uzarzewo: a gmina with no plan ogólny reads its studium, and the operat
  // quotes art. 64.2 / 65.1 to say why. `prz_studium` is what prints the quote.
  it("studium renders the negative deciding sentence without a publikator", () => {
    const model = buildDocumentModel({
      ...goldenInput(),
      inputs: {
        ...syntheticInputs(),
        subject: {
          obreb: "Uzarzewo",
          przeznaczenieRodzaj: "studium",
          przeznaczenieNazwa: "Gminy Swarzędz",
          przeznaczenieUchwala: "Nr X/51/2011 Rady Miejskiej w Swarzędzu",
          przeznaczenieData: "2011-03-29",
          przeznaczenieSymbol: "I.78.M – tereny zabudowy mieszkaniowej",
          // Set on purpose: only the plan ogólny branch may print it.
          przeznaczeniePublikator: "cokolwiek",
        },
      },
    });
    expect(model.prz_studium).toBe(true);
    expect(model.prz_brak_mpzp).toBe(true);
    expect(model.ma_przeznaczenie).toBe(true);
    expect(model.ma_publikator).toBe(false);
  });

  it("legacy inputs without subject render dashes and no designation branch", () => {
    const model = buildDocumentModel(goldenInput());
    expect(model.obreb).toBe("—");
    expect(model.prz_mpzp).toBe(false);
    expect(model.prz_plan_ogolny).toBe(false);
    expect(model.prz_studium).toBe(false);
    expect(model.prz_brak_mpzp).toBe(false);
    expect(model.ma_przeznaczenie).toBe(false);
  });

  // The source sentence is all-or-nothing: naming a plan the operat cannot
  // identify, or identifying one with no symbol read out of it, is the 14.09
  // defect. B-02 refuses to approve such a draft; the preview stays silent.
  it("a half-filled designation prints no source sentence", () => {
    const partial = buildDocumentModel({
      ...goldenInput(),
      inputs: {
        ...syntheticInputs(),
        subject: {
          obreb: "Jeżyce",
          przeznaczenieRodzaj: "mpzp",
          przeznaczenieNazwa: "Plan Testowy",
          przeznaczenieUchwala: "Nr I/1/2020 Rady Miasta Poznania",
          przeznaczenieData: "2020-01-01",
          // symbol missing — nothing was read off the map
        },
      },
    });
    expect(partial.prz_mpzp).toBe(true);
    expect(partial.ma_przeznaczenie).toBe(false);

    // Pre-M-10 draft: the subject exists, the choice was never made.
    const legacy = buildDocumentModel({
      ...goldenInput(),
      inputs: { ...syntheticInputs(), subject: { rokBudowy: 1938 } },
    });
    expect(legacy.prz_brak_mpzp).toBe(false);
    expect(legacy.ma_przeznaczenie).toBe(false);
  });

  it("rok budowy set renders the year", () => {
    const model = buildDocumentModel({
      ...goldenInput(),
      inputs: { ...syntheticInputs(), subject: { rokBudowy: 1938 } },
    });
    expect(model.rok_budowy).toBe("1938");
  });

  it("never leaks the subject snapshot's raw iso designation date, transactionId or to_verify status", () => {
    const model = buildDocumentModel({
      ...goldenInput(),
      inputs: {
        ...syntheticInputs(),
        subject: {
          obreb: "Jeżyce",
          przeznaczenieRodzaj: "mpzp",
          przeznaczenieSymbol: "1MW/U",
          przeznaczenieData: "2020-01-01",
        },
      },
    });
    const json = JSON.stringify(model);
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no full ISO date survives, incl. mpzp.data
    expect(json).not.toContain("rcn-tx-");
    expect(json).not.toContain("transactionId");
    expect(json).not.toContain("to_verify");
    expect(model.prz_data).toBe("01.01.2020");
  });

  it("przeznaczenieData free-text (Polish format, not schema-ISO) passes through raw rather than 'undefined.undefined.…' (Fix B)", () => {
    const model = buildDocumentModel({
      ...goldenInput(),
      inputs: {
        ...syntheticInputs(),
        subject: {
          obreb: "Jeżyce",
          przeznaczenieRodzaj: "mpzp",
          przeznaczenieSymbol: "1MW/U",
          przeznaczenieData: "26.02.2019",
        },
      },
    });
    expect(model.prz_data).toBe("26.02.2019");
    expect(JSON.stringify(model)).not.toContain("undefined");
  });
});

describe("documentFieldBlockers", () => {
  it("returns one Polish blocker per missing field, empty when complete", () => {
    expect(
      documentFieldBlockers({
        purpose: null,
        kwNumber: null,
        propertyRight: "wlasnosc_lokalu" as const,
        client: null,
        inspectionDate: null,
        wr: 1_044_400,
      }),
    ).toHaveLength(4);
    const blockers = documentFieldBlockers({
      purpose: "sprzedaz",
      kwNumber: null,
      propertyRight: "wlasnosc_lokalu" as const,
      client: "k",
      inspectionDate: "2026-07-01",
      wr: 1_044_400,
    });
    expect(blockers).toEqual([{ path: "kwNumber", label: "Numer księgi wieczystej — brak." }]);
    expect(
      documentFieldBlockers({
        purpose: "sprzedaz",
        kwNumber: "KW-TEST-1",
        propertyRight: "wlasnosc_lokalu" as const,
        client: "k",
        inspectionDate: "2026-07-01",
        wr: 1_044_400,
      }),
    ).toEqual([]);
  });
});
