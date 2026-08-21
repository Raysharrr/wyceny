/**
 * One-off, idempotent: Table 1 headers and placeholders Miasto/Ulica →
 * Obręb/Odległość [m] (Slice 3, review PR #21 — the "Miasto" column printed
 * the subject's own city for every row, which is factually wrong for
 * comparables from a neighbouring gmina).
 *
 * Run from apps/web: `pnpm tsx scripts/patch-template-table1.mts`.
 */
import fs from "node:fs";
import PizZip from "pizzip";

const path = "templates/operat-szablon.docx";
const zip = new PizZip(fs.readFileSync(path));
const f = "word/document.xml";
let xml = zip.file(f)!.asText();
const before = xml;

xml = xml.replace("{miasto}", "{obreb}").replace("{ulica}", "{odleglosc}");
// Headers sit in their own <w:t> runs right before {#transakcje} — replace
// the whole-run text only (not any other cell that might contain the word).
xml = xml
  .replace(/(<w:t[^>]*>)Miasto(<\/w:t>)/, "$1Obręb$2")
  .replace(/(<w:t[^>]*>)Ulica(<\/w:t>)/, "$1Odległość [m]$2");

if (xml === before) {
  console.log("nothing to patch");
  process.exit(0);
}

for (const s of ["{obreb}", "{odleglosc}", ">Obręb<", ">Odległość [m]<"]) {
  if (!xml.includes(s)) throw new Error(`patch failed: ${s} missing`);
}

zip.file(f, xml);
fs.writeFileSync(path, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("patched", path);
