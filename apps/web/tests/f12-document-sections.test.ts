import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import { buildDocumentModel } from "../src/domain/document-model";
import { OPERAT_SECTIONS } from "../src/domain/operat-sections";
import { renderOperatDocx } from "../src/adapters/docx-render";
import type { SubjectSnapshot } from "../src/domain/subject-snapshot";
import type { KwSnapshot } from "../src/domain/kw-snapshot";

/**
 * F-12 (completeness leg): render the REAL production template with
 * synthetic golden data and assert ≥19 sections, no unresolved tags, no
 * "undefined", the amount-in-words present, and — anti-literal — nothing
 * from the source Kościelna operat leaks into someone else's document.
 * Pure JS render, no network, no LibreOffice needed here.
 */
function goldenInputs(subject?: SubjectSnapshot, kw?: KwSnapshot): KcsInput {
  return {
    area: 48.2,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i * 50,
      date: `2025-0${(i % 9) + 1}-15`,
      area: 40 + i,
      source: "manual" as const,
      status: "confirmed" as const,
    })),
    features: [
      { name: "standard wykończenia", weight: 0.4, rating: "przecietna" as const },
      { name: "położenie na piętrze", weight: 0.3, rating: "lepsza" as const },
      { name: "lokalizacja", weight: 0.3, rating: "gorsza" as const },
    ],
    sampleMeta: null,
    provenance: null,
    subject,
    kw,
  };
}

/**
 * KW snapshot, standard variant — short synthetic KW numbers (F-9: not the
 * real 8-digit-middle shape). Two dzial3/dzial4 entries each (T9 handoff:
 * pins the multi-entry loop-shaping fix, not just the single-entry case).
 */
const KW_STANDARD: KwSnapshot = {
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
    tresc: ["Ostrzeżenie o toczącym się postępowaniu", "Wzmianka o wniosku"],
  },
  dzial4: {
    wpisy: true,
    tresc: ["Hipoteka umowna na rzecz banku X", "Hipoteka przymusowa na rzecz US"],
  },
};

/** Developer variant — no own kwLokalu, examination covers the grunt KW only. */
const KW_DEWELOPERSKI: KwSnapshot = {
  ...KW_STANDARD,
  kwLokalu: null,
  deweloperski: true,
  dzial3: { wpisy: false, tresc: [] },
  dzial4: { wpisy: false, tresc: [] },
};

/** Subject snapshot with a resolved MPZP — drives the `{#mpzp}` section-9 variant. */
const SUBJECT_WITH_MPZP: SubjectSnapshot = {
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
};

/** Subject snapshot with no MPZP — drives the `{#mpzp_brak}` section-9 variant. */
const SUBJECT_NO_MPZP: SubjectSnapshot = {
  obreb: "Łazarz",
  mpzpAbsent: true,
  przeznaczenieStudium: "zabudowa (studium)",
};

function renderGolden(subject?: SubjectSnapshot, kw?: KwSnapshot): string {
  const inputs = goldenInputs(subject, kw);
  const model = buildDocumentModel({
    address: "ul. Przykładowa 5, Poznań",
    area: 48.2,
    purpose: "informacyjny",
    kwNumber: "KW-TEST-9",
    client: "p. Anna Przykładowa",
    inspectionDate: "2026-06-30",
    approvedAt: new Date("2026-07-15T09:00:00Z"),
    inputs,
    kcs: computeKcs(inputs),
    amountInWords: "czterysta osiemdziesiąt tysięcy złotych zero groszy",
  });
  const docx = renderOperatDocx(model);
  const zip = new PizZip(docx);
  return zip.files["word/document.xml"]
    .asText()
    .replace(/<[^>]+>/g, "")
    .replace(/\u00A0/g, " "); // NBSP -> regular space (escape sequence, not a pasted literal)
}

describe("F-12: rendered operat completeness (real template, golden data)", () => {
  const text = renderGolden(SUBJECT_WITH_MPZP);

  it("contains every canonical section heading (≥19)", () => {
    expect(OPERAT_SECTIONS.length).toBeGreaterThanOrEqual(19);
    for (const heading of OPERAT_SECTIONS) {
      expect(text, `missing section "${heading}"`).toContain(heading);
    }
  });

  it("has no unresolved template tags and no 'undefined'", () => {
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  it("contains the injected amount-in-words and the masked month format", () => {
    expect(text).toContain("czterysta osiemdziesiąt tysięcy złotych");
    expect(text).toContain("2025-01");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/); // full dates never render
  });

  it("renders all 12 transaction rows", () => {
    expect(text).toContain("10 000,00");
    expect(text).toContain("10 550,00");
  });

  it("anti-literal: nothing from the source operat leaks into a synthetic operat", () => {
    for (const lit of ["Kościeln", "Rajewsk", "1 044 400", "PO1P"]) {
      expect(text, `source literal "${lit}" leaked`).not.toContain(lit);
    }
  });

  it("omits the credit clause for a non-credit purpose", () => {
    expect(text).not.toContain("kredytodawc");
  });

  it("renders the EGiB facts block and the mpzp variant when a plan exists", () => {
    expect(text).toContain("obręb Jeżyce");
    expect(text).toContain("działka nr 161");
    expect(text).toContain("symbol przeznaczenia 1MW/U");
    expect(text).toContain("uchwała nr I/1/2020");
    expect(text).not.toContain("brak obowiązującego miejscowego planu");
  });
});

describe("F-12: rendered operat — legacy, no subject fetched", () => {
  // Pre-slice valuations never fetched a subject snapshot; buildDocumentModel
  // must still render section 9's intro-only paragraph, no facts, no crash.
  const text = renderGolden();

  it("has no unresolved template tags and no 'undefined'", () => {
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  it("renders neither mpzp variant", () => {
    expect(text).not.toContain("symbol przeznaczenia");
    expect(text).not.toContain("brak obowiązującego miejscowego planu");
  });

  it("renders exactly as today for the KW examination block: no badanie content, unconditional udział dash text", () => {
    expect(text).toContain("KW-TEST-9"); // {nr_kw} line still present, unconditional
    expect(text).not.toContain("Badanie ksiąg wieczystych przeprowadzono");
    expect(text).not.toContain("Księga wieczysta lokalu:");
    expect(text).not.toContain("księgę macierzystą gruntu");
    expect(text).not.toContain("Dział III — wpis:");
    expect(text).not.toContain("Dział IV — wpis:");
    expect(text).not.toContain("Dział III (prawa, roszczenia i ograniczenia): brak wpisów.");
    expect(text).not.toContain("Dział IV (hipoteki): brak wpisów.");
    expect(text).toContain("Udział w nieruchomości wspólnej: wg odpisu księgi wieczystej.");
    expect(text).not.toContain("Powierzchnia użytkowa lokalu (wg dokumentu KW/aktu)");
  });

  it("legacy model fields: kw_badanie/pow_kw_present false, udzial_kw fallback, pow_uzytkowa_kw dash", () => {
    const inputs = goldenInputs();
    const model = buildDocumentModel({
      address: "ul. Przykładowa 5, Poznań",
      area: 48.2,
      purpose: "informacyjny",
      kwNumber: "KW-TEST-9",
      client: "p. Anna Przykładowa",
      inspectionDate: "2026-06-30",
      approvedAt: new Date("2026-07-15T09:00:00Z"),
      inputs,
      kcs: computeKcs(inputs),
      amountInWords: "czterysta osiemdziesiąt tysięcy złotych zero groszy",
    });
    expect(model.kw_badanie).toBe(false);
    expect(model.kw_standard).toBe(false);
    expect(model.kw_deweloperski).toBe(false);
    expect(model.pow_kw_present).toBe(false);
    expect(model.udzial_kw).toBe("wg odpisu księgi wieczystej");
    expect(model.pow_uzytkowa_kw).toBe("—");
    expect(model.dzial3_brak).toBe(false);
    expect(model.dzial3_wpisy).toEqual([]);
    expect(model.dzial4_brak).toBe(false);
    expect(model.dzial4_wpisy).toEqual([]);
  });
});

describe("F-12: rendered operat — KW examination block (standard variant)", () => {
  const text = renderGolden(SUBJECT_WITH_MPZP, KW_STANDARD);

  it("has no unresolved template tags and no 'undefined'", () => {
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  it("renders the standard sentence with both KW numbers, omits the developer sentence", () => {
    expect(text).toContain("Księga wieczysta lokalu: PO1P/1/6");
    expect(text).toContain("Księga wieczysta gruntu: PO1P/2/4");
    expect(text).not.toContain("księgę macierzystą gruntu");
  });

  it("renders both dział III and dział IV entries from the two-entry fixture (T9 loop-shaping)", () => {
    expect(text).toContain("Dział III — wpis: Ostrzeżenie o toczącym się postępowaniu");
    expect(text).toContain("Wzmianka o wniosku");
    expect(text).toContain("Dział IV — wpis: Hipoteka umowna na rzecz banku X");
    expect(text).toContain("Hipoteka przymusowa na rzecz US");
    // Loop-shaping fix: entries must not run together label-to-text or
    // text-to-next-label with no separator (raw docxtemplater loop output
    // would read "…postępowaniuDział III — wpis:…" / "…banku XDział IV — wpis:…").
    expect(text).not.toMatch(/postępowaniuDział/);
    expect(text).not.toMatch(/banku XDział/);
  });

  it("kw_standard/kw_deweloperski and dzialN_brak/dzialN_wpisy are mutually exclusive on the model", () => {
    const inputs = goldenInputs(SUBJECT_WITH_MPZP, KW_STANDARD);
    const model = buildDocumentModel({
      address: "ul. Przykładowa 5, Poznań",
      area: 48.2,
      purpose: "informacyjny",
      kwNumber: "KW-TEST-9",
      client: "p. Anna Przykładowa",
      inspectionDate: "2026-06-30",
      approvedAt: new Date("2026-07-15T09:00:00Z"),
      inputs,
      kcs: computeKcs(inputs),
      amountInWords: "czterysta osiemdziesiąt tysięcy złotych zero groszy",
    });
    expect(model.kw_standard).toBe(true);
    expect(model.kw_deweloperski).toBe(false);
    expect(model.dzial3_brak).toBe(false);
    expect(model.dzial3_wpisy.length).toBe(2);
    expect(model.dzial4_brak).toBe(false);
    expect(model.dzial4_wpisy.length).toBe(2);
    expect(model.pow_kw_present).toBe(true);
  });
});

describe("F-12: rendered operat — KW examination block (developer variant)", () => {
  const text = renderGolden(SUBJECT_WITH_MPZP, KW_DEWELOPERSKI);

  it("has no unresolved template tags and no 'undefined'", () => {
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  it("renders the developer sentence, omits the standard sentence", () => {
    expect(text).toContain("księgę macierzystą gruntu");
    expect(text).not.toContain("Księga wieczysta lokalu:");
  });
});

describe("F-12: rendered operat — mpzp absent variant", () => {
  const text = renderGolden(SUBJECT_NO_MPZP);

  it("has no unresolved template tags and no 'undefined'", () => {
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  it("renders the brak sentence and studium text, omitting the plan sentence", () => {
    expect(text).toContain("brak obowiązującego miejscowego planu");
    expect(text).toContain("zabudowa (studium)");
    expect(text).not.toContain("symbol przeznaczenia");
  });
});
