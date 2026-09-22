/**
 * Wklejanie treści księgi z przeglądarki KW (ADR-021 reg. 2). Każda zakładka
 * eKW to osobna strona, więc rzeczoznawca wkleja 1–5 razy; my liczymy, które
 * działy już są. Regex zamiast DOMParser: moduł ma być czysty (F-10) i
 * testowalny w node, a tabele eKW są proste (bez zagnieżdżeń).
 */
export const KODY_DZIALOW = ["I-O", "I-Sp", "II", "III", "IV"] as const;
export type KodDzialu = (typeof KODY_DZIALOW)[number];
export const MAX_TEKST_BAJTOW = 200 * 1024;

const ENCJE: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function odkoduj(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e: string) => ENCJE[e]!);
}

const SPACJE = /[ \t ]+/g;

/** Tagi precz, białe znaki zbite — BEZ dekodowania encji (to robi `zbij`). */
const bezTagow = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(SPACJE, " ")
    .trim();

/**
 * Dekodowanie jest JEDNOKROTNE i dzieje się dopiero na gotowej linii: eKW
 * potrafi przysłać `&amp;nbsp;`, czyli tekst „&nbsp;”, a nie spację — druga
 * runda zamieniłaby cudzą treść na coś, czego w księdze nie ma.
 */
const zbij = (s: string) => odkoduj(bezTagow(s)).replace(SPACJE, " ").trim();

/** Wiersze `<tr>` na „td | td | td”; reszta HTML jako tekst z łamaniami po blokach. */
export function htmlNaTekst(html: string): string {
  const bezGlowy = html.replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, "");
  const zWierszami = bezGlowy.replace(/<tr[\s\S]*?<\/tr>/gi, (row) => {
    const komorki = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      bezTagow(m[1]!),
    );
    return `\n${komorki.join(" | ")}\n`;
  });
  return (
    zWierszami
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|table|tbody)>/gi, "\n")
      .split("\n")
      .map(zbij)
      // Puste linie znikają w całości: układ HTML-a eKW nie niesie znaczenia, a
      // odstęp między kolejnymi wklejeniami wstawia `dopiszWklejenie`.
      .filter((linia) => linia !== "")
      .join("\n")
      .trim()
  );
}

export function dopiszWklejenie(dotychczas: string, fragment: string): string {
  const baza = dotychczas.trimEnd();
  return baza === "" ? fragment.trim() : `${baza}\n\n${fragment.trim()}`;
}

/**
 * „DZIAŁ III” przed „DZIAŁ II” w alternatywie, inaczej „II” zjadłoby początek
 * numeru rzymskiego dłuższego działu. `\b` domyka to od drugiej strony.
 */
const NAGLOWEK_DZIALU = /DZIA[ŁL]\s+(I-O|I-SP|III|IV|II)\b/gi;
const KOD: Record<string, KodDzialu> = {
  "I-O": "I-O",
  "I-SP": "I-Sp",
  II: "II",
  III: "III",
  IV: "IV",
};

export function dzialyWTekscie(tekst: string): KodDzialu[] {
  const znalezione = new Set(
    [...tekst.matchAll(NAGLOWEK_DZIALU)].map((m) => KOD[m[1]!.toUpperCase()]!),
  );
  return KODY_DZIALOW.filter((k) => znalezione.has(k));
}

export function brakujaceDzialy(tekst: string): KodDzialu[] {
  const sa = new Set(dzialyWTekscie(tekst));
  return KODY_DZIALOW.filter((k) => !sa.has(k));
}

/** „III i IV”, „I-O, III i IV”. */
export function listaDzialow(kody: readonly KodDzialu[]): string {
  if (kody.length <= 1) return kody[0] ?? "";
  return `${kody.slice(0, -1).join(", ")} i ${kody[kody.length - 1]}`;
}
