import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { renderOperatDocx, type RenderMaps } from "../src/adapters/docx-render";
import { buildDocumentModel } from "../src/domain/document-model";
import { syntheticDocumentInput } from "./fixtures/document-model-fixture";

// Synthetic 1x1 images (F-9: no real map data in fixtures)
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
  "base64",
);
const MAPS: RenderMaps = { ewidencyjna: PNG_1PX, orto: JPG_1PX };

const zipOf = (buf: Buffer) => new PizZip(buf);
const generatedMedia = (buf: Buffer) =>
  Object.keys(zipOf(buf).files).filter((f) => /^word\/media\/image_generated_/.test(f));
// Same idiom as docx-render-signature.test.ts: collapse consecutive
// tag-stripped markers into one space. An embedded <w:drawing> (e.g. the
// signature image) is pure structural markup with no <w:t> text nodes, so
// naively replacing each tag with a single space would make the drift guard
// below fail on invisible whitespace noise rather than actual text drift.
const textOf = (buf: Buffer) =>
  zipOf(buf)
    .file("word/document.xml")!
    .asText()
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, " ")
    .trim();

const model = buildDocumentModel(syntheticDocumentInput());

describe("renderOperatDocx maps (Slice 9, F-12 media leg)", () => {
  it("embeds two generated media with correct magic bytes and resolvable rels", () => {
    const docx = renderOperatDocx(model, { maps: MAPS });
    const media = generatedMedia(docx);
    expect(media.length).toBe(2);
    const zip = zipOf(docx);
    const rels = zip.file("word/_rels/document.xml.rels")!.asText();
    const magics = media.map((m) => {
      expect(rels).toContain(`Target="${m.replace("word/", "")}"`);
      const bytes = zip.file(m)!.asUint8Array();
      expect(bytes.length).toBeGreaterThan(0);
      return bytes[0];
    });
    expect(magics.sort()).toEqual([0x89, 0xff].sort()); // one PNG, one JPEG
  });

  it("renders the honest stub without maps and the captions with maps", () => {
    const withMaps = textOf(renderOperatDocx(model, { maps: MAPS }));
    const without = textOf(renderOperatDocx(model));
    expect(without).toContain("Dokumentacja kartograficzna zostanie uzupełniona.");
    expect(without).not.toContain("Źródło: Geoportal.gov.pl");
    expect(withMaps).toContain("Źródło: Geoportal.gov.pl, dane pobrane");
    expect(withMaps).not.toContain("Dokumentacja kartograficzna zostanie uzupełniona.");
    expect(withMaps).not.toContain("{%mapa_ewidencyjna}");
  });

  it("keeps approve/sign text identical with maps (drift guard) and adds exactly one medium on sign", () => {
    const approved = renderOperatDocx(model, { maps: MAPS });
    const signed = renderOperatDocx(model, { maps: MAPS, signature: PNG_1PX });
    expect(textOf(signed)).toBe(textOf(approved));
    expect(generatedMedia(signed).length).toBe(3);
  });

  it("compresses the docx (DEFLATE) — smaller than the historical uncompressed 1.24 MB", () => {
    expect(renderOperatDocx(model).length).toBeLessThan(700_000);
  });
});
