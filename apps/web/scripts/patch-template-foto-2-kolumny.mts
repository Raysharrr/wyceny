/**
 * Inspection photos two to a row, the way Aneta's operat prints them (Slice 3e, decision
 * 2026-08-23). Until now each `{%img}` sat alone in its own centred paragraph, so
 * docxtemplater's paragraph loop gave every photo a line of its own.
 *
 * The mechanism was MEASURED, not guessed — three variants rendered to PDF and rasterised:
 *   - 2x1 borderless table, loop across the row: docxtemplater repeats the paragraphs
 *     INSIDE the first cell. Vertical stack, no columns.
 *   - loop spanning a whole `<w:tr>`: repeats the row. Vertical stack again.
 *   - whole loop inside ONE paragraph: the image module runs with `centered: false`, so
 *     the images are inline — Word wraps them itself, 1|2, 3|4, 5. This one.
 *
 * Each tag gets its OWN run: `{%img}` must be the only content of its `<w:t>`, or the
 * image module throws "Raw tag not in paragraph" at render time (first attempt did).
 * `tests/docx-render-photos.test.ts` pins both properties.
 *
 * Idempotent: a second run on a patched template is a no-op. Run once, commit the .docx
 * AND the new TEMPLATE_SHA256 in `tests/f12-template-integrity.test.ts` in the SAME
 * commit, so every change to the binary is a reviewed event (F-12).
 *
 *   pnpm tsx scripts/patch-template-foto-2-kolumny.mts
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";

const TEMPLATE = path.join(process.cwd(), "templates", "operat-szablon.docx");
const TAGS = ["foto_otoczenie", "foto_budynek", "foto_wnetrza"] as const;

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

/** Three paragraphs — open, image, close — as the template has carried them since Slice 10. */
const stacked = (tag: string) =>
  `<w:p>${run(`{#${tag}}`)}</w:p>` +
  `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run("{%img}")}</w:p>` +
  `<w:p>${run(`{/${tag}}`)}</w:p>`;

/** One paragraph, four runs. The space between the image and the closing tag is the gutter. */
const inline = (tag: string) =>
  `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
  run(`{#${tag}}`) +
  run("{%img}") +
  run(" ") +
  run(`{/${tag}}`) +
  `</w:p>`;

const zip = new PizZip(fs.readFileSync(TEMPLATE));
let xml = zip.files["word/document.xml"].asText();

if (TAGS.every((tag) => xml.includes(inline(tag)))) {
  console.log("szablon już spatchowany — nic do zrobienia");
  process.exit(0);
}

for (const tag of TAGS) {
  const from = stacked(tag);
  if (xml.split(from).length - 1 !== 1)
    throw new Error(`pętla {#${tag}} nie wygląda jak trzy akapity — sprawdź szablon`);
  xml = xml.replace(from, inline(tag));
}

zip.file("word/document.xml", xml);
const out = zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
fs.writeFileSync(TEMPLATE, out);
console.log("dokumentacja fotograficzna: trzy akapity → jeden, obrazy inline (dwa w rzędzie)");
console.log("nowy TEMPLATE_SHA256 =", createHash("sha256").update(out).digest("hex"));
