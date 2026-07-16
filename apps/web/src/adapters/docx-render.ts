import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import expressionParser from "docxtemplater/expressions.js";
import type { DocumentModel } from "../domain/document-model";

/**
 * DOCX renderer — fills the production operat template with a masked
 * DocumentModel. Pure JS (docxtemplater), validated end-to-end by the
 * 2026-07-15 template spike. The expressions parser is LOAD-BEARING:
 * without it `{a.b}` renders the string "undefined" (operat-e2e spike bug).
 */
const TEMPLATE_PATH = path.join(process.cwd(), "templates", "operat-szablon.docx");

export function renderOperatDocx(model: DocumentModel): Buffer {
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    parser: expressionParser,
  });
  doc.render(model);
  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
}
