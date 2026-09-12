import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import { buildDocumentModel, type BuildDocumentInput } from "../src/domain/document-model";
import { operatSections } from "../src/domain/operat-sections";
import { renderOperatDocx } from "../src/adapters/docx-render";
import type { SubjectSnapshot } from "../src/domain/subject-snapshot";
import type { KwSnapshot } from "../src/domain/kw-snapshot";
import {
  goldenInputs,
  syntheticDocumentInput,
  SUBJECT_WITH_MPZP,
  SUBJECT_NO_MPZP,
  KW_STANDARD,
  KW_DEWELOPERSKI,
  KW_AKT_NO_DZIAL,
  KW_AKT_NULL_UDZIAL,
} from "./fixtures/document-model-fixture";

/**
 * F-12 (completeness leg): render the REAL production template with
 * synthetic golden data and assert ≥19 sections, no unresolved tags, no
 * "undefined", the amount-in-words present, and — anti-literal — nothing
 * from the source Kościelna operat leaks into someone else's document.
 * Pure JS render, no network, no LibreOffice needed here.
 *
 * Golden inputs + KW/subject fixtures live in ./fixtures/document-model-fixture
 * (shared with tests/docx-render-signature.test.ts, Slice 8/F-7).
 */
function renderGolden(subject?: SubjectSnapshot, kw?: KwSnapshot): string {
  const model = buildDocumentModel(syntheticDocumentInput(subject, kw));
  const docx = renderOperatDocx(model);
  const zip = new PizZip(docx);
  return zip.files["word/document.xml"]
    .asText()
    .replace(/<[^>]+>/g, "")
    .replace(/\u00A0/g, " "); // NBSP -> regular space (escape sequence, not a pasted literal)
}

/**
 * Golden features with `definitions` stripped (Task 9): every feature still
 * has weight/rating, so cechy/opis_* keep rendering, but skala_ocen ends up
 * empty (buildDocumentModel drops rows with zero non-empty levels) — the
 * scenario the §12.1 `{#ma_skale}` honest-silence wrap exists for.
 */
function goldenInputsNoDefinitions(subject?: SubjectSnapshot, kw?: KwSnapshot): KcsInput {
  return {
    ...goldenInputs(subject, kw),
    features: [
      {
        name: "standard wykończenia",
        weight: 0.4,
        rating: "przecietna" as const,
        key: "standard-wykonczenia",
      },
      {
        name: "położenie na piętrze",
        weight: 0.3,
        rating: "lepsza" as const,
        key: "polozenie-na-pietrze",
      },
      { name: "lokalizacja", weight: 0.3, rating: "gorsza" as const, key: "lokalizacja" },
    ],
  };
}

function renderGoldenNoDefinitions(subject?: SubjectSnapshot, kw?: KwSnapshot): string {
  const inputs = goldenInputsNoDefinitions(subject, kw);
  const model = buildDocumentModel({
    address: "ul. Przykładowa 5, Poznań",
    area: 48.2,
    purpose: "informacyjny",
    kwNumber: "KW-TEST-9",
    propertyRight: "wlasnosc_lokalu" as const,
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
    .replace(/\u00A0/g, " ");
}

describe("F-12: rendered operat completeness (real template, golden data)", () => {
  const text = renderGolden(SUBJECT_WITH_MPZP);

  it("contains every canonical section heading (≥19)", () => {
    const headings = operatSections(buildDocumentModel(syntheticDocumentInput(SUBJECT_WITH_MPZP)));
    expect(headings.length).toBeGreaterThanOrEqual(19);
    for (const heading of headings) {
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

  it("tells the truth about THIS valuation's feature bag in the §12/§13 intro (Task 9)", () => {
    expect(text).toContain("to: standard wykończenia, położenie na piętrze oraz lokalizacja.");
    expect(text).toContain(
      "czyli kolejno: standard wykończenia, położenie na piętrze oraz lokalizacja.",
    );
    expect(text).toContain("za pomocą 3 atrybutów");
    expect(text).not.toContain("za pomocą 5 atrybutów");
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
      propertyRight: "wlasnosc_lokalu" as const,
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
      propertyRight: "wlasnosc_lokalu" as const,
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
      propertyRight: "wlasnosc_lokalu" as const,
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
      propertyRight: "wlasnosc_lokalu" as const,
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

describe("F-12: rendered operat — empty rating scale (honest silence, Task 9)", () => {
  // Every active feature still carries weight/rating, but none carries a
  // `definitions` entry — buildDocumentModel.ma_skale is false, so the
  // {#ma_skale}…{/ma_skale} wrap must hide the §12.1 scale intro sentence,
  // table and "Źródło" caption WITHOUT touching the surrounding weights prose.
  const text = renderGoldenNoDefinitions(SUBJECT_WITH_MPZP);

  it("has no unresolved template tags and no 'undefined'", () => {
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/\{[a-z_#/.]+\}/i);
  });

  it("hides only the rating-scale block, keeps the weights-methodology sentence", () => {
    expect(text).not.toContain("Poniżej przedstawiono wyniki badania cech istotnych");
    expect(text).toContain("Wagi cech rynkowych przyjęto na podstawie analizy rynku lokalnego");
  });
});

describe("F-12: the house number never reaches the document (Slice 3d)", () => {
  /** One RCN comparable that HAS a number — so the assertion below can actually fail. */
  function renderWithStreet(): string {
    const input = syntheticDocumentInput();
    input.inputs.comparables = [
      {
        date: "2026-05-10",
        area: 50,
        pricePerM2: 12000,
        source: "rcn",
        transactionId: "T1",
        lokalId: "306401_1.0021.AR_10.27.2_BUD.5_LOK",
        status: "confirmed",
      },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [
        {
          transactionId: "T1",
          date: "2026-05-10",
          area: 50,
          pricePerM2: 12000,
          priceTotal: 600000,
          egib: {
            teryt: "306401_1",
            obreb: "0021",
            arkusz: "10",
            dzialka: "27",
            budynek: "2",
            lokal: "5",
          },
          lokalId: "306401_1.0021.AR_10.27.2_BUD.5_LOK",
          distanceM: 123,
          floor: 3,
          rooms: 2,
          market: "wtorny",
          share: "1/1",
          transType: "wolnyRynek",
          function: "mieszkalna",
          seller: null,
          pos: null,
          street: "ul. Kościelna",
          streetNumber: "33A",
          city: "Poznań",
        },
      ],
      alternates: [],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 500,
      radiusWalk: [],
      counts: { pool: 1, inRadius: 1, afterHygiene: 1, afterBand: 1, proposed: 1 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const docx = renderOperatDocx(buildDocumentModel(input));
    return new PizZip(docx).files["word/document.xml"].asText().replace(/<[^>]+>/g, "");
  }

  it("prints the street WITH its prefix and the city, and NOT the house number", () => {
    // The street identifies the area, the number would identify the flat, and
    // `TransactionRow` has no field for it at all — this test proves the wiring keeps it
    // that way end to end. The prefix stays: measured 2026-08-23 on four reference
    // operats, every one of them prints `ul. …` in full.
    const text = renderWithStreet();
    expect(text).toContain("ul. Kościelna");
    expect(text).toContain("Poznań");
    expect(text).not.toContain("33A");
  });
});

/**
 * T-12 (S4): the operat composed per property right. Five renders of the same
 * synthetic valuation — własność, własność with a STALE basement checkbox, coop
 * without a KW number (with and without a basement), coop with a KW number —
 * and a text guard in both directions (the obręb-guard pattern from Slice 5).
 */
function renderRight(
  overrides: Partial<BuildDocumentInput>,
  inputOverrides: Partial<KcsInput> = {},
) {
  const base = syntheticDocumentInput(SUBJECT_WITH_MPZP);
  const inputs = { ...base.inputs, ...inputOverrides };
  const model = buildDocumentModel({ ...base, ...overrides, inputs, kcs: computeKcs(inputs) });
  const xml = new PizZip(renderOperatDocx(model)).files["word/document.xml"].asText();
  const text = xml.replace(/<[^>]+>/g, "").replace(/ /g, " ");
  const paragraphs = (xml.match(/<w:p[ >]/g) ?? []).length;
  return { model, text, paragraphs, count: (s: string) => text.split(s).length - 1 };
}

const COOP = { propertyRight: "spoldzielcze_wlasnosciowe" as const, kwNumber: null };
const NO_KW_SENTENCE =
  "Dla spółdzielczego własnościowego prawa do lokalu mieszkalnego nie założono księgi wieczystej.";
const BASEMENT_CLAUSE =
  "Właściciele spółdzielczego własnościowego prawa mają możliwość korzystania z piwnicy, nie jest ona jednak objęta w/w prawem i nie stanowi prawa majątkowego.";

describe("F-12 / T-12: operat per property right", () => {
  const own = renderRight({});
  const ownStaleBasement = renderRight({}, { hasBasement: true });
  const coop = renderRight(COOP);
  const coopBasement = renderRight(COOP, { hasBasement: true });
  const coopWithKw = renderRight({ ...COOP, kwNumber: "KW-TEST-9" });

  it.each([
    ["własność", own],
    ["własność + stale hasBasement", ownStaleBasement],
    ["spółdzielcze bez KW", coop],
    ["spółdzielcze bez KW + piwnica", coopBasement],
    ["spółdzielcze z KW", coopWithKw],
  ])("%s: no unresolved tags, no 'undefined', every heading of ITS OWN section list", (_, r) => {
    expect(r.text).not.toContain("undefined");
    expect(r.text).not.toMatch(/\{[a-z_#/.^]+\}/i);
    const headings = operatSections(r.model);
    expect(headings.length).toBeGreaterThanOrEqual(19);
    for (const heading of headings) {
      expect(r.text, `missing section "${heading}"`).toContain(heading);
    }
  });

  it("własność: reads exactly as before S4 (headings, act, sources, owner row, udział) and never says spółdzielcz", () => {
    for (const s of [
      "6. Daty istotne dla określenia wartości nieruchomości",
      "7. Źródła danych o nieruchomości",
      "8. Opis stanu nieruchomości",
      "12. Określenie wartości rynkowej prawa własności nieruchomości lokalowej, wg stanu",
      "Ustawa z dnia 24 czerwca 1994r. o własności lokali (Dz. U. 2026r., poz. 39),",
      "Badanie ksiąg wieczystych – nieruchomości lokalowej o funkcji mieszkalnej oraz nieruchomości gruntowej,",
      "Wypis aktu notarialnego – umowa ustanowienia odrębnej własności lokalu i sprzedaży,",
      "GEOPOZ w Poznaniu",
      "Własność",
      "p. Anna Przykładowa",
      "wraz z udziałem w nieruchomości wspólnej",
      "Dla nieruchomości gruntowej właściwy sąd rejonowy prowadzi odrębną księgę wieczystą.",
      "Oznaczenie księgi wieczystej: KW-TEST-9.",
      "Udział w nieruchomości wspólnej:",
    ]) {
      expect(own.text, `własność lost "${s}"`).toContain(s);
    }
    expect(own.text).not.toContain("spółdzielcz");
    expect(own.text).not.toContain("nie założono księgi wieczystej");
    expect(own.text).not.toContain("przedmiotu wyceny, wg stanu");
  });

  it("własność + hasBasement: true (stale checkbox) → not a single 'piwnic'", () => {
    expect(ownStaleBasement.text).not.toMatch(/piwnic/i);
    expect(ownStaleBasement.model.ma_piwnice).toBe(false);
    expect(ownStaleBasement.text).toBe(own.text);
  });

  it("spółdzielcze: the six places of the mockup + the four mechanisms", () => {
    for (const s of [
      // 1. §2 przedmiot (+ §1, §3, title page)
      "Przedmiot wyceny stanowi spółdzielcze własnościowe prawo do lokalu mieszkalnego o powierzchni użytkowej 48,20 m2, położonego pod adresem:",
      "Celem wyceny jest określenie wartości rynkowej spółdzielczego własnościowego prawa do lokalu mieszkalnego, wg stanu aktualnego",
      "Wyciąg z operatu szacunkowego dotyczącego określenia wartości rynkowej spółdzielczego własnościowego prawa do lokalu mieszkalnego, położonego pod adresem:",
      // 2. §5 podstawy prawne — placeholder publikator, never a guessed one
      "Ustawa z dnia 15 grudnia 2000 r. o spółdzielniach mieszkaniowych (Dz. U. — publikator do uzupełnienia),",
      // 3. §7 źródła — the cooperative instead of GEOPOZ
      "oraz pozyskane ze spółdzielni mieszkaniowej,",
      // 4. §8.2 — no KW extract, the one sentence instead; EGiB facts STAY
      "Dane ewidencyjne (EGiB): obręb Jeżyce, arkusz",
      // 6. §12 heading (+ TOC entry) and Tabela 4
      "12. Określenie wartości rynkowej spółdzielczego własnościowego prawa do lokalu mieszkalnego, wg stanu",
      "Tabela 4. Określenie wartości rynkowej spółdzielczego własnościowego prawa do lokalu mieszkalnego",
      "Wartość rynkowa spółdzielczego własnościowego prawa do lokalu mieszkalnego [zł]",
      // mechanism 2: carrier word
      "6. Daty istotne dla określenia wartości rynkowej",
      "7. Źródła danych o przedmiocie wyceny",
      "8. Opis stanu przedmiotu wyceny",
      "Opis lokalu mieszkalnego",
    ]) {
      expect(coop.text, `spółdzielcze lacks "${s}"`).toContain(s);
    }
    // §12 heading appears in the TOC and as the heading itself
    expect(
      coop.count("12. Określenie wartości rynkowej spółdzielczego własnościowego prawa do lokalu"),
    ).toBe(2);
  });

  it("spółdzielcze: text guard — no ownership wording, no udział, no KW/deed sources, no owner row", () => {
    for (const s of [
      // any form — §10.1 "przedmiotem prawa własności" and §12.1 slipped past the
      // 30-slot diff; Piastowskie has neither
      "prawa własności",
      "prawo własności",
      "wraz z udziałem w nieruchomości wspólnej",
      "Udział w nieruchomości wspólnej",
      "o własności lokali",
      "Badanie ksiąg wieczystych",
      "Wypis aktu notarialnego",
      "GEOPOZ",
      "Dla nieruchomości gruntowej",
      "Własność",
      "Położenie nieruchomości",
      "Opis nieruchomości",
      "Określona wartość rynkowa nieruchomości",
      "oględzin nieruchomości:",
    ]) {
      expect(coop.text, `spółdzielcze still says "${s}"`).not.toContain(s);
    }
    expect(coop.text).not.toMatch(/\d+\/\d+ cz\./);
    // the client still appears in §4 (zlecenie) — only the Wyciąg owner row is gone
    expect(coop.text).toContain("zlecenia złożonego przez p. Anna Przykładowa");
  });

  it("spółdzielcze bez KW: the no-KW sentence ×3 (§1, §2, §8.2) and no KW number anywhere", () => {
    expect(coop.count(NO_KW_SENTENCE)).toBe(3);
    expect(coop.text).not.toContain("Oznaczenie księgi wieczystej");
    expect(coop.text).not.toContain("prowadzi księgę wieczystą nr");
    expect(coop.text).not.toContain("V Wydział Ksiąg Wieczystych");
    expect(coop.model.kw_brak).toBe(true);
    expect(coop.model.ma_kw).toBe(false);
  });

  it("spółdzielcze z KW: prints the number like własność, never the no-KW sentence, still no land KW / udział", () => {
    expect(coopWithKw.count(NO_KW_SENTENCE)).toBe(0);
    expect(coopWithKw.text).toContain("Oznaczenie księgi wieczystej: KW-TEST-9.");
    expect(coopWithKw.text).toContain(
      "Dla lokalu mieszkalnego Sąd Rejonowy Poznań – Stare Miasto w Poznaniu prowadzi księgę wieczystą nr KW-TEST-9.",
    );
    expect(coopWithKw.text).not.toContain("Dla nieruchomości gruntowej");
    expect(coopWithKw.text).not.toContain("udział");
    expect(coopWithKw.model.kw_brak).toBe(false);
    expect(coopWithKw.model.ma_kw).toBe(true);
  });

  it("basement clause: ×2 (§1 Wyciąg + §8.3) only with the checkbox — otherwise honest silence, no empty paragraph", () => {
    expect(coop.text).not.toMatch(/piwnic/i);
    expect(coopBasement.count(BASEMENT_CLAUSE)).toBe(2);
    // exactly the two clause paragraphs — the fence paragraphs vanish with them
    expect(coopBasement.paragraphs - coop.paragraphs).toBe(2);
    expect(coop.paragraphs).toBeLessThan(own.paragraphs); // fenced blocks leave no shells
  });

  it("model pairs are mutually exclusive and the texts come from PROPERTY_RIGHT_DOC", () => {
    for (const r of [own, coop, coopWithKw]) {
      expect(r.model.prawo_wlasnosc).toBe(!r.model.prawo_spoldzielcze);
      expect(r.model.ma_kw).toBe(!r.model.kw_brak);
    }
    expect(own.model.przedmiot_d).toBe("prawa własności nieruchomości lokalowej");
    expect(coop.model.przedmiot_m).toBe("spółdzielcze własnościowe prawo do lokalu mieszkalnego");
    expect(coop.model.klauzula_brak_kw).toBe(NO_KW_SENTENCE);
    expect(coopWithKw.model.klauzula_brak_kw).toBe("");
    expect(coopBasement.model.klauzula_piwnicy).toBe(BASEMENT_CLAUSE);
  });
});
