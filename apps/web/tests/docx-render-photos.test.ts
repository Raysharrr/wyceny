import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { renderOperatDocx, type RenderMaps, type RenderPhotos } from "../src/adapters/docx-render";
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
// dimensions, so fitBox actually scales it down: min(600/600, 450/600, 1) =
// 0.75 -> 450x450. JPG_1PX is a genuine 1x1 image (jpegDimensions confirms),
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
  it("sizes photos by their real aspect ratio (600x600 square -> 450x450 EMU box, not stretched)", () => {
    const docx = renderOperatDocx(model, {
      photos: { otoczenie: [SQUARE_JPG], budynekZewn: [], wnetrza: [] },
    });
    const xml = zipOf(docx).file("word/document.xml")!.asText();
    // 450 px @96dpi = 4286250 EMU; a stretched 600x450 would emit cx=5715000.
    expect(xml).toContain('cx="4286250"');
    expect(xml).not.toContain('cx="5715000" cy="4286250"');
  });
});
