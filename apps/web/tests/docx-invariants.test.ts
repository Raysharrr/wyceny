import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { renderOperatDocx, type RenderMaps } from "../src/adapters/docx-render";
import { buildDocumentModel } from "../src/domain/document-model";
import { SUBJECT_WITH_MPZP, syntheticDocumentInput } from "./fixtures/document-model-fixture";
import { JPG_1PX, PNG_1PX } from "./fixtures/jpeg-fixtures";
import {
  effectiveRunFormat,
  expectExactlyOne,
  expectImageInParagraph,
  expectNoText,
  openDocx,
  paragraphsWithoutStyle,
  sectionParagraphs,
  sectionText,
  textboxTexts,
} from "./support/docx-invariants";

/**
 * Warstwa `docx-invariants` (spec operat-bugfix §7.1, plan §P1.4 TF.1). Każda funkcja
 * ma przypadek poprawny i przypadek, który musi wykryć — na minimalnym DOCX budowanym
 * tutaj (bez binariów w repo) — oraz sprawdzenie na prawdziwym szablonie albo renderze.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NAMESPACES = [
  `xmlns:w="${W}"`,
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
].join(" ");

function docx(
  body: string,
  parts: { styles?: string; theme?: string; rels?: string } = {},
): Buffer {
  const zip = new PizZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`,
  );
  if (parts.styles)
    zip.file("word/styles.xml", `<w:styles xmlns:w="${W}">${parts.styles}</w:styles>`);
  if (parts.theme) {
    zip.file(
      "word/theme/theme1.xml",
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme>${parts.theme}</a:fontScheme></a:themeElements></a:theme>`,
    );
  }
  if (parts.rels) {
    zip.file(
      "word/_rels/document.xml.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${parts.rels}</Relationships>`,
    );
  }
  return zip.generate({ type: "nodebuffer" });
}

const run = (text: string, rPr = "") =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${run(text)}</w:p>`;
const textbox = (choice: string, vml: string) =>
  `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>${para(choice)}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${para(vml)}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
const image = (rId: string) =>
  `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
const table = (cellText: string) => `<w:tbl><w:tr><w:tc>${para(cellText)}</w:tc></w:tr></w:tbl>`;
const IMAGE_REL =
  '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>';

const SENTENCE =
  "Lokal położony jest na trzecim piętrze budynku wielorodzinnego przy ulicy Testowej.";

/** Dwie sekcje z podsekcją; to samo zdanie w 1.1 i w 2. */
const SECTIONS = docx(
  [
    para("Spis treści"),
    para("1. Wstęp3", "Spistreci1"),
    para("1. Wstęp", "Iza1"),
    para("Tekst wstępu."),
    para("1.1. Szczegóły", "iza2"),
    para(SENTENCE),
    image("rIdImg"),
    para("2. Cel wyceny", "Iza1"),
    para(SENTENCE),
    table("Komórka tabeli w sekcji 2."),
    para("3. Założenia do wyceny"),
    para("Treść założeń."),
  ].join(""),
  {
    styles: '<w:style w:type="paragraph" w:styleId="Spistreci1"><w:name w:val="toc 1"/></w:style>',
    rels: IMAGE_REL,
  },
);

const TEMPLATE = fs.readFileSync(path.join(process.cwd(), "templates", "operat-szablon.docx"));
const MAPS: RenderMaps = { ewidencyjna: PNG_1PX, orto: JPG_1PX };
const rendered = openDocx(
  renderOperatDocx(buildDocumentModel(syntheticDocumentInput(SUBJECT_WITH_MPZP)), { maps: MAPS }),
);

describe("openDocx — parser XML bez usuwania znaczników", () => {
  it("składa tekst akapitu z runów, dekoduje encje, mapuje tabulator i złamanie wiersza", () => {
    const doc = openDocx(
      docx(
        `<w:p>${run("Zakres ")}${run("wyceny")}<w:r><w:tab/><w:t>a &lt; b</w:t><w:br/><w:t>dalej</w:t></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:del><w:r><w:delText>usunięte</w:delText></w:r></w:del></w:p>`,
      ),
    );
    expect(doc.paragraphs).toHaveLength(1);
    expect(doc.paragraphs[0].text).toBe("Zakres wyceny\ta < b\ndalej");
    expect(doc.paragraphs[0].runs.map((r) => r.text)).toEqual([
      "Zakres ",
      "wyceny",
      "\ta < b\ndalej",
      "",
      "",
    ]);
    expect(doc.runs).toHaveLength(5);
  });

  it("oznacza kontener akapitu, a akapit z polem tekstowym nie wchłania jego tekstu", () => {
    const doc = openDocx(
      docx(para("W body") + table("W tabeli") + textbox("Kopia Choice", "Kopia VML")),
    );
    expect(doc.paragraphs.map((p) => [p.container, p.text])).toEqual([
      ["body", "W body"],
      ["table", "W tabeli"],
      ["body", ""],
      ["txbx-choice", "Kopia Choice"],
      ["txbx-vml", "Kopia VML"],
    ]);
  });

  it("nie gubi txbxContent — obie kopie pola tekstowego szablonu są osobnymi polami", () => {
    const doc = openDocx(TEMPLATE);
    expect(doc.textboxes.map((t) => t.copy)).toEqual(["choice", "vml"]);
    expect(doc.textboxes[0].text).toContain("e-mail");
    expect(doc.textboxes[1].text).toContain("e-mail");
  });
});

describe("textboxTexts — obie kopie pola tekstowego osobno", () => {
  it("zwraca identyczne kopie, gdy pole ma tę samą treść", () => {
    const t = textboxTexts(openDocx(docx(textbox("Biuro Testowe", "Biuro Testowe"))));
    expect(t).toEqual({ choice: ["Biuro Testowe"], vml: ["Biuro Testowe"] });
  });

  it("wykrywa kopię VML z inną treścią niż mc:Choice", () => {
    const t = textboxTexts(openDocx(docx(textbox("Jan Fikcyjny", "Anna Inna"))));
    expect(t.choice).toEqual(["Jan Fikcyjny"]);
    expect(t.vml).toEqual(["Anna Inna"]);
    expect(t.choice).not.toEqual(t.vml);
  });

  it("na szablonie obie kopie pola okładki niosą tę samą treść", () => {
    const t = textboxTexts(openDocx(TEMPLATE));
    expect(t.choice).toHaveLength(1);
    expect(t.choice).toEqual(t.vml);
  });
});

describe("sectionText — tekst pod nagłówkiem do następnego nagłówka tego samego poziomu", () => {
  const doc = openDocx(SECTIONS);

  it("obejmuje podsekcje i tabele, kończy się na następnym nagłówku tego samego poziomu", () => {
    expect(sectionText(doc, "1. Wstęp")).toBe(
      ["Tekst wstępu.", "1.1. Szczegóły", SENTENCE, ""].join("\n"),
    );
    expect(sectionText(doc, "2. Cel wyceny")).toBe(
      [SENTENCE, "Komórka tabeli w sekcji 2."].join("\n"),
    );
  });

  it("podsekcja kończy się na nagłówku wyższego poziomu", () => {
    expect(sectionText(doc, "1.1. Szczegóły")).toBe([SENTENCE, ""].join("\n"));
  });

  it("widzi to samo zdanie w dwóch sekcjach, a nie w trzeciej", () => {
    expect(sectionText(doc, "1. Wstęp")).toContain(SENTENCE);
    expect(sectionText(doc, "2. Cel wyceny")).toContain(SENTENCE);
    expect(sectionText(doc, "3. Założenia do wyceny")).not.toContain(SENTENCE);
  });

  it("poziom bierze z numeru w tekście, nie ze stylu — nagłówek bez pStyle też jest nagłówkiem", () => {
    expect(sectionText(doc, "2. Cel wyceny")).not.toContain("Treść założeń.");
    expect(sectionText(doc, "3. Założenia")).toBe("Treść założeń.");
  });

  it("sam numer bez tytułu też kończy sekcję (szablon: „12.4. ” w osobnym akapicie)", () => {
    const split = openDocx(
      docx(
        para("1. Sekcja") + para("Treść 1.") + para("1.1. ") + para("Tabela 4") + para("2. Dalej"),
      ),
    );
    expect(sectionText(split, "1. Sekcja")).toContain("Tabela 4");
    const bare = openDocx(
      docx(para("1.1. Podsekcja") + para("Treść 1.1.") + para("1.2. ") + para("Tabela 4")),
    );
    expect(sectionText(bare, "1.1. Podsekcja")).toBe("Treść 1.1.");
    expect(sectionText(bare, "1.2.")).toBe("Tabela 4");
  });

  it("dopasowuje nagłówek po prefiksie i pomija wpis spisu treści", () => {
    expect(sectionText(doc, "1. Wst")).toContain("Tekst wstępu.");
  });

  it("rzuca, gdy nagłówka nie ma albo prefiks pasuje do kilku", () => {
    expect(() => sectionText(doc, "4. Nie ma takiej sekcji")).toThrow(/Nie znaleziono nagłówka/);
    expect(() => sectionText(openDocx(docx(para("1. Aaa") + para("1. Aab"))), "1. Aa")).toThrow(
      /kilku nagłówków/,
    );
  });

  it("na renderze tnie sekcje, których style szablonu przeczą numeracji (8.4 w Iza1, 10.1 bez stylu)", () => {
    const s8 = sectionText(rendered, "8. Opis stanu");
    expect(s8).toContain("8.4. Stan zagospodarowania");
    expect(s8).not.toContain("9. Przeznaczenie w dokumentacji planistycznej");
    const s84 = sectionText(rendered, "8.4. Stan zagospodarowania");
    expect(s84.length).toBeGreaterThan(0);
    expect(s84).not.toContain("9. Przeznaczenie");
    expect(sectionText(rendered, "10.1. Założenia do wyceny").length).toBeGreaterThan(0);
    expect(sectionText(rendered, "10. Metodologia wyceny")).toContain("10.1. Założenia do wyceny");
    expect(sectionText(rendered, "12. Określenie wartości rynkowej")).toContain(
      "12.2. Charakterystyka",
    );
    expect(sectionText(rendered, "12.3.")).toContain("Tabela 3");
    expect(sectionText(rendered, "12.3.")).not.toContain("Tabela 4");
    expect(sectionText(rendered, "12.4.")).toContain("Tabela 4");
  });
});

describe("expectNoText", () => {
  it("przechodzi, gdy frazy nie ma", () => {
    expect(() => expectNoText(openDocx(SECTIONS), "wg wypisu z ewidencji")).not.toThrow();
  });

  it("wykrywa frazę w body mimo wielkiej litery, twardej spacji i podwójnego odstępu", () => {
    const doc = openDocx(docx(para("Dane ewidencyjne:\u00A0Wg  wypisu z ewidencji gruntów")));
    expect(() => expectNoText(doc, "wg wypisu z ewidencji")).toThrow(/wg wypisu z ewidencji/);
  });

  it("wykrywa frazę obecną tylko w kopii VML pola tekstowego", () => {
    const doc = openDocx(docx(textbox("Jan Fikcyjny", "Anna Inna")));
    expect(() => expectNoText(doc, "Anna Inna")).toThrow(/txbx-vml/);
  });

  it("przyjmuje tekst sekcji zamiast dokumentu", () => {
    const doc = openDocx(SECTIONS);
    expect(() => expectNoText(sectionText(doc, "3. Założenia"), SENTENCE)).not.toThrow();
    expect(() => expectNoText(sectionText(doc, "2. Cel wyceny"), SENTENCE)).toThrow();
  });
});

describe("expectExactlyOne", () => {
  const VARIANTS = ["obowiązuje miejscowy plan", "brak obowiązującego miejscowego planu"];

  it("zwraca jedyny znaleziony wariant", () => {
    const doc = openDocx(docx(para("Dla terenu brak obowiązującego miejscowego planu.")));
    expect(expectExactlyOne(doc, VARIANTS)).toBe("brak obowiązującego miejscowego planu");
  });

  it("rzuca, gdy żaden wariant nie występuje", () => {
    expect(() => expectExactlyOne(openDocx(docx(para("Inny tekst."))), VARIANTS)).toThrow();
  });

  it("rzuca, gdy występują dwa różne warianty — także z wielką literą na początku zdania", () => {
    const doc = openDocx(
      docx(
        para("Dla terenu obowiązuje miejscowy plan.") +
          para("Brak obowiązującego miejscowego planu."),
      ),
    );
    expect(() => expectExactlyOne(doc, VARIANTS)).toThrow();
  });

  it("rzuca, gdy to samo zdanie stoi w dwóch sekcjach", () => {
    expect(() => expectExactlyOne(openDocx(SECTIONS), [SENTENCE])).toThrow();
    expect(expectExactlyOne(sectionText(openDocx(SECTIONS), "2. Cel wyceny"), [SENTENCE])).toBe(
      SENTENCE,
    );
  });

  it("liczy pole tekstowe raz, choć ma dwie kopie", () => {
    expect(
      expectExactlyOne(openDocx(docx(textbox("Biuro Testowe", "Biuro Testowe"))), [
        "Biuro Testowe",
      ]),
    ).toBe("Biuro Testowe");
  });
});

describe("expectImageInParagraph", () => {
  const doc = openDocx(SECTIONS);

  it("znajduje obraz osadzony w akapicie sekcji i rozwiązuje relację", () => {
    const images = expectImageInParagraph(doc, { section: "1.1. Szczegóły" });
    expect(images.map((i) => i.target)).toEqual(["media/image1.png"]);
  });

  it("rzuca, gdy sekcja nie ma obrazu", () => {
    expect(() => expectImageInParagraph(doc, { section: "2. Cel wyceny" })).toThrow(
      /2\. Cel wyceny/,
    );
  });

  it("sprawdza obszar przed nagłówkiem (okładka)", () => {
    expect(() => expectImageInParagraph(doc, { before: "1. Wstęp" })).toThrow();
    expect(expectImageInParagraph(doc, { before: "2. Cel wyceny" })).toHaveLength(1);
  });

  it("na renderze widzi mapy w §8.1", () => {
    expect(
      expectImageInParagraph(rendered, { section: "8.1. Stan otoczenia" }).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("paragraphsWithoutStyle", () => {
  it("wykrywa goły <w:p>", () => {
    const doc = openDocx(docx(para("Ze stylem", "Tekstpodstawowy22") + para("Goły akapit")));
    expect(paragraphsWithoutStyle(doc).map((p) => p.text)).toEqual(["Goły akapit"]);
  });

  it("zwraca pustą listę, gdy każdy akapit ma pStyle", () => {
    const doc = openDocx(docx(para("A", "Tekstpodstawowy22") + para("B", "Akapitzlist")));
    expect(paragraphsWithoutStyle(doc)).toEqual([]);
  });

  it("zawęża predykatem, np. do sekcji", () => {
    const doc = openDocx(SECTIONS);
    const inSection2 = new Set(sectionParagraphs(doc, "2. Cel wyceny"));
    expect(paragraphsWithoutStyle(doc, (p) => inSection2.has(p)).map((p) => p.text)).toEqual([
      SENTENCE,
      "Komórka tabeli w sekcji 2.",
    ]);
  });
});

describe("effectiveRunFormat — krój i rozmiar (wersja minimalna)", () => {
  const STYLES = [
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr></w:rPrDefault></w:docDefaults>',
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normalny"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Baza"><w:name w:val="Baza"/><w:basedOn w:val="Normalny"/><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Dziecko"><w:name w:val="Dziecko"/><w:basedOn w:val="Baza"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Motyw"><w:name w:val="Motyw"/><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Sierota"><w:name w:val="Sierota"/></w:style>',
    '<w:style w:type="character" w:styleId="Wyroznienie"><w:name w:val="Wyróżnienie"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr></w:style>',
  ].join("");
  const THEME =
    '<a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont>';
  const pWith = (style: string | null, runXml: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runXml}</w:p>`;
  const doc = openDocx(
    docx(
      [
        pWith(
          "Dziecko",
          run("jawny", '<w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/><w:sz w:val="20"/>'),
        ),
        pWith("Dziecko", run("bez rPr")),
        pWith("Motyw", run("motyw")),
        pWith(null, run("bez pStyle")),
        pWith("Sierota", run("styl bez basedOn")),
        pWith("Dziecko", run("styl znakowy", '<w:rStyle w:val="Wyroznienie"/>')),
        pWith("Nieznany", run("nieznany pStyle")),
      ].join(""),
      { styles: STYLES, theme: THEME },
    ),
  );
  const format = (i: number) => effectiveRunFormat(doc, doc.paragraphs[i].runs[0]);

  it("jawne rFonts i sz runu wygrywają ze stylem", () => {
    expect(format(0)).toEqual({ font: "Segoe UI", sizePt: 10 });
  });

  it("run bez rPr dziedziczy per atrybut po łańcuchu basedOn", () => {
    expect(format(1)).toEqual({ font: "Georgia", sizePt: 12 });
  });

  it("czcionkę motywu rozwiązuje z theme1.xml", () => {
    expect(format(2)).toEqual({ font: "Calibri", sizePt: null });
  });

  it("akapit bez pStyle i z nieznanym pStyle bierze styl domyślny akapitu", () => {
    expect(format(3)).toEqual({ font: "Arial", sizePt: 11 });
    expect(format(6)).toEqual({ font: "Arial", sizePt: 11 });
  });

  it("styl bez basedOn nie dziedziczy po Normalnym — spada do docDefaults", () => {
    expect(format(4)).toEqual({ font: "Times New Roman", sizePt: null });
  });

  it("styl znakowy (rStyle) stoi między rPr runu a stylem akapitu", () => {
    expect(format(5)).toEqual({ font: "Courier New", sizePt: 12 });
  });

  describe("bieżąca binarka szablonu (check dryfu D-1, zgłoszenie M-6)", () => {
    const tpl = openDocx(TEMPLATE);
    const tp22 = tpl.paragraphs.filter((p) => p.style === "Tekstpodstawowy22");

    it("styl Tekstpodstawowy22 bez rPr runu daje Times New Roman 12", () => {
      // Binarka nie ma runu bez rPr w tym stylu — bierzemy prawdziwy run i zdejmujemy
      // mu formatowanie bezpośrednie, żeby zmierzyć sam łańcuch stylów.
      const bare = {
        ...tp22[0].runs[0],
        rStyle: null,
        props: { ascii: null, asciiTheme: null, szHalfPt: null },
      };
      expect(effectiveRunFormat(tpl, bare)).toEqual({ font: "Times New Roman", sizePt: 12 });
    });

    it("każdy run z tekstem w Tekstpodstawowy22 wychodzi w Segoe UI 10 tylko dzięki rPr", () => {
      const runs = tp22.flatMap((p) => p.runs).filter((r) => r.text.trim() !== "");
      expect(runs.length).toBeGreaterThan(0);
      expect(new Set(runs.map((r) => JSON.stringify(effectiveRunFormat(tpl, r))))).toEqual(
        new Set([JSON.stringify({ font: "Segoe UI", sizePt: 10 })]),
      );
      expect(runs.every((r) => r.props.ascii === "Segoe UI" && r.props.szHalfPt === 20)).toBe(true);
    });
  });
});
