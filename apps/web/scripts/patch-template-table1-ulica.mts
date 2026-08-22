/**
 * Table 1 back to the reference operat's layout (Slice 3d, decision 2026-08-22):
 * `Data transakcji | Miasto | Ulica | Pow. uż. [m2] | Cena transakcyjna [zł/m2]`.
 *
 * Slice 3 (T10) had replaced Miasto/Ulica with Obręb/Odległość; those two stay, but only
 * in step 3 — Aneta's operat does not carry them. Run once, commit the .docx AND the new
 * TEMPLATE_SHA256 in `tests/f12-template-integrity.test.ts` in the SAME commit, so every
 * change to the binary is a reviewed event (F-12).
 *
 * Idempotent: a second run on a patched template is a no-op. Touches ONLY the row inside
 * `{#transakcje}…{/transakcje}` and that table's header — `{obreb}` also appears in
 * section 8.2 (subject data) and must survive untouched.
 *
 *   pnpm tsx scripts/patch-template-table1-ulica.mts
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";

const TEMPLATE = path.join(process.cwd(), "templates", "operat-szablon.docx");
const zip = new PizZip(fs.readFileSync(TEMPLATE));
const xml = zip.files["word/document.xml"].asText();

const rowStart = xml.indexOf("{#transakcje}");
const rowEnd = xml.indexOf("{/transakcje}");
if (rowStart < 0 || rowEnd < 0) throw new Error("nie znaleziono pętli {#transakcje} w szablonie");

const headerStart = xml.lastIndexOf("Data transakcji", rowStart);
if (headerStart < 0) throw new Error("nie znaleziono nagłówka Tabeli 1");

const header = xml.slice(headerStart, rowStart);
const row = xml.slice(rowStart, rowEnd);
const after = xml.slice(rowEnd);

const WIDTH_CITY = 1276; // było „Odległość [m]" — miastu wystarczy 2,3 cm
const WIDTH_STREET = 2628; // było „Obręb" — nazwa ulicy bywa 30-znakowa

/**
 * Column widths follow the TEXT, not the position: after the swap "Miasto" sits where
 * "Obręb" was (4,6 cm) and "Ulica" where "Odległość [m]" was (2,3 cm) — exactly backwards.
 * "Jana Henryka Dąbrowskiego" or "Bohaterów II Wojny Światowej" would wrap onto three
 * lines in 2,3 cm while "Poznań" idled in 4,6. Total table width is unchanged.
 */
function swapWidths(fragment: string): string {
  const MARK = "\u0000";
  return fragment
    .replace(new RegExp(`w:w="${WIDTH_STREET}"`, "g"), `w:w="${MARK}"`)
    .replace(new RegExp(`w:w="${WIDTH_CITY}"`, "g"), `w:w="${WIDTH_STREET}"`)
    .replace(new RegExp(`w:w="${MARK}"`, "g"), `w:w="${WIDTH_CITY}"`);
}

const alreadyPatched = row.includes("{miasto}");
const patchedHeader = alreadyPatched
  ? header
  : swapWidths(
      header
        .replace("<w:t>Obręb</w:t>", "<w:t>Miasto</w:t>")
        .replace("<w:t>Odległość [m]</w:t>", "<w:t>Ulica</w:t>"),
    );
const patchedRow = alreadyPatched
  ? row
  : swapWidths(row.replace("{obreb}", "{miasto}").replace("{odleglosc}", "{ulica}"));

// Also the <w:tblGrid> that precedes the header row.
const gridStart = xml.lastIndexOf("<w:tblGrid>", headerStart);
const gridEnd = xml.indexOf("</w:tblGrid>", gridStart) + "</w:tblGrid>".length;
const grid = xml.slice(gridStart, gridEnd);
const patchedGrid = alreadyPatched ? grid : swapWidths(grid);

if (alreadyPatched) {
  console.log("szablon już spatchowany — nic do zrobienia");
  process.exit(0);
}

for (const [what, patched, original] of [
  ["nagłówek", patchedHeader, header],
  ["wiersz", patchedRow, row],
] as const) {
  if (patched === original) throw new Error(`${what} Tabeli 1 nie został zmieniony — sprawdź szablon`);
}

zip.file(
  "word/document.xml",
  xml.slice(0, gridStart) +
    patchedGrid +
    xml.slice(gridEnd, headerStart) +
    patchedHeader +
    patchedRow +
    after,
);
const out = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
fs.writeFileSync(TEMPLATE, out);
console.log("Tabela 1: Obręb → Miasto, Odległość [m] → Ulica (szerokości zamienione)");
console.log("nowy TEMPLATE_SHA256 =", createHash("sha256").update(out).digest("hex"));
