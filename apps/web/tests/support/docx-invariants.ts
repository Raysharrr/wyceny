import { expect } from "vitest";
// @ts-expect-error -- jsdom (devDependency) nie ma w repo typów; bierzemy z niego tylko DOMParser.
import { JSDOM } from "jsdom";
import PizZip from "pizzip";

/**
 * Warstwa `docx-invariants` (spec operat-bugfix §7.1): asercje na XML DOCX zamiast na
 * tekście z pozdejmowanymi znacznikami. Czyta `word/document.xml`, `styles.xml`,
 * `theme1.xml` i relacje obrazów parserem XML, więc widzi, GDZIE stoi tekst — w body,
 * w tabeli albo w jednej z dwóch kopii pola tekstowego (`mc:Choice` i fallback VML) —
 * i czy go NIE MA. Paczka z P4 rozszerza `effectiveRunFormat` o resztę formatowania.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const V = "urn:schemas-microsoft-com:vml";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Precedencja: wnętrze `txbxContent` > komórka tabeli > body (tabela w polu tekstowym to pole). */
export type DocxContainer = "body" | "table" | "txbx-choice" | "txbx-vml";

/** Formatowanie jednego poziomu łańcucha (run, styl, docDefaults) — tylko krój i rozmiar. */
export type RunProps = { ascii: string | null; asciiTheme: string | null; szHalfPt: number | null };

export type DocxRun = {
  text: string;
  /** Indeks akapitu w `DocxDoc.paragraphs`. */
  paragraph: number;
  rStyle: string | null;
  /** Formatowanie bezpośrednie z `w:rPr` runu (nie z `w:pPr/w:rPr` — to znak akapitu). */
  props: RunProps;
};

export type DocxParagraph = {
  index: number;
  /** Tekst z `w:t` (`w:tab` → `\t`, `w:br`/`w:cr` → `\n`); bez `w:instrText` i `w:delText`. */
  text: string;
  /** `w:pStyle` albo `null` dla gołego `<w:p>`. */
  style: string | null;
  container: DocxContainer;
  runs: DocxRun[];
};

export type DocxTextbox = { copy: "choice" | "vml"; paragraphs: DocxParagraph[]; text: string };

export type DocxImage = { paragraph: number; rId: string; target: string | null };

export type DocxStyle = {
  id: string;
  type: string;
  name: string | null;
  basedOn: string | null;
  props: RunProps;
};

export type DocxStyles = {
  byId: Record<string, DocxStyle>;
  /** Styl akapitu z `w:default="1"` (w szablonie `Normalny`). */
  defaultParagraph: string | null;
  docDefaults: RunProps;
  theme: { major: string | null; minor: string | null };
};

export type DocxDoc = {
  /** Wszystkie akapity w kolejności dokumentu, łącznie z oboma kopiami pola tekstowego. */
  paragraphs: DocxParagraph[];
  runs: DocxRun[];
  textboxes: DocxTextbox[];
  images: DocxImage[];
  styles: DocxStyles;
};

let domParser: DOMParser | null = null;

function parseXml(xml: string): Document {
  const parser: DOMParser = (domParser ??= new new JSDOM("").window.DOMParser());
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("docx-invariants: niepoprawny XML w pliku DOCX");
  }
  return doc;
}

const isW = (node: Node | null, localName: string): node is Element =>
  node != null &&
  node.nodeType === 1 &&
  (node as Element).namespaceURI === W &&
  (node as Element).localName === localName;

const wChild = (el: Element | null, localName: string): Element | null =>
  el == null ? null : (Array.from(el.children).find((c) => isW(c, localName)) ?? null);

const wAttr = (el: Element | null, name: string): string | null =>
  el == null ? null : el.getAttributeNS(W, name) || null;

/** Najbliższy przodek `w:<localName>` (bez samego elementu). */
function closestW(el: Element, localName: string): Element | null {
  for (let n = el.parentNode; n != null; n = n.parentNode) {
    if (isW(n, localName)) return n;
  }
  return null;
}

function runProps(rPr: Element | null): RunProps {
  const fonts = wChild(rPr, "rFonts");
  const sz = wAttr(wChild(rPr, "sz"), "val");
  return {
    ascii: wAttr(fonts, "ascii"),
    asciiTheme: wAttr(fonts, "asciiTheme"),
    szHalfPt: sz == null ? null : Number(sz),
  };
}

function containerOf(p: Element): DocxContainer {
  let inTable = false;
  for (let n = p.parentNode; n != null; n = n.parentNode) {
    if (isW(n, "txbxContent")) {
      return (n.parentNode as Element | null)?.namespaceURI === V ? "txbx-vml" : "txbx-choice";
    }
    if (isW(n, "tc")) inTable = true;
  }
  return inTable ? "table" : "body";
}

function runText(r: Element): string {
  let text = "";
  for (const child of Array.from(r.children)) {
    if (isW(child, "t")) text += child.textContent ?? "";
    else if (isW(child, "tab")) text += "\t";
    else if (isW(child, "br") || isW(child, "cr")) text += "\n";
  }
  return text;
}

function readStyles(zip: PizZip): DocxStyles {
  const theme = { major: null as string | null, minor: null as string | null };
  const themeFile = zip.file("word/theme/theme1.xml");
  if (themeFile) {
    const t = parseXml(themeFile.asText());
    const latin = (fontTag: string) =>
      t
        .getElementsByTagNameNS(A, fontTag)[0]
        ?.getElementsByTagNameNS(A, "latin")[0]
        ?.getAttribute("typeface") ?? null;
    theme.major = latin("majorFont");
    theme.minor = latin("minorFont");
  }

  const styles: DocxStyles = {
    byId: {},
    defaultParagraph: null,
    docDefaults: runProps(null),
    theme,
  };
  const stylesFile = zip.file("word/styles.xml");
  if (!stylesFile) return styles;

  const s = parseXml(stylesFile.asText());
  const rPrDefault = s.getElementsByTagNameNS(W, "rPrDefault")[0] ?? null;
  styles.docDefaults = runProps(wChild(rPrDefault, "rPr"));
  for (const el of Array.from(s.getElementsByTagNameNS(W, "style"))) {
    const id = wAttr(el, "styleId");
    if (id == null) continue;
    const type = wAttr(el, "type") ?? "paragraph";
    styles.byId[id] = {
      id,
      type,
      name: wAttr(wChild(el, "name"), "val"),
      basedOn: wAttr(wChild(el, "basedOn"), "val"),
      props: runProps(wChild(el, "rPr")),
    };
    if (type === "paragraph" && (wAttr(el, "default") === "1" || wAttr(el, "default") === "true")) {
      styles.defaultParagraph = id;
    }
  }
  return styles;
}

function readRels(zip: PizZip): Map<string, string> {
  const rels = new Map<string, string>();
  const file = zip.file("word/_rels/document.xml.rels");
  if (!file) return rels;
  for (const rel of Array.from(
    parseXml(file.asText()).getElementsByTagNameNS(PKG_REL, "Relationship"),
  )) {
    rels.set(rel.getAttribute("Id") ?? "", rel.getAttribute("Target") ?? "");
  }
  return rels;
}

export function openDocx(buffer: Buffer | Uint8Array): DocxDoc {
  const zip = new PizZip(buffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("docx-invariants: brak word/document.xml");
  const xml = parseXml(documentFile.asText());
  const rels = readRels(zip);

  const paragraphs: DocxParagraph[] = [];
  const elements = Array.from(xml.getElementsByTagNameNS(W, "p"));
  const byElement = new Map<Element, DocxParagraph>();
  for (const p of elements) {
    const paragraph: DocxParagraph = {
      index: paragraphs.length,
      text: "",
      style: wAttr(wChild(wChild(p, "pPr"), "pStyle"), "val"),
      container: containerOf(p),
      runs: [],
    };
    paragraphs.push(paragraph);
    byElement.set(p, paragraph);
  }

  // Run i obraz należą do NAJBLIŻSZEGO akapitu — dzięki temu akapit, w którym osadzono
  // pole tekstowe, nie wchłania tekstu z `txbxContent`.
  for (const r of Array.from(xml.getElementsByTagNameNS(W, "r"))) {
    const owner = closestW(r, "p");
    const paragraph = owner && byElement.get(owner);
    if (!paragraph) continue;
    paragraph.runs.push({
      text: runText(r),
      paragraph: paragraph.index,
      rStyle: wAttr(wChild(wChild(r, "rPr"), "rStyle"), "val"),
      props: runProps(wChild(r, "rPr")),
    });
  }
  for (const paragraph of paragraphs) paragraph.text = paragraph.runs.map((r) => r.text).join("");

  const images: DocxImage[] = [];
  const blips = Array.from(xml.getElementsByTagNameNS(A, "blip")).map(
    (el) => [el, el.getAttributeNS(R, "embed")] as const,
  );
  const vmlImages = Array.from(xml.getElementsByTagNameNS(V, "imagedata")).map(
    (el) => [el, el.getAttributeNS(R, "id")] as const,
  );
  for (const [el, rId] of [...blips, ...vmlImages]) {
    const owner = closestW(el, "p");
    const paragraph = owner && byElement.get(owner);
    if (!paragraph || !rId) continue;
    images.push({ paragraph: paragraph.index, rId, target: rels.get(rId) ?? null });
  }
  images.sort((a, b) => a.paragraph - b.paragraph);

  const textboxes: DocxTextbox[] = Array.from(xml.getElementsByTagNameNS(W, "txbxContent")).map(
    (content) => {
      const inside = paragraphs.filter(
        (p) => closestW(elements[p.index], "txbxContent") === content,
      );
      return {
        copy: (content.parentNode as Element | null)?.namespaceURI === V ? "vml" : "choice",
        paragraphs: inside,
        text: inside.map((p) => p.text).join("\n"),
      };
    },
  );

  return {
    paragraphs,
    runs: paragraphs.flatMap((p) => p.runs),
    textboxes,
    images,
    styles: readStyles(zip),
  };
}

/** Twarda spacja → spacja, ciągi białych znaków → jedna spacja. */
const normalize = (s: string) =>
  s
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Do dopasowania fraz: {@link normalize} + małe litery. Zdania szablonu zaczynają się wielką
 * literą, a fraza w teście zwykle nie — asercja „nie ma” wrażliwa na wielkość liter
 * przechodziłaby fałszywie (ta sama klasa błędu co deklinacja w f12-template-integrity).
 */
const fold = (s: string) => normalize(s).toLowerCase();

/**
 * Poziom nagłówka z NUMERU w jego tekście („8.” → 1, „8.4.” → 2), nie ze stylu: w szablonie
 * „8.4.” ma styl `Iza1` jak nagłówki pierwszego poziomu, a „10.1.” nie ma `pStyle` wcale.
 * Nagłówkiem jest akapit body z takim numerem, poza stylami spisu treści („toc N”). Sam numer
 * bez tytułu też jest nagłówkiem: szablon ma „12.4. ” w osobnym akapicie, a tytuł w akapicie
 * listy dalej (D-56) — bez tego §12.3 wchłonęłaby Tabelę 4. Taki nagłówek znajdzie się po
 * samym numerze („12.4.”), nie po tytule.
 */
function headingLevel(doc: DocxDoc, p: DocxParagraph): number | null {
  if (p.container !== "body") return null;
  const styleName = p.style == null ? null : (doc.styles.byId[p.style]?.name ?? null);
  if (styleName != null && /^toc/i.test(styleName)) return null;
  const match = /^(\d+(?:\.\d+)*)\.(?:\s+\S|$)/.exec(normalize(p.text));
  return match ? match[1].split(".").length : null;
}

function findHeading(doc: DocxDoc, heading: string): { paragraph: DocxParagraph; level: number } {
  const wanted = normalize(heading);
  const headings = doc.paragraphs
    .map((paragraph) => ({ paragraph, level: headingLevel(doc, paragraph) }))
    .filter((h): h is { paragraph: DocxParagraph; level: number } => h.level != null);
  const matches = headings.filter((h) => normalize(h.paragraph.text).startsWith(wanted));
  if (matches.length === 0) {
    throw new Error(
      `docx-invariants: Nie znaleziono nagłówka „${heading}”. Nagłówki: ${headings.map((h) => normalize(h.paragraph.text)).join(" | ")}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `docx-invariants: „${heading}” pasuje do kilku nagłówków: ${matches.map((h) => normalize(h.paragraph.text)).join(" | ")}`,
    );
  }
  return matches[0];
}

/**
 * Akapity pod nagłówkiem do następnego nagłówka tego samego albo wyższego poziomu
 * (podsekcje wchodzą do sekcji). Bez kopii VML pola tekstowego — to duplikat `mc:Choice`.
 */
export function sectionParagraphs(doc: DocxDoc, heading: string): DocxParagraph[] {
  const { paragraph, level } = findHeading(doc, heading);
  const result: DocxParagraph[] = [];
  for (const p of doc.paragraphs.slice(paragraph.index + 1)) {
    const l = headingLevel(doc, p);
    if (l != null && l <= level) break;
    if (p.container !== "txbx-vml") result.push(p);
  }
  return result;
}

/** Tekst sekcji: akapity z {@link sectionParagraphs} złączone `\n`. Rzuca, gdy nagłówka nie ma. */
export function sectionText(doc: DocxDoc, heading: string): string {
  return sectionParagraphs(doc, heading)
    .map((p) => p.text)
    .join("\n");
}

function occurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length))
    count++;
  return count;
}

/**
 * Fraza nie występuje w żadnym akapicie — w body, tabelach i OBU kopiach pola tekstowego
 * (dane w samej kopii VML też są w dokumencie). Porównanie bez rozróżniania wielkości liter
 * i po normalizacji białych znaków, w obrębie akapitu. Zamiast dokumentu można podać tekst, np. {@link sectionText}.
 */
export function expectNoText(target: DocxDoc | string, phrase: string): void {
  const wanted = fold(phrase);
  if (typeof target === "string") {
    expect(fold(target), `niedozwolona fraza „${phrase}”`).not.toContain(wanted);
    return;
  }
  const hits = target.paragraphs
    .filter((p) => fold(p.text).includes(wanted))
    .map((p) => `${p.container}#${p.index}: ${normalize(p.text).slice(0, 160)}`);
  expect(hits, `niedozwolona fraza „${phrase}”`).toEqual([]);
}

/**
 * Dokładnie jeden z wariantów występuje dokładnie raz (bez rozróżniania wielkości liter, jak
 * {@link expectNoText}). Pole tekstowe liczone raz (kopia
 * `mc:Choice`; zgodność kopii sprawdza {@link textboxTexts}). Zwraca znaleziony wariant.
 */
export function expectExactlyOne(target: DocxDoc | string, sentinels: string[]): string {
  const texts =
    typeof target === "string"
      ? [fold(target)]
      : target.paragraphs.filter((p) => p.container !== "txbx-vml").map((p) => fold(p.text));
  const counts = sentinels.map((s) => ({
    sentinel: s,
    count: texts.reduce((sum, t) => sum + occurrences(t, fold(s)), 0),
  }));
  expect(
    counts.reduce((sum, c) => sum + c.count, 0),
    `oczekiwany dokładnie jeden z wariantów, wystąpienia: ${counts.map((c) => `„${c.sentinel}” ×${c.count}`).join(", ")}`,
  ).toBe(1);
  return counts.find((c) => c.count === 1)!.sentinel;
}

/**
 * Obraz osadzony w akapicie sekcji (`section`) albo w akapitach przed nagłówkiem
 * (`before`, np. okładka przed „1. Wyciąg…”). Zwraca znalezione obrazy.
 */
export function expectImageInParagraph(
  doc: DocxDoc,
  where: { section: string } | { before: string },
): DocxImage[] {
  const indices =
    "section" in where
      ? new Set(sectionParagraphs(doc, where.section).map((p) => p.index))
      : new Set(
          doc.paragraphs
            .slice(0, findHeading(doc, where.before).paragraph.index)
            .map((p) => p.index),
        );
  const found = doc.images.filter((i) => indices.has(i.paragraph));
  const label = "section" in where ? `w sekcji „${where.section}”` : `przed „${where.before}”`;
  expect(found.length, `brak obrazu ${label}`).toBeGreaterThan(0);
  return found;
}

/** Akapity bez `pStyle` (goły `<w:p>`), opcjonalnie zawężone predykatem. */
export function paragraphsWithoutStyle(
  doc: DocxDoc,
  predicate: (p: DocxParagraph) => boolean = () => true,
): DocxParagraph[] {
  return doc.paragraphs.filter((p) => p.style == null && predicate(p));
}

/** Kopie pola tekstowego osobno, w kolejności dokumentu: `choice[i]` ↔ `vml[i]`. */
export function textboxTexts(doc: DocxDoc): { choice: string[]; vml: string[] } {
  return {
    choice: doc.textboxes.filter((t) => t.copy === "choice").map((t) => t.text),
    vml: doc.textboxes.filter((t) => t.copy === "vml").map((t) => t.text),
  };
}

function styleChain(doc: DocxDoc, id: string | null): RunProps[] {
  const chain: RunProps[] = [];
  const seen = new Set<string>();
  for (
    let s = id == null ? undefined : doc.styles.byId[id];
    s != null && !seen.has(s.id);
    s = s.basedOn == null ? undefined : doc.styles.byId[s.basedOn]
  ) {
    seen.add(s.id);
    chain.push(s.props);
  }
  return chain;
}

/**
 * Efektywny krój (atrybut `ascii`) i rozmiar runu — wersja minimalna łańcucha ze spec §5
 * pkt 4: `rPr` runu → styl znakowy `rStyle` (+ `basedOn`) → styl akapitu (+ `basedOn`;
 * brak albo nieznany `pStyle` → styl domyślny akapitu) → `docDefaults`. Rozstrzygane per
 * atrybut; `asciiTheme` z `theme1.xml`. Styl bez `basedOn` NIE dziedziczy po `Normalny`
 * (tak liczy Word). Bez stylu tabeli i numeracji — to paczka z P4. `null` = nieustalone.
 */
export function effectiveRunFormat(
  doc: DocxDoc,
  run: DocxRun,
): { font: string | null; sizePt: number | null } {
  const pStyle = doc.paragraphs[run.paragraph]?.style ?? null;
  const paragraphStyle =
    pStyle != null && doc.styles.byId[pStyle] ? pStyle : doc.styles.defaultParagraph;
  const chain = [
    run.props,
    ...styleChain(doc, run.rStyle),
    ...styleChain(doc, paragraphStyle),
    doc.styles.docDefaults,
  ];
  const fontLevel = chain.find((p) => p.asciiTheme != null || p.ascii != null);
  const font =
    fontLevel == null
      ? null
      : fontLevel.asciiTheme != null
        ? fontLevel.asciiTheme.startsWith("major")
          ? doc.styles.theme.major
          : doc.styles.theme.minor
        : fontLevel.ascii;
  const size = chain.find((p) => p.szHalfPt != null)?.szHalfPt ?? null;
  return { font, sizePt: size == null ? null : size / 2 };
}
