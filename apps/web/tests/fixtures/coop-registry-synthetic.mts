/**
 * Generator of the SYNTHETIC cooperative-register fixture (S2a, Task 5).
 *
 *   pnpm exec tsx tests/fixtures/coop-registry-synthetic.mts && pnpm exec prettier --write tests/fixtures/coop-registry-synthetic.sheets.json
 *
 * Writes `coop-registry-synthetic.xlsx` (what an appraiser uploads) and
 * `coop-registry-synthetic.sheets.json` (what the worker's `/coop-sheet` must
 * return for it — the contract both sides are tested against). Everything is
 * invented: streets, numbers, dates. NO real register is ever committed —
 * they carry PII (notaries' names and office addresses in every row) and
 * `scripts/check-no-pii.sh` cannot see inside binaries (E10).
 *
 * Reproduces the traps of the real files (wiki: rejestry-spoldzielni-
 * mieszkaniowych): title rows above the header, a "średnia" row in the
 * middle, a SUMA row at the end, two identical rows, two flats sold the same
 * day for the same price (NOT a duplicate), the same street spelled with and
 * without "os." / trailing space, a date typed as text ("02.01.2023r."), a
 * decimal comma, a blank row, a non-numeric area, an unparseable date, a
 * second sheet with no header row and a different column order where the
 * flat number sits after a slash in the address cell.
 *
 * Hand-rolled XLSX via pizzip (already a dependency through docxtemplater):
 * inline strings, plain numbers, and date cells as serials with the
 * built-in numFmt 14 so openpyxl sees them as dates.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";

type Cell = string | number | { date: string } | null;

const SHEET_1: { name: string; rows: Cell[][] } = {
  name: "Rejestr 2025",
  rows: [
    ["ZESTAWIENIE SPRZEDAŻY — PLIK SYNTETYCZNY", null, null],
    ["SM Syntetyczna (nie istnieje)"],
    [],
    [
      "Lp.",
      "Adres",
      "Nr budynku",
      "Nr mieszkania",
      "Powierzchnia",
      "Cena",
      "Data",
      "Prawo",
      "Piętro",
      "Pokoje",
      "Rok budowy",
    ],
    [
      1,
      "Zmyślona",
      4,
      12,
      45.5,
      455000,
      { date: "2025-01-14" },
      "spółdzielcze własnościowe",
      2,
      2,
      1975,
    ],
    [
      2,
      "Zmyślona",
      4,
      12,
      45.5,
      455000,
      { date: "2025-01-14" },
      "spółdzielcze własnościowe",
      2,
      2,
      1975,
    ],
    [
      3,
      "os. Zmyślona",
      4,
      13,
      45.5,
      455000,
      { date: "2025-01-14" },
      "spółdzielcze własnościowe",
      2,
      2,
      1975,
    ],
    [4, "Orła Białego ", 7, 3, "52,10", "520 000", "02.01.2023r.", "własność", "parter", 3, 1980],
    [null, "średnia", null, null, 48.2, 480000],
    [5, "Orła Białego", 7, 5, 60, 600000, { date: "2025-03-05" }, "", "IV", 3, 1980],
    [],
    [6, "Bukowa", 9, 1, "abc", 500000, { date: "2025-04-01" }, "spółdzielcze własnościowe"],
    [7, "Bukowa", 9, 2, 50, 500000, "wczoraj", "spółdzielcze własnościowe"],
    [8, "Bukowa", 9, null, 50, 500000, { date: "2025-04-01" }, "spółdzielcze własnościowe", "P"],
    ["SUMA", null, null, null, 300, 3000000],
  ],
};

const SHEET_2: { name: string; rows: Cell[][] } = {
  name: "Bez nagłówka",
  rows: [
    ["A 1234/2025", { date: "2025-05-06" }, 38.7, 387000, "ul. Bukowa 12/5"],
    ["A 1234/2025", { date: "2025-05-06" }, 38.7, 387000, "ul. Bukowa 12/5"],
    ["", { date: "2025-06-07" }, 40, 400000, "Bukowa 14/2"],
  ],
};

const SHEETS = [SHEET_1, SHEET_2];

// --- expected worker output (the contract) ---------------------------------
function cellText(c: Cell): string {
  if (c === null) return "";
  if (typeof c === "string") return c;
  if (typeof c === "number") return String(c);
  return c.date;
}
export const EXPECTED_SHEETS = {
  sheets: SHEETS.map((s) => {
    const cols = Math.max(...s.rows.map((r) => r.length));
    return {
      name: s.name,
      cols,
      rows: s.rows.map((r) => Array.from({ length: cols }, (_, i) => cellText(r[i] ?? null))),
    };
  }),
};

// --- xlsx writer ------------------------------------------------------------
function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(64 + ((n - 1) % 26) + 1) + s;
  return s;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function serial(iso: string): number {
  return Math.round(
    (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) /
      86_400_000,
  );
}
function sheetXml(rows: Cell[][]): string {
  const body = rows
    .map((r, ri) => {
      const cells = r
        .map((c, ci) => {
          if (c === null) return "";
          const ref = `${colName(ci)}${ri + 1}`;
          if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
          if (typeof c === "string")
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
          return `<c r="${ref}" s="1"><v>${serial(c.date)}</v></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function buildXlsx(): Buffer {
  const zip = new PizZip();
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${SHEETS.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${SHEETS.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${SHEETS.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${SHEETS.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  SHEETS.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(here, "coop-registry-synthetic.xlsx"), buildXlsx());
  writeFileSync(
    join(here, "coop-registry-synthetic.sheets.json"),
    JSON.stringify(EXPECTED_SHEETS, null, 2) + "\n",
  );
  console.log("written coop-registry-synthetic.{xlsx,sheets.json}");
}
