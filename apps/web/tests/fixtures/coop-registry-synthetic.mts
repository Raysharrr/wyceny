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
 * flat number sits after a slash in the address cell, a third sheet shaped
 * like SM "Przylesie" — no flat-number column at all, address carries only
 * the building number, a sum row without a label.
 *
 * Hand-rolled XLSX via pizzip (already a dependency through docxtemplater):
 * inline strings, plain numbers, and date cells as serials with the
 * built-in numFmt 14 so openpyxl sees them as dates.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildXlsxFromSheets, type Cell } from "./xlsx-writer.js";
import { fileURLToPath } from "node:url";

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

/** Przylesie-shaped: address with building only, NO flat column, unit price given, sum row last. */
const SHEET_3: { name: string; rows: Cell[][] } = {
  name: "Bez nr mieszkania",
  rows: [
    ["Adres", "Pow.", "Cena", "zł/m²", "Data", "Tytuł własności"],
    ["os. Wymyślone 12", 45, 450000, 10000, { date: "2025-01-14" }, "spółdzielcze własnościowe"],
    ["os. Wymyślone 12", 52, 450000, 8653.85, { date: "2025-01-14" }, "odrębna własność"],
    [null, 97, 900000, 9278.35, null, null],
  ],
};

const SHEETS = [SHEET_1, SHEET_2, SHEET_3];

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

export function buildXlsx(): Buffer {
  return buildXlsxFromSheets(SHEETS);
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
