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
  "mieszalnego", // source heading typo (should read "mieszkalnego") — regression-proof
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
  // Task 2 fix: sample transaction figures baked into §11/§13 prose — source
  // DATA (would render as false content in every other operat), not boilerplate.
  "675 000", // §11 general-market total price min
  "740 000", // §11 sample total price min
  "1 040 000", // §11 total price max (appears in both paragraphs)
  "844 421", // §11 general-market average total
  "874 333", // §11 sample average total
  "18 169", // §13 offer-price range max
  // Task 7: source-operat plan symbol must never be baked into the template.
  "4MW/U",
  // Task 9 (D10): sample KW/akt values must arrive via {udzial_kw} /
  // {pow_uzytkowa_kw}, never as literals baked into the 8.2 examination block.
  "14651/29359", // sample udział we współwłasności
  "146,5100", // sample powierzchnia użytkowa
  // Task 8 (Slice 7): §12.1 rating-scale definitions are parameterized — the
  // source operat's hardcoded scale texts must never ship in the template.
  "poniżej 65 m2",
  "4 piętro i powyżej",
  "prawo do wyłącznego korzystania z miejsca postojowego",
  // Task 9 (Slice 7 follow-up): hardcoded Kościelna feature lists / count must never ship.
  "dodatkowe oraz lokalizację szczegółową",
  "dodatkowe oraz lokalizacja szczegółowa",
  "za pomocą 5 atrybutów",
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
  // Task 7: EGiB facts block (8.2) + MPZP variants (9)
  "{obreb}",
  "{arkusz}",
  "{nr_dzialki}",
  "{pow_dzialki}",
  "{uzytek}",
  "{budynek_rodzaj}",
  "{kondygnacje}",
  "{rok_budowy}",
  "{przeznaczenie_studium}",
  "{#mpzp}",
  "{/mpzp}",
  "{#mpzp_brak}",
  "{/mpzp_brak}",
  // Task 9: 8.2 KW examination block — scalars, section pairs, loops.
  "{udzial_kw}",
  "{pow_uzytkowa_kw}",
  "{#pow_kw_present}",
  "{/pow_kw_present}",
  "{kw_zrodlo}",
  "{kw_lokalu}",
  "{kw_gruntu}",
  "{kw_sad}",
  "{kw_wydzial}",
  "{kw_data_dok}",
  "{#kw_badanie}",
  "{/kw_badanie}",
  "{#kw_standard}",
  "{/kw_standard}",
  "{#kw_deweloperski}",
  "{/kw_deweloperski}",
  "{#dzial3_brak}",
  "{/dzial3_brak}",
  "{#dzial3_wpisy}",
  "{/dzial3_wpisy}",
  "{#dzial4_brak}",
  "{/dzial4_brak}",
  "{#dzial4_wpisy}",
  "{/dzial4_wpisy}",
  // Task 12: the {nr_kw} stub paragraph's second sentence ("Pełna treść odpisu
  // KW…") is wrapped in an inline section, hidden when the examination source is
  // a deed (akt) so the operat never implies a KW excerpt it may not hold.
  "{#kw_stub_odpis}",
  "{/kw_stub_odpis}",
  // Task 8 (Slice 7): §12.1 rating-scale loop.
  "{#skala_ocen}",
  "{/skala_ocen}",
  "{#poziomy}",
  "{/poziomy}",
  "{cecha}",
  "{poziom}",
  "{def}",
  // Task 9: truthful feature-list intro + honest-silence wrap.
  "{cechy_lista}",
  "{cechy_lista_wg_wag}",
  "{liczba_atrybutow_fraza}",
  "{#ma_skale}",
  "{/ma_skale}",
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

  it("contains the {%podpis} signature tag exactly once (Slice 8)", () => {
    const text = templateText();
    expect(text.match(/\{%podpis\}/g)).toHaveLength(1);
  });

  // ADR-006 (AC-8): the honest weights-methodology sentence must be present —
  // the r² claim was removed in Slice 4; this is its truthful replacement.
  it("contains the honest weights-methodology sentence (ADR-006 short variant)", () => {
    expect(templateText()).toContain(
      "Wagi cech rynkowych przyjęto na podstawie analizy rynku lokalnego",
    );
  });

  it("has at least 19 canonical section headings, all present in the template", () => {
    expect(OPERAT_SECTIONS.length).toBeGreaterThanOrEqual(19);
    const text = templateText();
    for (const heading of OPERAT_SECTIONS) {
      expect(text, `missing section heading "${heading}"`).toContain(heading);
    }
  });

  // Task 8 (Slice 7) review fix F3: the §12.1 rating-scale loop must stay a
  // MULTI-paragraph loop — {#poziomy}/{poziom} – {def}/{/poziomy}/{/skala_ocen}
  // each on their OWN <w:p> — regardless of punctuation. This is the durable
  // structural guard for the anti-run-on failure class (an INLINE loop would
  // glue consecutive levels into one paragraph with no separator, the exact
  // bug f12-document-sections.test.ts's `/powyżejprzeciętna|pośredniegorsza/`
  // regex catches downstream, by content); this test catches it upstream, by
  // shape, so it fires even if a future edit removes/changes the wording.
  it("keeps each §12.1 skala_ocen loop tag in its own paragraph (anti run-on structural guard)", () => {
    // docxtemplater tags can be split across multiple <w:t> runs in raw XML
    // (see templateText()'s NBSP-normalize precedent) — strip tags WITHIN each
    // paragraph chunk before searching, mirroring that normalization idiom.
    const paragraphs = templateXml()
      .split("</w:p>")
      .map((chunk) => chunk.replace(/<[^>]+>/g, ""));
    const loopTags = ["{#poziomy}", "{poziom} – {def}", "{/poziomy}", "{/skala_ocen}"];
    const indices = loopTags.map((tag) => paragraphs.findIndex((p) => p.includes(tag)));
    loopTags.forEach((tag, i) => {
      expect(indices[i], `tag ${tag} not found in any single paragraph`).toBeGreaterThanOrEqual(0);
    });
    expect(new Set(indices).size, "each tag must live in a distinct paragraph").toBe(
      loopTags.length,
    );
    expect(indices, "tags must appear in ascending document order").toEqual(
      [...indices].sort((a, b) => a - b),
    );
  });

  it("carries no source-operat metadata in docProps/core.xml", () => {
    // docxtemplater preserves non-document parts verbatim, so whatever sits
    // in the template's file properties ships into EVERY generated operat.
    const zip = new PizZip(fs.readFileSync(TEMPLATE));
    const core = zip.files["docProps/core.xml"].asText();
    expect(core, "source author leaks into generated documents").not.toContain("Audytor");
    expect(core, "source last-modified-by leaks into generated documents").not.toContain("Ksobiak");
    expect(core, "source lastPrinted timestamp must be scrubbed").not.toContain("cp:lastPrinted");
  });
});
