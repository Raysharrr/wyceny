import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import {
  PHOTO_BOX,
  renderOperatDocx,
  type RenderMaps,
  type RenderPhotos,
} from "../src/adapters/docx-render";
import { fitBox } from "../src/lib/jpeg";
import { buildDocumentModel } from "../src/domain/document-model";
import { syntheticDocumentInput } from "./fixtures/document-model-fixture";
import { JPG_1PX, PNG_1PX, jpegOf, sof0 } from "./fixtures/jpeg-fixtures";

const MAPS: RenderMaps = { ewidencyjna: PNG_1PX, orto: JPG_1PX };
const PHOTOS: RenderPhotos = {
  otoczenie: [JPG_1PX],
  budynekZewn: [JPG_1PX, JPG_1PX],
  wnetrza: [JPG_1PX, JPG_1PX, JPG_1PX],
};

// Real (non-degenerate) square JPEG — 600x600, larger than PHOTO_BOX in both
// dimensions, so fitBox actually scales it down: min(290/600, 220/600, 1) =
// 0.367 -> 220x220. JPG_1PX is a genuine 1x1 image (jpegDimensions confirms),
// and fitBox never upscales (jpeg-utils.test.ts), so it would stay 1x1 and
// couldn't exercise the aspect-preserving scale-down path this test targets.
const SQUARE_JPG = jpegOf([sof0(600, 600)]);

const zipOf = (buf: Buffer) => new PizZip(buf);
const generatedMedia = (buf: Buffer) =>
  Object.keys(zipOf(buf).files).filter((f) => /^word\/media\/image_generated_/.test(f));
// Same idiom as docx-render-maps.test.ts / docx-render-signature.test.ts.
const textOf = (buf: Buffer) =>
  zipOf(buf)
    .file("word/document.xml")!
    .asText()
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, " ")
    .trim();

const model = buildDocumentModel(syntheticDocumentInput());
const modelWithNote = buildDocumentModel({
  ...syntheticDocumentInput(),
  inputs: {
    ...syntheticDocumentInput().inputs,
    inspection: {
      note: "Lokal po remoncie.",
      photos: { otoczenie: [], budynekZewn: [], wnetrza: [] },
    },
  },
});

describe("renderOperatDocx photos (Slice 10, F-12 media leg)", () => {
  it("embeds maps + N photos, all JPEG magic for photos, resolvable rels", () => {
    const docx = renderOperatDocx(model, { maps: MAPS, photos: PHOTOS });
    expect(generatedMedia(docx).length).toBe(2 + 6);
  });
  it("renders section intros only for non-empty sections", () => {
    const withPhotos = textOf(renderOperatDocx(model, { photos: PHOTOS }));
    const onlyInterior = textOf(
      renderOperatDocx(model, { photos: { otoczenie: [], budynekZewn: [], wnetrza: [JPG_1PX] } }),
    );
    const without = textOf(renderOperatDocx(model));
    expect(withPhotos).toContain("dokumentację fotograficzną budynku");
    expect(withPhotos).toContain("dokumentacja fotograficzna drogi dojazdowej");
    expect(onlyInterior).toContain("dokumentację fotograficzną lokalu mieszkalnego");
    expect(onlyInterior).not.toContain("dokumentację fotograficzną budynku");
    expect(without).not.toContain("dokumentacja fotograficzna");
    expect(without).not.toContain("Dokumentacja fotograficzna i kartograficzna");
    expect(without).not.toContain("{%img}");
  });
  it("renders the note block only when a note exists", () => {
    const withNote = textOf(renderOperatDocx(modelWithNote));
    const without = textOf(renderOperatDocx(model));
    expect(withNote).toContain("Uwagi z oględzin:");
    expect(withNote).toContain("Lokal po remoncie.");
    expect(without).not.toContain("Uwagi z oględzin:");
  });
  it("keeps approve/sign text identical with photos and adds exactly one medium on sign", () => {
    const approved = renderOperatDocx(model, { maps: MAPS, photos: PHOTOS });
    const signed = renderOperatDocx(model, { maps: MAPS, photos: PHOTOS, signature: PNG_1PX });
    expect(textOf(signed)).toBe(textOf(approved));
    expect(generatedMedia(signed).length).toBe(9);
  });
  it("sizes photos by their real aspect ratio (600x600 square -> 220x220 EMU box, not stretched)", () => {
    const docx = renderOperatDocx(model, {
      photos: { otoczenie: [SQUARE_JPG], budynekZewn: [], wnetrza: [] },
    });
    const xml = zipOf(docx).file("word/document.xml")!.asText();
    // 220 px @96dpi = 2095500 EMU; a stretched 290x220 would emit cx=2762250.
    expect(xml).toContain('cx="2095500"');
    expect(xml).not.toContain('cx="2762250" cy="2095500"');
  });
});

/**
 * Aneta's operat prints two columns of photos, six to a page; ours printed one photo per
 * page width (PHOTO_BOX was [600, 450], the full text column). Her words: „dobrze gdyby
 * wstawiał mniejsze zdjęcia".
 */
describe("rozmiar zdjęcia oględzin w operacie", () => {
  it("mieści dwa zdjęcia w rzędzie — najwyżej połowa szerokości kolumny", () => {
    // Zmierzone na `<w:sectPr>` szablonu: kolumna tekstu to 9072 dxa w węższej sekcji
    // (16,0 cm = 605 px @96dpi, jednostki modułu obrazów) i 9637 dxa w szerszej. Dwa
    // pudełka po 290 px to 580 px plus spacja — mieści się w węższej z zapasem ~25 px.
    // Ta asercja pilnuje granicy; DOWODEM, że Word faktycznie zawija po dwa, jest render
    // (PDF → raster, 2026-08-23), nie ten test.
    expect(PHOTO_BOX[0]).toBeLessThanOrEqual(290);
  });

  it("poziome zdjęcie 4:3 skaluje się w całości do pudełka", () => {
    const [w, h] = fitBox({ width: 4000, height: 3000 }, PHOTO_BOX);
    expect(w).toBeLessThanOrEqual(PHOTO_BOX[0]);
    expect(h).toBeLessThanOrEqual(PHOTO_BOX[1]);
    expect(Math.abs(w / h - 4 / 3)).toBeLessThan(0.01);
  });

  it("pionowe zdjęcie nie przekracza wysokości pudełka", () => {
    const [, h] = fitBox({ width: 3000, height: 4000 }, PHOTO_BOX);
    expect(h).toBeLessThanOrEqual(PHOTO_BOX[1]);
  });
});

/**
 * Two photos to a row, the way Aneta's operat prints them. Mechanism measured on
 * 2026-08-23 (render -> LibreOffice PDF -> raster, three variants): a 2x1 table does NOT
 * do it — docxtemplater repeats paragraphs INSIDE the first cell, and a loop spanning a
 * <w:tr> repeats rows, both a vertical stack. What works is the whole loop inside ONE
 * paragraph: the image module runs with `centered: false`, so the images are inline and
 * Word wraps them itself — 1|2, 3|4, 5.
 */
describe("szablon — układ zdjęć oględzin", () => {
  const xml = new PizZip(
    fs.readFileSync(path.join(process.cwd(), "templates", "operat-szablon.docx")),
  )
    .file("word/document.xml")!
    .asText();

  for (const tag of ["foto_otoczenie", "foto_budynek", "foto_wnetrza"]) {
    it(`pętla ${tag} siedzi w jednym akapicie — inaczej każde zdjęcie dostaje własny wiersz`, () => {
      const start = xml.indexOf(`{#${tag}}`);
      const end = xml.indexOf(`{/${tag}}`);
      expect(start, `brak pętli ${tag}`).toBeGreaterThan(-1);
      expect(end, `brak zamknięcia pętli ${tag}`).toBeGreaterThan(start);
      expect(xml.slice(start, end), "granica akapitu wewnątrz pętli").not.toContain("</w:p>");
    });

    it(`{%img} w ${tag} jest jedyną treścią swojego <w:t>`, () => {
      // Mina, na którą już raz nadepnięto: gdy znacznik dzieli <w:t> z czymkolwiek innym,
      // moduł obrazów wywala „Raw tag not in paragraph" przy renderze.
      const start = xml.indexOf(`{#${tag}}`);
      const img = xml.indexOf("{%img}", start);
      expect(img).toBeGreaterThan(start);
      expect(xml.lastIndexOf("<w:t", img)).toBe(img - '<w:t xml:space="preserve">'.length);
      expect(xml.slice(img + "{%img}".length)).toMatch(/^<\/w:t>/);
    });
  }
});
