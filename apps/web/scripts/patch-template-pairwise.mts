/** Deterministic S4 patch. Always derives from frozen 9b template; never updates legacy. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { PP_CALCULATION_SECTIONS } from "../src/domain/operat-sections";
const legacy = fs.readFileSync("templates/operat-szablon-legacy-kcs.docx");
if (
  createHash("sha256").update(legacy).digest("hex") !==
  "5e43f7b885cb8ba444ad211e0349ae36f1a3875d8e28635d1b27f4f6a293572a"
)
  throw Error("Legacy baseline changed");
const zip = new PizZip(legacy);
const source = zip.file("word/document.xml")!.asText();
const start = source.indexOf("<w:body>") + 8;
const end = source.indexOf("</w:body>");
const body = source.slice(start, end);
// Preserve exact bytes of every untouched top-level element, including drawings.
const blocks: string[] = [];
let depth = 0,
  begin = 0;
for (const match of body.matchAll(/<[^>]+>/g)) {
  const tag = match[0];
  if (tag.startsWith("</")) depth--;
  else if (!tag.endsWith("/>") && !tag.startsWith("<?")) depth++;
  if (depth === 0) {
    blocks.push(body.slice(begin, match.index! + tag.length));
    begin = match.index! + tag.length;
  }
}
if (!blocks[234].includes("10. Metodologia") || !blocks[395].includes("Uzasadnienie"))
  throw Error("Unexpected frozen template structure");
const p = (text: string, heading = false) =>
  `<w:p><w:pPr>${heading ? "<w:keepNext/>" : ""}<w:spacing w:after="100"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${heading ? "<w:b/>" : ""}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text: string, width = 1200) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:after="70" w:before="70"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
const row = (values: string[], header = false, width = 1200) =>
  `<w:tr><w:trPr><w:cantSplit/>${header ? "<w:tblHeader/>" : ""}</w:trPr>${values.map((value) => cell(value, width)).join("")}</w:tr>`;
const cols = Array.from({ length: 5 }, (_, i) => String(i + 1));
const table = (marker: string, headers: string[], rows: string[][]) =>
  `<w:tbl><w:tblPr><w:tblCaption w:val="${marker}"/><w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((edge) => `<w:${edge} w:val="single" w:sz="4" w:color="888888"/>`).join("")}</w:tblBorders></w:tblPr><w:tblGrid>${headers.map(() => `<w:gridCol w:w="${marker === "pp-result" ? 4500 : 1200}"/>`).join("")}</w:tblGrid>${row(headers, true, marker === "pp-result" ? 4500 : 1200)}${rows.map((r) => row(r, false, marker === "pp-result" ? 4500 : 1200)).join("")}</w:tbl>`;
const loop = (name: string, fixed: string[]) => [
  `{#${name}}${fixed[0]}`,
  ...fixed.slice(1),
  ...cols.map((n, i) => `{c${n}}${i === 4 ? `{/` + name + `}` : ""}`),
];
const pp = [
  p("Tabela 1. Charakterystyka wybranych nieruchomości lokalowych o funkcji mieszkalnej", true),
  table(
    "pp-dynamic-2",
    ["Cecha", "Przedmiot", ...cols],
    [loop("pp_rows", ["{label}", "{subject}"])],
  ),
  p(PP_CALCULATION_SECTIONS[0], true),
  p(
    "Rozstęp cen wybranych transakcji ΔC = {pp_spread} zł/m². Zakres kwotowy cechy = ΔC × waga. Poprawka = zakres × przyjęty mnożnik.",
  ),
  p("Tabela 2. Porównanie nieruchomości wycenianej z nieruchomościami podobnymi", true),
  table(
    "pp-dynamic-3",
    ["Cecha", "Waga [%]", "Zakres [zł/m²]", ...cols],
    [loop("pp_corrections", ["{label}", "{weight}", "{range}"])],
  ),
  p("{#pp_overrides}"),
  p("{.}"),
  p("{/pp_overrides}"),
  p(
    "Tabela 3. Obliczenie skorygowanej ceny transakcyjnej każdego lokalu mieszkalnego przyjętego do porównań przy użyciu określonych poprawek",
    true,
  ),
  table("pp-dynamic-1", ["Cena / poprawka", ...cols], [loop("pp_prices", ["{label}"])]),
  p("Średnia arytmetyczna cen skorygowanych: {cena_1m2} zł/m²."),
  p(PP_CALCULATION_SECTIONS[1], true),
  p("Tabela 4. Określenie wartości rynkowej {przedmiot_d}", true),
  table(
    "pp-result",
    ["Wielkość", "Wartość"],
    [
      ["Średnia cena skorygowana [zł/m²]", "{cena_1m2}"],
      ["Powierzchnia użytkowa [m²]", "{powierzchnia}"],
      ["Wartość przed zaokrągleniem [zł]", "{wr_dokladna}"],
      ["Wartość po zaokrągleniu [zł]", "{wr}"],
      ["Słownie", "{wr_slownie}"],
    ],
  ),
  p(
    "Obliczenia wykonano z pełną precyzją; wartości w tabelach przedstawiono do dwóch miejsc po przecinku. Końcową wartość zaokrąglono do 100 zł.",
  ),
  blocks[332],
  p("Źródło: Opracowanie własne."),
].join("");
let output = "";
for (let i = 0; i < blocks.length; i++) {
  if (i === 248) {
    output +=
      blocks.slice(248, 253).join("") +
      p("{#metoda_kcs}") +
      blocks[254] +
      blocks.slice(257, 276).join("") +
      p("{/metoda_kcs}") +
      p("{#metoda_pp}") +
      blocks[253] +
      p(
        "Dla określenia wartości rynkowej {przedmiot_d} zastosowano podejście porównawcze, metodę porównywania parami.",
      ) +
      p(
        "Liczba transakcji przyjętych do porównań: {pp_count}. Oceniono cechy przedmiotu i każdego porównania na przyjętych skalach. Poprawki kwotowe wynikają z rozstępu cen, wag cech i mnożników przyjętych przez rzeczoznawcę. Dodatnia poprawka oznacza przewagę przedmiotu nad porównaniem. Cenę każdego porównania skorygowano o sumę poprawek; średnią cen skorygowanych pomnożono przez powierzchnię przedmiotu.",
      ) +
      p("{/metoda_pp}");
    i = 275;
    continue;
  }
  if (i === 323) output += p("{#metoda_kcs}");
  if (i === 395) output += p("{/metoda_kcs}") + p("{#metoda_pp}") + pp + p("{/metoda_pp}");
  let block = blocks[i];
  if (i === 285 || i === 298) block = block.replace(/korygowania ceny średniej/g, "{metoda_nazwa}");
  if (i === 356)
    block = block.replace(">100<", ">{suma_wag}<").replace(">1,000<", ">{suma_ui_sr}<");
  output += block;
  if (i === 357)
    output += p(
      "{#skala_mieszana}Kreska w kolumnie środkowej oznacza brak oceny pośredniej w skali dwupoziomowej. Suma środkowa nie jest określona dla zestawu zawierającego taką skalę.{/skala_mieszana}",
    );
}
const xml = source.slice(0, start) + output + source.slice(end);
const target = "templates/operat-szablon.docx";
if (
  fs.existsSync(target) &&
  new PizZip(fs.readFileSync(target)).file("word/document.xml")!.asText() === xml
)
  console.log("Already patched");
else {
  zip.file("word/document.xml", xml);
  fs.writeFileSync(target, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log("Patched");
}
