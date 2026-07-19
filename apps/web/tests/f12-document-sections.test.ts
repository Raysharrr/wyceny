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
      {
        name: "standard wykończenia",
        weight: 0.4,
        rating: "przecietna" as const,
        key: "standard-wykonczenia",
        definitions: {
          lepsza: "wykończenie materiałami wyższej klasy",
          przecietna: "wykończenie w dobrym stanie",
        },
      },
      {
        name: "położenie na piętrze",
        weight: 0.3,
        rating: "lepsza" as const,
        key: "polozenie-na-pietrze",
        definitions: {
          lepsza: "czwarte piętro i powyżej",
          przecietna: "piętra pośrednie",
          gorsza: "parter",
        },
      },
      {
        name: "lokalizacja",
        weight: 0.3,
        rating: "gorsza" as const,
        key: "lokalizacja",
        definitions: { lepsza: "bliskość punktów usługowych" },
      },
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

/**
 * Akt notarialny — the source document never examines dział III/IV at all
 * (`dzial3`/`dzial4` are null, not "examined and empty"). Rendering "brak
 * wpisów" here would fabricate a clean-title/no-mortgage claim; the model
 * must render neither the brak sentence nor the wpisy loop for either dział.
 */
const KW_AKT_NO_DZIAL: KwSnapshot = {
  ...KW_STANDARD,
  source: "akt",
  dzial3: null,
  dzial4: null,
};

/**
 * Akt notarialny whose extract carries NO udział (`udzial: null`). Because a KW
 * WAS examined (kw != null), the document must render a dash — never the legacy
 * "wg odpisu księgi wieczystej" annotation, which is reserved for pre-Slice-6
 * rows that never examined a KW (kw == null). Fix #5a.
 */
const KW_AKT_NULL_UDZIAL: KwSnapshot = {
  ...KW_STANDARD,
  source: "akt",
  udzial: null,
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

  it("renders the §12.1 rating-scale block with this valuation's definitions + honest weights prose", () => {
    // Slice 7: §12.1 prints THIS valuation's scale definitions + honest weights prose.
    expect(text).toContain("lepsza – czwarte piętro i powyżej");
    expect(text).toContain("przeciętna – piętra pośrednie");
    expect(text).toContain("Wagi cech rynkowych przyjęto na podstawie analizy rynku lokalnego");
    expect(text).not.toContain("poniżej 65 m2");
    // Anti-run-on (dzial3_wpisy lesson): an INLINE {#poziomy} loop would glue
    // consecutive levels together — the nested loop must render one paragraph
    // per level (advisor finding #2).
    expect(text).not.toMatch(/powyżejprzeciętna|pośredniegorsza/);
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

  it("still renders the odpis stub sentence (kw_stub_odpis true for legacy/manual)", () => {
    // Legacy inputs never examined a KW/deed (kw == null); the {nr_kw} line keeps
    // its second sentence exactly as before — this is the byte-identical guarantee.
    expect(text).toContain(
      "Pełna treść odpisu KW pozostaje w dokumentacji źródłowej rzeczoznawcy.",
    );
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

  it("keeps the odpis stub sentence (source odpis_kw — the KW excerpt is accurate)", () => {
    expect(text).toContain(
      "Pełna treść odpisu KW pozostaje w dokumentacji źródłowej rzeczoznawcy.",
    );
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

describe("F-12: rendered operat — akt notarialny with no dział III/IV info (dzial3/dzial4 null)", () => {
  const text = renderGolden(SUBJECT_WITH_MPZP, KW_AKT_NO_DZIAL);

  it("has no unresolved template tags and no 'undefined'", () => {
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  it("renders NEITHER the brak sentence NOR the wpisy loop for either dział (honest silence, not a fabricated clean-title claim)", () => {
    expect(text).not.toContain("Dział III (prawa, roszczenia i ograniczenia): brak wpisów.");
    expect(text).not.toContain("Dział III — wpis:");
    expect(text).not.toContain("Dział IV (hipoteki): brak wpisów.");
    expect(text).not.toContain("Dział IV — wpis:");
  });

  it("hides the odpis stub sentence (source akt — the operat must not imply a KW excerpt it may not hold)", () => {
    // Fix #5b: the {nr_kw} line's "Pełna treść odpisu KW…" sentence would render
    // directly above the badanie block's "…na podstawie: akt notarialny…", falsely
    // implying possession of a KW excerpt. Under a deed source it must disappear.
    expect(text).not.toContain("Pełna treść odpisu KW");
    // The {nr_kw} line itself (its stable prefix) still renders.
    expect(text).toContain("Oznaczenie księgi wieczystej:");
  });

  it("model: dzialN_brak and dzialN_wpisy both false/empty when the dział was never examined", () => {
    const inputs = goldenInputs(SUBJECT_WITH_MPZP, KW_AKT_NO_DZIAL);
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
    expect(model.dzial3_brak).toBe(false);
    expect(model.dzial3_wpisy).toEqual([]);
    expect(model.dzial4_brak).toBe(false);
    expect(model.dzial4_wpisy).toEqual([]);
  });
});

describe("F-12: rendered operat — KW examined but udział absent (akt, udzial null)", () => {
  const text = renderGolden(SUBJECT_WITH_MPZP, KW_AKT_NULL_UDZIAL);

  it("has no unresolved template tags and no 'undefined'", () => {
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  it("renders a dash for udział, NOT the legacy odpis annotation (Fix #5a)", () => {
    expect(text).toContain("Udział w nieruchomości wspólnej: —.");
    expect(text).not.toContain("Udział w nieruchomości wspólnej: wg odpisu księgi wieczystej.");
  });

  it("model: udzial_kw is a dash when a KW was examined but carries no udział", () => {
    const inputs = goldenInputs(SUBJECT_WITH_MPZP, KW_AKT_NULL_UDZIAL);
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
    expect(model.udzial_kw).toBe("—");
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
