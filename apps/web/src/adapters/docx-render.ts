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

export function renderOperatDocx(
  model: DocumentModel,
  opts?: { signature?: Buffer | null },
): Buffer {
  const signature = opts?.signature ?? null;
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    parser: expressionParser,
    modules: [
      new ImageModule({
        centered: false,
        getImage: () => signature as Buffer,
        getSize: () => SIGNATURE_SIZE,
      }),
    ],
  });
  doc.render({ ...model, podpis: signature ? "sygnatariusz" : null });
  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
}
