/**
 * Nazwy klas niezgodności walidatora po polsku (spec §6, słownik do akceptacji
 * w PR) i podpisy pod polami karty (makieta 4). Klasa nigdy nie niesie
 * wartości z księgi (F-13), więc i nazwa jej nie niesie.
 */
import { listaDzialow, type KodDzialu } from "./kw-wklej";

export type Niezgodnosc = { klasa: string; dzial?: string };

const KSIEGA: Record<string, string> = {
  numerKsiegi: "lokalu",
  kwLokalu: "lokalu",
  kwGruntu: "gruntu",
};
const POLE: Record<string, string> = {
  kwGruntu: "numer księgi gruntu",
  kwLokalu: "numer księgi lokalu",
  numerLokalu: "numer lokalu",
  udzial: "udział w nieruchomości wspólnej",
  repA: "numer Rep. A aktu",
};

export function nazwaNiezgodnosci(b: Niezgodnosc): string {
  const [rodzaj, pole = ""] = b.klasa.split(":");
  switch (rodzaj) {
    case "kw_cyfra_kontrolna":
      return `cyfra kontrolna numeru księgi ${KSIEGA[pole] ?? "lokalu"}`;
    case "pesel_suma":
      return `numer PESEL w dziale ${b.dzial ?? "II"}`;
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
export function nazwyNiezgodnosci(bledy: Niezgodnosc[]): string[] {
  const brakujace = bledy
    .filter((b) => b.klasa === "dzialy_niekompletne")
    .map((b) => b.dzial ?? "?");
  const reszta = bledy.filter((b) => b.klasa !== "dzialy_niekompletne").map(nazwaNiezgodnosci);
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
};

export function podpisyPol(bledy: Niezgodnosc[]): Partial<Record<PoleKarty, string>> {
  const out: Partial<Record<PoleKarty, string>> = {};
  for (const b of bledy) {
    const wpis = PODPIS[b.klasa];
    if (wpis) out[wpis[0]] ??= wpis[1];
  }
  return out;
}
