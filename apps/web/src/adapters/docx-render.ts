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
 * Print box for one rasterised page of the OC policy, px @96dpi — ~15×21 cm,
 * the size the reference operat's scans occupy in „Załącznik nr 1". Aspect is
 * preserved inside it, and two boxes this tall cannot share a page, so Word
 * flows one scan per page without any explicit page break in the template.
 */
export const POLICY_BOX: [number, number] = [567, 794];

/**
 * Print box for the cover photo, px @96dpi (≈ 9 × 7 cm) — aspect preserved inside.
 *
 * Every one of the ten reference operats carries three images on page 1: the
 * office banner, the appraiser's stamp, and a photo of THIS property. Ours had
 * only the first two (D-01) — the generator dropped the source operat's photo
 * as someone else's data and left no slot behind. The reference photos run
 * 7,8–11,5 cm wide with different crops, so this is a BOUND, not a size: a
 * fixed 9×7 would stretch a portrait shot. Aneta's own correction of the 14.09
 * operat measures 9,1 × 6,8 cm — what this box yields for a 4:3 frame.
 */
export const COVER_BOX: [number, number] = [340, 265];

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
    /**
     * Rasterised pages of the author's OC policy, in document order (D-60).
     * Bytes, like the inspection photos: the model carries only the markers
     * `polisa-0`, `polisa-1`, … and these fill them.
     */
    policyPages?: readonly Buffer[] | null;
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
  // M-1: the cover photo is not a field of its own — it IS the first exterior
  // shot of the building, the same bytes §8.3 prints further down. No new
  // upload, no picker, no snapshot field: whatever the appraiser uploaded
  // first under „Budynek z zewnątrz" is what the operat leads with, and B-01
  // makes sure there is one before the operat can be issued.
  const okladka = photos?.budynekZewn?.[0];
  if (okladka) images.foto_okladka = okladka;
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
  // „Załącznik nr 1" dzieli tagName `img` z pętlami zdjęć, więc bajty idą tą
  // samą mapą po tagVALUE. Model wydał tyle znaczników, ile stron miał autor —
  // rozjazd długości oznaczałby stronę bez bajtów, czyli obraz, którego moduł
  // nie umie wstawić; wtedy lepsza jest głośna odmowa niż operat z dziurą.
  const policyPages = opts?.policyPages ?? [];
  if (policyPages.length !== model.polisa_strony.length) {
    throw new Error(
      `Stron polisy w renderze (${policyPages.length}) ≠ znaczników w modelu (${model.polisa_strony.length})`,
    );
  }
  policyPages.forEach((buf, i) => {
    photoMap[`polisa-${i}`] = buf;
  });
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
        getSize: (buf: Buffer, tagValue: string, tagName: string) => {
          if (tagName === "img") {
            // Zdjęcia z oględzin i strony polisy dzielą tag `img`, ale nie
            // rozmiar: zdjęcie ma się mieścić dwa w rzędzie, a skan polisy ma
            // być czytelny, czyli prawie na całą stronę. Rozróżnia je znacznik.
            const box = tagValue.startsWith("polisa-") ? POLICY_BOX : PHOTO_BOX;
            const dims = jpegDimensions(buf);
            return dims ? fitBox(dims, box) : box;
          }
          if (tagName === "foto_okladka") {
            const dims = jpegDimensions(buf);
            return dims ? fitBox(dims, COVER_BOX) : COVER_BOX;
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
    // Same rule as the sections below — the cover fence follows the BYTES, so
    // a preview run without photos renders a cover like today's instead of
    // asking the image module for a picture nobody supplied.
    ma_foto_okladka: Boolean(okladka),
    foto_okladka: okladka ? "foto_okladka" : null,
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
