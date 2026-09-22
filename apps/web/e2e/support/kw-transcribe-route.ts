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
 * śledzonym (F-9). Dla księgi gruntu ta sama treść wystarcza — gruntu nie
 * odczytujemy polami, a wiersze §8.2 są takie same.
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

type KsiegaZAtrapy = {
  naglowek: { numerKsiegi: string; sad: string | null; wydzial: string | null };
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

export async function atrapaTranskrypcji(page: Page, wariant: WariantAtrapy = "ok"): Promise<void> {
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
