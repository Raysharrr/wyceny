import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import expressionParser from "docxtemplater/expressions.js";
import ImageModule from "docxtemplater-image-module-free";
import type { DocumentModel } from "../domain/document-model";
import { fitBox, jpegDimensions } from "../lib/jpeg";
import type { InspectionSection, RenderPhotos } from "../domain/inspection";

/**
 * DOCX renderer — fills the production operat template with a masked
 * DocumentModel. Pure JS (docxtemplater), validated end-to-end by the
 * 2026-07-15 template spike. The expressions parser is LOAD-BEARING:
 * without it `{a.b}` renders the string "undefined" (operat-e2e spike bug).
 *
 * Signature (Slice 8, spike 2026-07-19): the {%podpis} tag value MUST be a
 * string marker — the free image module treats any object (a Buffer!) as an
 * already-resolved {rId, sizePixel} and crashes. null renders empty, which
 * is the approve path; the sign path passes the owner's scan Buffer via
 * opts and the module pulls it through getImage().
 */
const TEMPLATE_PATH = path.join(process.cwd(), "templates", "operat-szablon.docx");

/** Fixed signature box in px (spike-verified fit for the title-page cell). */
const SIGNATURE_SIZE: [number, number] = [170, 57];

/** Print size of each map in the document, px @96dpi (600px ≈ 15.9 cm width). */
const MAP_SIZE: [number, number] = [600, 450];

/** Print box for an inspection photo, px @96dpi — aspect-preserved inside. */
const PHOTO_BOX: [number, number] = [600, 450];

/** §8.1 map images (Slice 9) — both required together, never one without the other. */
export type RenderMaps = { ewidencyjna: Buffer; orto: Buffer };

/** §8.3 inspection photos (Slice 10, F-12 media leg) — re-exported for callers. */
export type { RenderPhotos } from "../domain/inspection";

export function renderOperatDocx(
  model: DocumentModel,
  opts?: { signature?: Buffer | null; maps?: RenderMaps | null; photos?: RenderPhotos | null },
): Buffer {
  const signature = opts?.signature ?? null;
  const maps = opts?.maps ?? null;
  const photos = opts?.photos ?? null;
  // Tag values are string markers (Slice 8 contract: Buffer = crash); the
  // bytes flow only through getImage, dispatched per tagName (spike-proven).
  const images: Record<string, Buffer> = {
    ...(signature ? { podpis: signature } : {}),
    ...(maps ? { mapa_ewidencyjna: maps.ewidencyjna, mapa_orto: maps.orto } : {}),
  };
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
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    parser: expressionParser,
    modules: [
      new ImageModule({
        centered: false,
        getImage: (tagValue: string, tagName: string) =>
          tagName === "img" ? photoMap[tagValue] : images[tagName],
        getSize: (buf: Buffer, _tagValue: string, tagName: string) => {
          if (tagName === "podpis") return SIGNATURE_SIZE;
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
    podpis: signature ? "sygnatariusz" : null,
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
