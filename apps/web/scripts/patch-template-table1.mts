/**
 * One-off, idempotent: Table 1 headers and placeholders Miasto/Ulica →
 * Obręb/Odległość [m] (Slice 3, review PR #21 — the "Miasto" column printed
 * the subject's own city for every row, which is factually wrong for
 * comparables from a neighbouring gmina), PLUS a column-width swap (Slice 3
 * final wave, B7): the two columns' widths were sized for the ORIGINAL
 * content (a short city name, a long street address) and never resized when
 * the header text/tags were renamed above — Obręb can print up to ~18 chars
 * (e.g. "0006 · gm. 302104"), Odległość [m] only ever a short number. Each
 * step is independently idempotent — a second run is a true no-op.
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

// Column-width swap: Table 1's own <w:tbl> span, so the shared dxa widths
// (1276/2628) can't collide with an unrelated table elsewhere in the
// document. Detects the UNSWAPPED grid order and no-ops when already
// swapped (a second run must not swap back).
const transIdx = xml.indexOf("{#transakcje}");
if (transIdx === -1) throw new Error("patch failed: {#transakcje} not found");
const tblStart = xml.lastIndexOf("<w:tbl>", transIdx);
const tblEnd = xml.indexOf("</w:tbl>", transIdx) + "</w:tbl>".length;
if (tblStart === -1 || tblEnd < "</w:tbl>".length) {
  throw new Error("patch failed: Table 1 <w:tbl> bounds not found");
}
let table = xml.slice(tblStart, tblEnd);
if (table.includes('<w:gridCol w:w="1276"/><w:gridCol w:w="2628"/>')) {
  // Swaps every 1276<->2628 dxa width in this table's span — the grid
  // declaration plus the matching tcW on the header row's two cells and the
  // templated data row's two cells (3 occurrences of each, confirmed against
  // the committed template). A plain two-pass replace would double-swap, so
  // route the first value through a token that the second value can't collide with.
  const TMP = "__W_SWAP_TMP__";
  table = table
    .split('w:w="1276"')
    .join(`w:w="${TMP}"`)
    .split('w:w="2628"')
    .join('w:w="1276"')
    .split(`w:w="${TMP}"`)
    .join('w:w="2628"');
  xml = xml.slice(0, tblStart) + table + xml.slice(tblEnd);
}

if (xml === before) {
  console.log("nothing to patch");
  process.exit(0);
}

for (const s of ["{obreb}", "{odleglosc}", ">Obręb<", ">Odległość [m]<"]) {
  if (!xml.includes(s)) throw new Error(`patch failed: ${s} missing`);
}
if (!xml.includes('<w:gridCol w:w="1271"/><w:gridCol w:w="2628"/><w:gridCol w:w="1276"/>')) {
  throw new Error("patch failed: Table 1 column widths not swapped");
}

zip.file(f, xml);
fs.writeFileSync(path, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("patched", path);
