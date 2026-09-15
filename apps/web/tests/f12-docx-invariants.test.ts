import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "../src/domain/document-model";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { wycena1409Anon } from "./fixtures/wycena-1409-anon";
import {
  effectiveRunFormat,
  openDocx,
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
