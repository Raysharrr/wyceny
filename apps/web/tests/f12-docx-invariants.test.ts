import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "../src/domain/document-model";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { wycena1409Anon } from "./fixtures/wycena-1409-anon";
import {
  effectiveRunFormat,
  expectNoText,
  openDocx,
  sectionText,
  type DocxDoc,
  type DocxRun,
} from "./support/docx-invariants";

/**
 * Niezmienniki paczki 1 na WYRENDEROWANYM DOCX (spec §7.3). Osobny plik od
 * `f12-template-integrity.test.ts`, który patrzy na sam szablon: te asercje
 * wymagają modelu, bo pytają o to, co dokument DRUKUJE w danym stanie wyceny,
 * a nie o to, jakie tagi szablon niesie.
 *
 * Nazwa każdego testu zaczyna się od ID niezmiennika (I-11 G … I-19), żeby
 * zgłoszenie z przeglądu dało się przełożyć na test bez szukania.
 */

const render = (wariant: Parameters<typeof wycena1409Anon>[0] = {}) =>
  openDocx(renderOperatDocx(buildDocumentModel(wycena1409Anon(wariant))));

/** Run bez własnego `rPr` w akapicie o zadanym stylu — sonda na styl bazowy. */
function bareRunIn(doc: DocxDoc, style: string | null): DocxRun {
  const paragraph = doc.paragraphs.find((p) => p.style === style && p.container === "body");
  expect(paragraph, `brak akapitu body o stylu ${String(style)}`).toBeDefined();
  return {
    text: "",
    paragraph: paragraph!.index,
    rStyle: null,
    props: { ascii: null, asciiTheme: null, szHalfPt: null },
  };
}

describe("f12 / docx-invariants: czcionka stylów bazowych (TP.0, check dryfu D-1)", () => {
  const doc = render();

  // Segoe UI 10 pt pochodziło dotąd WYŁĄCZNIE z `rPr` runów szablonu źródłowego.
  // Każdy akapit dołożony przez generator (`new_paragraph`, `_plain_para`) nie ma
  // `rPr`, więc dziedziczył krój ze stylu — Arial 11 z `Normalny` albo Times New
  // Roman 12 z `Tekstpodstawowy22`. To jest zgłoszenie M-6 rzeczoznawczyni:
  // akapity §8.2 wychodziły inną czcionką niż reszta operatu.
  it.each([
    ["Normalny (styl domyślny akapitu)", null],
    ["Tekstpodstawowy22", "Tekstpodstawowy22"],
    ["Tekstpodstawowy", "Tekstpodstawowy"],
    ["Akapitzlist", "Akapitzlist"],
  ])("akapit bez rPr w stylu %s wychodzi Segoe UI 10 pt", (_, style) => {
    expect(effectiveRunFormat(doc, bareRunIn(doc, style))).toEqual({
      font: "Segoe UI",
      sizePt: 10,
    });
  });
});

describe("I-13 G / I-19: zdania o księgach i o akcie tylko z faktów (TP.1)", () => {
  /**
   * Brak badania (`kw == null`, stan z 14.09). Operat nie ma prawa powiedzieć ani
   * że zbadano księgi, ani jaki akt jest podstawą nabycia, ani że dowód „pozostaje
   * w dokumentacji rzeczoznawcy" — a udział, którego księga nie podała, jest kreską.
   */
  it("I-19: bez zbadanej księgi operat milczy o księgach, o akcie i o odpisie", () => {
    const doc = render({ kw: "brak" });
    for (const phrase of [
      "Badanie ksiąg wieczystych przeprowadzono",
      "Badanie ksiąg wieczystych –",
      "Wypis aktu notarialnego",
      "Dla nieruchomości gruntowej",
      "Pełna treść odpisu KW",
      "wg odpisu księgi wieczystej",
      "dokonano badania księgi wieczystej",
    ]) {
      expectNoText(doc, phrase);
    }
    expect(sectionText(doc, "8.2.")).toContain("Udział w nieruchomości wspólnej: —");
  });

  /**
   * Ścieżka codzienna biura: obie księgi zbadane ręcznie w eKW. §7 nazywa akt
   * danymi z działu II (D-12), a §2 podaje numer księgi gruntu z sądem (D-07).
   */
  it("I-13 G: przy badaniu ręcznym §7 podaje akt z działu II, a §2 sąd i numer księgi gruntu", () => {
    const doc = render({ kw: "ekw_reczne_obie_ksiegi" });
    const model = buildDocumentModel(wycena1409Anon({ kw: "ekw_reczne_obie_ksiegi" }));

    expect(model.akt_opis).toBe("UMOWA SPRZEDAŻY, Rep. A nr 1234/2015 z dnia 20.03.2015");
    expect(sectionText(doc, "7.")).toContain(`Wypis aktu notarialnego – ${model.akt_opis},`);
    expect(sectionText(doc, "7.")).toContain("Badanie ksiąg wieczystych –");

    expect(sectionText(doc, "2.")).toContain(
      `Dla nieruchomości gruntowej ${model.sad_ksiegi_gruntu} prowadzi ` +
        `księgę wieczystą nr ${model.nr_ksiegi_gruntu}.`,
    );
    expectNoText(doc, "właściwy sąd rejonowy");
    expectNoText(doc, "umowa ustanowienia odrębnej własności lokalu i sprzedaży");
  });

  /**
   * Ten sam fakt bez sądu. `nr_ksiegi_gruntu` pochodzi z migawki GRUNTU, a
   * `sad_ksiegi_gruntu` z pól księgi LOKALU — więc księga gruntu bywa zbadana,
   * a sądu nie ma (`document-model.ts`: „the two are NOT filled together"). Bez
   * osobnego wariantu zdanie wyszłoby z dziurą i podwójną spacją.
   */
  it("I-13 G: bez sądu §2 drukuje pełne zdanie z samym numerem, nie zdanie z dziurą", () => {
    const input = wycena1409Anon({ kw: "ekw_reczne_obie_ksiegi" });
    input.inputs.kw!.sad = null;
    input.inputs.kw!.wydzial = null;
    const model = buildDocumentModel(input);
    expect(model.sad_ksiegi_gruntu).toBe("");

    const doc = openDocx(renderOperatDocx(model));
    expect(sectionText(doc, "2.")).toContain(
      `Dla nieruchomości gruntowej prowadzona jest księga wieczysta nr ${model.nr_ksiegi_gruntu}.`,
    );
    expectNoText(doc, "gruntowej  prowadzi");
  });
});
