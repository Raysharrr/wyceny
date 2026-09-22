/**
 * Nazwy klas niezgodności walidatora po polsku (spec §6, słownik do akceptacji
 * w PR) i podpisy pod polami karty (makieta 4). Klasa nigdy nie niesie
 * wartości z księgi (F-13), więc i nazwa jej nie niesie.
 */
import { jestKsiegaGruntu, type KsiegaTresc } from "./kw-tresc";
import { listaDzialow, type KodDzialu } from "./kw-wklej";

export type Niezgodnosc = { klasa: string; dzial?: string };

/** Która z dwóch kart kroku 1 przyjęła treść. */
export type KartaKsiegi = "lokal" | "grunt";

/**
 * Czyja jest cyfra kontrolna. `numerKsiegi` to numer WŁASNY przepisanej
 * księgi, więc nazywa go karta, na której stoi baner: na karcie gruntu to
 * „numer księgi gruntu”, nie lokalu (F1 recenzji całości KW — mapa nazywała
 * go lokalowym bezwarunkowo). `kwLokalu` i `kwGruntu` to pola samej karty
 * lokalu — dla księgi gruntu walidator ich nie liczy — więc mówią same za
 * siebie i od karty nie zależą.
 */
const KSIEGA: Record<string, string> = {
  kwLokalu: "lokalu",
  kwGruntu: "gruntu",
};

function czyjaKsiega(pole: string, ksiega: KartaKsiegi): string {
  if (pole === "numerKsiegi") return ksiega === "grunt" ? "gruntu" : "lokalu";
  return KSIEGA[pole] ?? "lokalu";
}
const RODZAJ: Record<string, string> = {
  grunt_na_lokalu: "rodzaj księgi (treść opisuje nieruchomość gruntową, a to karta księgi lokalu)",
  lokal_na_gruncie:
    "rodzaj księgi (treść nie opisuje nieruchomości gruntowej, a to karta księgi gruntu)",
};
const POLE: Record<string, string> = {
  kwGruntu: "numer księgi gruntu",
  kwLokalu: "numer księgi lokalu",
  numerLokalu: "numer lokalu",
  udzial: "udział w nieruchomości wspólnej",
  repA: "numer Rep. A aktu",
};

export function nazwaNiezgodnosci(b: Niezgodnosc, ksiega: KartaKsiegi): string {
  const [rodzaj, pole = ""] = b.klasa.split(":");
  switch (rodzaj) {
    case "kw_cyfra_kontrolna":
      return `cyfra kontrolna numeru księgi ${czyjaKsiega(pole, ksiega)}`;
    case "pesel_suma":
      return `numer PESEL w dziale ${b.dzial ?? "II"}`;
    case "rodzaj_ksiegi":
      return RODZAJ[pole] ?? b.klasa;
    case "pole_niezgodne":
      return POLE[pole] ?? b.klasa;
    case "brak_wpisow_niespojny":
      return `oznaczenie „brak wpisów” w dziale ${b.dzial ?? "?"}`;
    case "rubryka_separator":
      return `pusta rubryka w dziale ${b.dzial ?? "?"}`;
    case "dzialy_niekompletne":
      return `brak działu ${b.dzial ?? "?"}`;
    default:
      return b.klasa;
  }
}

/**
 * Nazwy do banera i markera podglądu. Worker zgłasza `dzialy_niekompletne`
 * OSOBNO dla każdego brakującego działu (plan workera Task 3); tu składają
 * się w jedną nazwę „brak działów III i IV”, w kolejności eKW.
 */
export function nazwyNiezgodnosci(bledy: Niezgodnosc[], ksiega: KartaKsiegi): string[] {
  const brakujace = bledy
    .filter((b) => b.klasa === "dzialy_niekompletne")
    .map((b) => b.dzial ?? "?");
  const reszta = bledy
    .filter((b) => b.klasa !== "dzialy_niekompletne")
    .map((b) => nazwaNiezgodnosci(b, ksiega));
  if (brakujace.length === 0) return reszta;
  const lista =
    brakujace.length === 1
      ? `brak działu ${brakujace[0]}`
      : `brak działów ${listaDzialow(brakujace as KodDzialu[])}`;
  return [...reszta, lista];
}

export type PoleKarty = "kwLokalu" | "kwGruntu" | "nrLokalu" | "udzial" | "rep";

const CYFRA = "Cyfra kontrolna nie zgadza się z numerem."; // makieta 4
// NOWY TEKST (do akceptacji w PR) — makieta 4 pokazuje tylko udział i cyfrę kontrolną.
const PODPIS: Record<string, [PoleKarty, string]> = {
  "kw_cyfra_kontrolna:numerKsiegi": ["kwLokalu", CYFRA],
  "kw_cyfra_kontrolna:kwLokalu": ["kwLokalu", CYFRA],
  "kw_cyfra_kontrolna:kwGruntu": ["kwGruntu", CYFRA],
  "pole_niezgodne:udzial": ["udzial", "W dziale I-Sp księga podaje inny udział."], // makieta 4
  "pole_niezgodne:kwGruntu": ["kwGruntu", "W dziale I-Sp księga podaje inny numer księgi gruntu."],
  "pole_niezgodne:kwLokalu": ["kwLokalu", "Nagłówek księgi podaje inny numer."],
  "pole_niezgodne:numerLokalu": ["nrLokalu", "W dziale I-O księga podaje inny numer lokalu."],
  "pole_niezgodne:repA": ["rep", "W dziale II księga podaje inny numer Rep. A."],
  // Podpis siada pod polem numeru TEJ karty, na którą wklejono treść: karta
  // lokalu czyta `kwLokalu` (kw-section 1309), karta gruntu `kwGruntu` (1478).
  "rodzaj_ksiegi:grunt_na_lokalu": ["kwLokalu", "Sprawdź, czy wklejono właściwą księgę."],
  "rodzaj_ksiegi:lokal_na_gruncie": ["kwGruntu", "Sprawdź, czy wklejono właściwą księgę."],
};

export function podpisyPol(bledy: Niezgodnosc[]): Partial<Record<PoleKarty, string>> {
  const out: Partial<Record<PoleKarty, string>> = {};
  for (const b of bledy) {
    const wpis = PODPIS[b.klasa];
    if (wpis) out[wpis[0]] ??= wpis[1];
  }
  return out;
}

/**
 * Niezgodność, której worker zobaczyć nie może: on zna tylko rodzaj księgi
 * z nagłówka, a na KTÓRĄ kartę treść wklejono, wie wyłącznie web. Bez tej
 * reguły księga gruntu wklejona na kartę lokalu wraca z `ok:true` (worker
 * pomija dla niej reguły lokalowe, 1f20f8c) i nic nie ostrzega rzeczoznawcy.
 *
 * Rodzaju NIE ZGADUJEMY: nagłówek bez rodzaju (albo pusty) nie daje
 * niezgodności — tak samo jak worker nie uznaje go za księgę gruntu.
 * Werdykt zostaje ostrzeżeniem, nie blokadą (ADR-021 reg. 5).
 */
export function rodzajNiezgodny(tresc: KsiegaTresc, karta: KartaKsiegi): Niezgodnosc | null {
  const rodzaj = tresc.naglowek.rodzajKsiegi?.trim();
  if (!rodzaj) return null;
  const grunt = jestKsiegaGruntu(rodzaj);
  if (karta === "lokal" && grunt) return { klasa: "rodzaj_ksiegi:grunt_na_lokalu" };
  if (karta === "grunt" && !grunt) return { klasa: "rodzaj_ksiegi:lokal_na_gruncie" };
  return null;
}
