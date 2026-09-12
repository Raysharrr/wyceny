/**
 * Canonical operat section headings (F-12: ≥19 sections, no gaps).
 * GENERATED from the production template by
 * tools/spike/2026-07-15-template-koscielna/build_template.py (wiki repo) —
 * regenerate when the template changes; do not hand-edit strings.
 *
 * Since T-12 (S4) four headings carry docxtemplater tags — the subject phrase
 * and the §6/§7/§8 carrier word switch with the property right. The
 * templates are exported verbatim (the integrity test matches them against
 * the template text) and `operatSections(model)` resolves them with the
 * same DocumentModel that renders the document, so both legs of F-12 read
 * one source of truth.
 */
export const OPERAT_SECTION_TEMPLATES: readonly string[] = [
  "1. Wyciąg z operatu szacunkowego",
  "2. Przedmiot i zakres wyceny",
  "3. Cel wyceny",
  "4. Podstawa formalna wyceny",
  "5. Podstawy prawne",
  "6. Daty istotne dla określenia wartości {#prawo_wlasnosc}nieruchomości{/prawo_wlasnosc}{#prawo_spoldzielcze}rynkowej{/prawo_spoldzielcze}",
  "7. Źródła danych o {#prawo_wlasnosc}nieruchomości{/prawo_wlasnosc}{#prawo_spoldzielcze}przedmiocie wyceny{/prawo_spoldzielcze}",
  "8. Opis stanu {#prawo_wlasnosc}nieruchomości{/prawo_wlasnosc}{#prawo_spoldzielcze}przedmiotu wyceny{/prawo_spoldzielcze}",
  "8.1. Stan otoczenia",
  "8.2. Stan prawny i ewidencyjny",
  "8.3. Stan techniczno – użytkowy",
  "8.4. Stan zagospodarowania",
  "9. Przeznaczenie w dokumentacji planistycznej",
  "10. Metodologia wyceny",
  "10.1. Założenia do wyceny",
  "11. Analiza i charakterystyka rynku",
  "12. Określenie wartości rynkowej {przedmiot_d}, wg stanu                aktualnego",
  "12.1. Ustalenie cech rynkowych oraz ich wag",
  "12.2. Charakterystyka wycenianego lokalu mieszkalnego i lokali przyjętych do porównań w aspekcie cech rynkowych",
  "12.3. Ustalenie wielkości współczynników ze względu na cechy różnicujące",
  "13. Uzasadnienie wyniku",
  "14. Zastrzeżenia i klauzule",
  "15. Załączniki",
];

/** `{#flag}…{/flag}` kept when model[flag] === true; `{key}` -> String(model[key]). */
export function resolveOperatSection(
  template: string,
  model: Readonly<Record<string, unknown>>,
): string {
  return template
    .replace(/\{#(\w+)\}([\s\S]*?)\{\/\1\}/g, (_, flag: string, inner: string) =>
      model[flag] === true ? inner : "",
    )
    .replace(/\{(\w+)\}/g, (_, key: string) => String(model[key]));
}

export function operatSections(model: Readonly<Record<string, unknown>>): string[] {
  return OPERAT_SECTION_TEMPLATES.map((t) => resolveOperatSection(t, model));
}
