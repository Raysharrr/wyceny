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
const PP_PROCEDURE = [
  "Utworzenie zbioru nieruchomości podobnych, o znanych cenach transakcyjnych i cechach, stanowiącego podstawę wyceny,",
  "Aktualizacja cen transakcyjnych na datę wyceny,",
  "Ustalenie cech rynkowych wpływających w sposób zasadniczy na zróżnicowanie cen na rynku nieruchomości,",
  "Ocena wielkości wpływu cech rynkowych na zróżnicowanie cen transakcyjnych,",
  "Ustalenie zakresu skali dla każdej z przyjętych cech rynkowych,",
  "Wybór do porównań z utworzonego zbioru nieruchomości, co najmniej trzech nieruchomości najbardziej podobnych pod względem cech rynkowych do nieruchomości stanowiącej przedmiot wyceny, z ich niezbędną charakterystyką,",
  "Charakterystyka wycenianej nieruchomości z przedstawieniem jej ocen w odniesieniu do przyjętej skali cech rynkowych,",
  "Przeprowadzenie porównań nieruchomości wycenianej kolejno z nieruchomościami wybranymi do wyceny i określenie wielkości poprawek wynikających z różnicy ocen nieruchomości wycenianej i nieruchomości wybranych do porównań,",
  "Obliczenie skorygowanej ceny transakcyjnej każdej nieruchomości przyjętej do porównań przy użyciu określonych poprawek,",
  "Obliczenie wartości jednostkowej wycenianej nieruchomości jako średniej arytmetycznej z cen transakcyjnych skorygowanych, uzyskanych z porównań w poszczególnych parach, lub średniej ważonej, jeśli wiarygodność otrzymanych wyników jest zróżnicowana,",
  "Określenie wartości wycenianej nieruchomości na podstawie iloczynu wartości jednostkowej i liczby jednostek porównawczych (np. m2 powierzchni gruntu, budynku czy lokalu).",
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
      // Common list AND all three definitions, as in every client operat
      // (16 of 16, E2E 13.09); only the choice sentence and procedure vary.
      blocks.slice(248, 257).join("") +
      // The choice sentence is common; only the method name varies.
      blocks[257].replace(">korygowania ceny średniej<", ">{metoda_nazwa}<") +
      blocks[258] +
      p("{#metoda_kcs}") +
      blocks.slice(259, 276).join("") +
      p("{/metoda_kcs}") +
      p("{#metoda_pp}") +
      // Client PP operats: the PKZW Nota Interpretacyjna nr 1 procedure,
      // same heading and list formatting as the KCS one.
      blocks[259].replace(
        ">Procedura metody korygowania ceny średniej<",
        ">Procedura metody porównywania parami<",
      ) +
      PP_PROCEDURE.map((item) =>
        blocks[260].replace(/<w:t>[^<]*<\/w:t>/, `<w:t>${item}</w:t>`),
      ).join("") +
      p("{/metoda_pp}");
    i = 275;
    continue;
  }
  if (i === 323) output += p("{#metoda_kcs}");
  if (i === 395) output += p("{/metoda_kcs}") + p("{#metoda_pp}") + pp + p("{/metoda_pp}");
  let block = blocks[i];
  if (i === 285 || i === 298) block = block.replace(/korygowania ceny średniej/g, "{metoda_nazwa}");
  if (i === 356) {
    block = block.replace(">100<", ">{suma_wag}<").replace(">1,000<", ">{suma_ui_sr}<");
    // The original 716-twip weight column splits 40,25% in Linux LibreOffice.
    // Keep the 8961-twip table and feature/subject columns; take space from
    // the three short coefficient columns. Update both grid and cell widths,
    // including the four-column merged heading (5906 -> 5422).
    const widths: Record<string, number> = {
      "716": 1200,
      "1489": 1300,
      "1347": 1200,
      "1358": 1210,
      "5906": 5422,
    };
    block = block.replace(/(<w:(?:gridCol|tcW) w:w=")(\d+)(")/g, (tag, before, width, after) =>
      widths[width] ? `${before}${widths[width]}${after}` : tag,
    );
  }
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
