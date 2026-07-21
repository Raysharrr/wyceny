import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import expressionParser from "docxtemplater/expressions.js";
import ImageModule from "docxtemplater-image-module-free";
import type { DocumentModel } from "../domain/document-model";

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

/** §8.1 map images (Slice 9) — both required together, never one without the other. */
export type RenderMaps = { ewidencyjna: Buffer; orto: Buffer };

export function renderOperatDocx(
  model: DocumentModel,
  opts?: { signature?: Buffer | null; maps?: RenderMaps | null },
): Buffer {
  const signature = opts?.signature ?? null;
  const maps = opts?.maps ?? null;
  // Tag values are string markers (Slice 8 contract: Buffer = crash); the
  // bytes flow only through getImage, dispatched per tagName (spike-proven).
  const images: Record<string, Buffer> = {
    ...(signature ? { podpis: signature } : {}),
    ...(maps ? { mapa_ewidencyjna: maps.ewidencyjna, mapa_orto: maps.orto } : {}),
  };
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    parser: expressionParser,
    modules: [
      new ImageModule({
        centered: false,
        getImage: (_tagValue: string, tagName: string) => images[tagName],
        getSize: (_buf: Buffer, _tagValue: string, tagName: string) =>
          tagName === "podpis" ? SIGNATURE_SIZE : MAP_SIZE,
      }),
    ],
  });
  doc.render({
    ...model,
    podpis: signature ? "sygnatariusz" : null,
    mapy: Boolean(maps),
    mapa_ewidencyjna: maps ? "mapa_ewidencyjna" : null,
    mapa_orto: maps ? "mapa_orto" : null,
  });
  // DEFLATE closes the Slice 4 backlog: XML compresses ~10x, media stay as-is
  // (spike: 1.88 MB -> 0.88 MB with two real maps).
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
