import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/**
 * Atrapa `/kw-transcribe` w PRZEGLĄDARCE (`page.route`), nie w workerze: CI
 * uruchamia prawdziwy worker bez klucza Anthropic, a od ADR-021 księgę bada
 * się WYŁĄCZNIE przepisując jej treść — bez tej atrapy krok 7 blokuje na B-06.
 *
 * Treść to syntetyczna księga workera (fikcyjne osoby, poprawne cyfry
 * kontrolne), czytana W MIEJSCU: numery KW nie mogą stać literałem w pliku
 * śledzonym (F-9). Wiersze §8.2 są dla obu ksiąg takie same, ale RODZAJ
 * księgi w nagłówku już nie: fikstura opisuje księgę LOKALU, a web sprawdza
 * rodzaj wobec karty, na którą treść wklejono. Podanie jej na kartę gruntu
 * daje — słusznie — niezgodność „rodzaj księgi", więc karta gruntu dostaje
 * `RODZAJ_GRUNTU` (`rodzajAtrapy`).
 */
const FIXTURE = path.join(
  process.cwd(),
  "..",
  "worker",
  "tests",
  "fixtures",
  "kw_transcribe_sample.json",
);

export type WariantAtrapy = "ok" | "walidacja" | "blad";

/** Rodzaj z nagłówka księgi gruntowej — jedna z trzech pisowni eKW. */
export const RODZAJ_GRUNTU = "NIERUCHOMOŚĆ GRUNTOWA";

type KsiegaZAtrapy = {
  naglowek: {
    numerKsiegi: string;
    sad: string | null;
    wydzial: string | null;
    rodzajKsiegi: string | null;
  };
  dzialy: Array<{ kod: string; tytul: string }>;
  polaDodatkowe: {
    numerLokalu: string | null;
    kwGruntu: string | null;
    udzial: string | null;
    podstawaNabycia: { tytulAktu: string | null; repA: string | null } | null;
  };
} & Record<string, unknown>;

export function ksiegaZAtrapy(): KsiegaZAtrapy {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as KsiegaZAtrapy;
}

/** Same nagłówki działów wystarczą licznikowi „n z 5”; treść i tak przychodzi z atrapy. */
export function tekstZakladek(kody = ["I-O", "I-Sp", "II", "III", "IV"]): string {
  return ksiegaZAtrapy()
    .dzialy.filter((d) => kody.includes(d.kod))
    .map((d) => `${d.tytul}\nRubryka | wartość | 1`)
    .join("\n\n");
}

/**
 * `rodzajAtrapy` nadpisuje rodzaj księgi w nagłówku — karta gruntu musi dostać
 * księgę gruntową. Każde wywołanie zdejmuje poprzednią atrapę, żeby przełączenie
 * rodzaju między kartami było przełączeniem, a nie warstwą na warstwie.
 */
export async function atrapaTranskrypcji(
  page: Page,
  wariant: WariantAtrapy = "ok",
  rodzajAtrapy?: string,
): Promise<void> {
  await page.unroute("**/kw-transcribe");
  await page.route("**/kw-transcribe", async (route) => {
    if (wariant === "blad") {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ code: "kw_transkrypcja_blad" }),
      });
      return;
    }
    const ksiega = ksiegaZAtrapy();
    if (rodzajAtrapy !== undefined) ksiega.naglowek.rodzajKsiegi = rodzajAtrapy;
    const walidacja =
      wariant === "ok"
        ? { ok: true, bledy: [] }
        : {
            ok: false,
            bledy: [
              { klasa: "pole_niezgodne:udzial", dzial: "I-Sp" },
              { klasa: "kw_cyfra_kontrolna:kwGruntu" },
            ],
          };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...ksiega, walidacja }),
    });
  });
}
