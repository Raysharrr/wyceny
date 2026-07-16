import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { OPERAT_SECTIONS } from "../src/domain/operat-sections";

/**
 * F-12 (template leg): the committed production template must be scrubbed —
 * no PII from the source operat (PESEL, owner names, KW number), no
 * Kościelna-specific literals (they would leak into every generated operat),
 * no r² claim (the engine does not compute r²), and every placeholder from
 * the contract present. The .docx is a ZIP (binary to git grep), so F-9's
 * repo scan can NOT see inside it — this test is the enforcement.
 */
const TEMPLATE = path.join(process.cwd(), "templates", "operat-szablon.docx");

function templateXml(): string {
  const zip = new PizZip(fs.readFileSync(TEMPLATE));
  return Object.keys(zip.files)
    .filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f))
    .map((f) => zip.files[f].asText())
    .join("\n");
}

/**
 * Visible text only — strips XML tags so placeholder checks match what
 * docxtemplater parses. NBSP (U+00A0, used as the thousands separator in the
 * source KCS tables) is normalized to a normal space so FORBIDDEN_LITERALS can
 * be written with ordinary spaces.
 */
function templateText(): string {
  return templateXml()
    .replace(/<[^>]+>/g, "")
    .replace(/ /g, " ");
}

const FORBIDDEN_LITERALS = [
  "Kościeln", // any case form of the source street/property
  "Rajewsk", // source clients' surname
  "7163/468337", // source building share
  "26.03.2026",
  "01.04.2026",
  "korelacji", // the r² methodology sentence must be gone
  // Task 2: KCS values now parameterized (Tabela 2/3/4 + §11 sample prose).
  // Written with normal spaces; templateText() normalizes NBSP→space.
  "12 061,94", // Tabela 2 cena minimalna -> {cena_min}
  "14 852,90", // Tabela 2 cena maksymalna -> {cena_max}
  "13 123,60", // Tabela 2 / Tabela 4 cena średnia -> {cena_sr}
  "14 580,32", // Tabela 4 wartość na 1 m2 -> {cena_1m2}
  "1 044 388,32", // Tabela 4 wartość rynkowa (dokładna) -> {wr_dokladna}
  "1 044 400,00", // wartość rynkowa po zaokrągleniu -> {wr}
];

const REQUIRED_PLACEHOLDERS = [
  "{adres}",
  "{powierzchnia}",
  "{cel}",
  "{nr_kw}",
  "{klient}",
  "{data_ogledzin}",
  "{data_sporzadzenia}",
  "{wr}",
  "{wr_slownie}",
  "{wr_dokladna}",
  "{cena_min}",
  "{cena_max}",
  "{cena_sr}",
  "{polozenie_sr}",
  "{vmin}",
  "{vmax}",
  "{suma_ui}",
  "{cena_1m2}",
  "{#transakcje}",
  "{/transakcje}",
  "{#cechy}",
  "{/cechy}",
  "{#opis_cmin}",
  "{#opis_cmax}",
  "{#opis_przedmiot}",
  "{#kredyt}",
  "{/kredyt}",
];

describe("F-12: template integrity (operat-szablon.docx)", () => {
  it("contains no PESEL-like or KW-shaped strings anywhere in the XML", () => {
    const xml = templateXml();
    expect(xml).not.toMatch(/\d{11}/);
    expect(xml).not.toMatch(/[A-Z]{2}\d[A-Z]\s*\/\s*\d{8}\s*\/\s*\d/);
  });

  it("contains no source-operat literals", () => {
    const text = templateText();
    for (const lit of FORBIDDEN_LITERALS) {
      expect(text, `forbidden literal "${lit}" still in template`).not.toContain(lit);
    }
  });

  it("contains every contract placeholder", () => {
    const text = templateText();
    for (const ph of REQUIRED_PLACEHOLDERS) {
      expect(text, `missing placeholder ${ph}`).toContain(ph);
    }
  });

  it("has at least 19 canonical section headings, all present in the template", () => {
    expect(OPERAT_SECTIONS.length).toBeGreaterThanOrEqual(19);
    const text = templateText();
    for (const heading of OPERAT_SECTIONS) {
      expect(text, `missing section heading "${heading}"`).toContain(heading);
    }
  });
});
