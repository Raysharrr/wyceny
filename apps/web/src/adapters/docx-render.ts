import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater, { type DXT } from "docxtemplater";
import expressionParser from "docxtemplater/expressions.js";
import ImageModule from "docxtemplater-image-module-free";
import { getImageXml } from "docxtemplater-image-module-free/js/templates";
import type { DocumentModel } from "../domain/document-model";
import { fitBox, isJpeg, jpegDimensions } from "../lib/jpeg";
import type { InspectionSection, RenderPhotos } from "../domain/inspection";

/**
 * DOCX renderer — fills the production operat template with a masked
 * DocumentModel. Pure JS (docxtemplater), validated end-to-end by the
 * 2026-07-15 template spike. The expressions parser is LOAD-BEARING:
 * without it `{a.b}` renders the string "undefined" (operat-e2e spike bug).
 *
 * Signature (ADR-020 wariant a): the render never draws the signature.
 * `{%podpis}` becomes an invisible bookmark — {@link SIGNATURE_MARKER} — and
 * the approved DOCX is stored with it; signing is `signOperatDocx`, which
 * fills that one spot in the STORED file. The signed text is then the approved
 * text by construction, whatever the template or the model became in between.
 */
const TEMPLATE_PATH = path.join(process.cwd(), "templates", "operat-szablon.docx");

/** Fixed signature box in px (spike-verified fit for the title-page cell). */
const SIGNATURE_SIZE: [number, number] = [170, 57];

/** Print size of each map in the document, px @96dpi (600px ≈ 15.9 cm width). */
const MAP_SIZE: [number, number] = [600, 450];

/**
 * Print box for an inspection photo, px @96dpi — aspect-preserved inside.
 *
 * Half the text column, so two photos stand in a row the way Aneta's operat prints them
 * (two columns, six photos to a page). Was [600, 450] until 2026-08-23 — one photo across
 * the full page width, which is what she asked us to shrink.
 */
export const PHOTO_BOX: [number, number] = [290, 220];

/**
 * Where the signature goes, left in the approved DOCX (ADR-020 wariant a). A
 * bookmark, not text: it prints nothing in Word or in the PDF, and the
 * appraiser's own text can never spell it — unlike a tag, which is also why
 * signing is not a second docxtemplater pass (docx-render-signature.test.ts,
 * warunek 1). The leading underscore keeps it out of Word's bookmark list.
 */
const SIGNATURE_MARKER =
  '<w:bookmarkStart w:id="990001" w:name="_WycenyPodpis"/><w:bookmarkEnd w:id="990001"/>';

/** The free image module's name for the `%` placeholders it parses. */
const IMAGE_MODULE = "open-xml-templating/docxtemplater-image-module";

/**
 * The image module, except for `{%podpis}`: like any image tag it replaces its
 * `w:t` (so the rendered text is what an empty signature always rendered), but
 * with the marker where the image would stand. Bookmarks sit between runs, so
 * the run holding the tag is closed around it.
 */
class OperatImageModule extends ImageModule {
  render(part: DXT.Part, options: DXT.RenderOptions): DXT.Rendered | null {
    if (part.module === IMAGE_MODULE && part.value === "podpis") {
      return { value: `</w:r>${SIGNATURE_MARKER}<w:r>`, errors: [] };
    }
    return super.render(part, options);
  }
}

/** A DOCX with no signature marker: approved before ADR-020, or already signed. */
export class UnsignableDocxError extends Error {
  constructor() {
    super("The DOCX carries no signature marker — it cannot be signed");
    this.name = "UnsignableDocxError";
  }
}

/** §8.1 map images (Slice 9) — both required together, never one without the other. */
export type RenderMaps = { ewidencyjna: Buffer; orto: Buffer };

/** §8.3 inspection photos (Slice 10, F-12 media leg) — re-exported for callers. */
export type { RenderPhotos } from "../domain/inspection";

export function renderOperatDocx(
  model: DocumentModel,
  opts?: {
    maps?: RenderMaps | null;
    photos?: RenderPhotos | null;
    /** The template bytes; tests pass a variant, production reads the shipped file. */
    template?: Buffer;
  },
): Buffer {
  const maps = opts?.maps ?? null;
  const photos = opts?.photos ?? null;
  // Tag values are string markers (Slice 8 contract: Buffer = crash); the
  // bytes flow only through getImage, dispatched per tagName (spike-proven).
  const images: Record<string, Buffer> = maps
    ? { mapa_ewidencyjna: maps.ewidencyjna, mapa_orto: maps.orto }
    : {};
  // Photo loop items are string markers too (same contract): all three photo
  // tags in the template share tagName "img", so bytes are dispatched by
  // tagVALUE (the marker) through photoMap rather than by tagName.
  const photoMap: Record<string, Buffer> = {};
  const fotoLoop = (section: InspectionSection) =>
    (photos?.[section] ?? []).map((buf, i) => {
      const marker = `foto-${section}-${i}`;
      photoMap[marker] = buf;
      return { img: marker };
    });
  const foto = {
    foto_otoczenie: fotoLoop("otoczenie"),
    foto_budynek: fotoLoop("budynekZewn"),
    foto_wnetrza: fotoLoop("wnetrza"),
  };
  const zip = new PizZip(opts?.template ?? fs.readFileSync(TEMPLATE_PATH));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    parser: expressionParser,
    modules: [
      new OperatImageModule({
        centered: false,
        getImage: (tagValue: string, tagName: string) =>
          tagName === "img" ? photoMap[tagValue] : images[tagName],
        getSize: (buf: Buffer, _tagValue: string, tagName: string) => {
          if (tagName === "img") {
            const dims = jpegDimensions(buf);
            return dims ? fitBox(dims, PHOTO_BOX) : PHOTO_BOX;
          }
          return MAP_SIZE;
        },
      }),
    ],
  });
  doc.render({
    ...model,
    mapy: Boolean(maps),
    mapa_ewidencyjna: maps ? "mapa_ewidencyjna" : null,
    mapa_orto: maps ? "mapa_orto" : null,
    ...foto,
    // Derived from bytes ACTUALLY supplied here, not the inputs manifest —
    // render truth = bytes present (manifest-to-bytes wiring is Task 8).
    ma_foto_otoczenie: foto.foto_otoczenie.length > 0,
    ma_foto_budynek: foto.foto_budynek.length > 0,
    ma_foto_wnetrza: foto.foto_wnetrza.length > 0,
  });
  // DEFLATE closes the Slice 4 backlog: XML compresses ~10x, media stay as-is
  // (spike: 1.88 MB -> 0.88 MB with two real maps).
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

/**
 * Signs an approved operat (ADR-020 wariant a): the scan goes where
 * {@link SIGNATURE_MARKER} stands, and nothing else in the file changes — no
 * template, no model, no second template pass. Throws
 * {@link UnsignableDocxError} unless the marker is there exactly once.
 */
export function signOperatDocx(approvedDocx: Buffer, signature: Buffer): Buffer {
  const zip = new PizZip(approvedDocx);
  const parts = (zip.file("word/document.xml")?.asText() ?? "").split(SIGNATURE_MARKER);
  if (parts.length !== 2) {
    throw new UnsignableDocxError();
  }
  const relsPath = "word/_rels/document.xml.rels";
  const rels = zip.file(relsPath)!.asText();
  const rId = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  // Profile scans are PNG or JPEG (save-signature.ts); the extension is what
  // [Content_Types].xml types the part by.
  const extension = isJpeg(signature) ? "jpeg" : "png";
  const target = `media/image_generated_podpis.${extension}`;
  zip.file(`word/${target}`, signature, { binary: true });
  zip.file(
    relsPath,
    rels.replace(
      "</Relationships>",
      `<Relationship Id="rId${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`,
    ),
  );
  const typesPath = "[Content_Types].xml";
  const types = zip.file(typesPath)!.asText();
  if (!types.includes(`Extension="${extension}"`)) {
    zip.file(
      typesPath,
      types.replace(
        "</Types>",
        `<Default Extension="${extension}" ContentType="image/${extension}"/></Types>`,
      ),
    );
  }
  // Same inline drawing, box and EMU conversion the image module used when it
  // drew the signature itself.
  const [cx, cy] = SIGNATURE_SIZE.map((px) => Math.round(px * 9525));
  zip.file("word/document.xml", parts.join(`<w:r>${getImageXml(rId, [cx, cy])}</w:r>`));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
