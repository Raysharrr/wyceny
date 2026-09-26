import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/**
 * Atrapa `/kw-transcribe` w PRZEGLĄDARCE (`page.route`), nie w workerze: CI
 * uruchamia prawdziwy worker bez klucza Anthropic, a od ADR-021 księgę bada
 * się WYŁĄCZNIE przepisując jej treść — bez tej atrapy krok 7 blokuje na B-06.
 *
 * Treść to syntetyczne księgi workera (fikcyjne osoby, poprawne cyfry
 * kontrolne), czytane W MIEJSCU: numery KW nie mogą stać literałem w pliku
 * śledzonym (F-9). KSIĘGI SĄ DWIE i karta wybiera swoją (pole `karta`). Do S3d obu kartom
 * wystarczała księga lokalu, bo nikt nie patrzył na rodzaj księgi; odkąd web
 * sprawdza rodzaj wobec karty, podanie księgi lokalu na kartę gruntu daje —
 * słusznie — niezgodność „rodzaj księgi", werdykt `ok:false` i zniknięcie
 * linii „Przepisano 5 działów".
 */
const FIXTURES = {
  lokal: "kw_transcribe_sample.json",
  grunt: "kw_transcribe_grunt_sample.json",
} as const;

export type KartaAtrapy = keyof typeof FIXTURES;

const sciezka = (karta: KartaAtrapy) =>
  path.join(process.cwd(), "..", "worker", "tests", "fixtures", FIXTURES[karta]);

export type WariantAtrapy = "ok" | "walidacja" | "blad";

type KsiegaZAtrapy = {
  naglowek: {
    numerKsiegi: string;
    sad: string | null;
    wydzial: string | null;
    rodzajKsiegi: string | null;
  };
  dzialy: Array<{
    kod: string;
    tytul: string;
    tabele?: Array<{
      wpisy?: Array<{ rubryki?: Array<{ nazwa: string; wartosci: string[] }> }>;
    }>;
  }>;
  polaDodatkowe: {
    numerLokalu: string | null;
    kwGruntu: string | null;
    udzial: string | null;
    podstawaNabycia: { tytulAktu: string | null; repA: string | null } | null;
  };
} & Record<string, unknown>;

export function ksiegaZAtrapy(karta: KartaAtrapy = "lokal"): KsiegaZAtrapy {
  return JSON.parse(readFileSync(sciezka(karta), "utf8")) as KsiegaZAtrapy;
}

/**
 * Wartości JEDNEJ rubryki z treści atrapy — do asercji o tym, że §8.2 cytuje
 * właśnie tę księgę. Brak rubryki jest błędem, nie pustą listą: asercja na
 * wartości, której w fiksturze nie ma, przechodziłaby po cichu (F2 recenzji —
 * „Numer lokalu” = „24” trafiał w spis treści i w „Ustawa z dnia 24 czerwca”).
 */
export function rubrykaZAtrapy(kod: string, nazwa: string, karta: KartaAtrapy = "lokal"): string[] {
  const dzial = ksiegaZAtrapy(karta).dzialy.find((d) => d.kod === kod);
  const rubryka = dzial?.tabele
    ?.flatMap((t) => t.wpisy ?? [])
    .flatMap((w) => w.rubryki ?? [])
    .find((r) => r.nazwa === nazwa);
  if (!rubryka || rubryka.wartosci.length === 0) {
    throw new Error(`Atrapa (${karta}) nie ma rubryki „${nazwa}” w dziale ${kod}`);
  }
  return rubryka.wartosci;
}

/** Same nagłówki działów wystarczą licznikowi „n z 5”; treść i tak przychodzi z atrapy. */
export function tekstZakladek(
  kody = ["I-O", "I-Sp", "II", "III", "IV"],
  karta: KartaAtrapy = "lokal",
): string {
  return ksiegaZAtrapy(karta)
    .dzialy.filter((d) => kody.includes(d.kod))
    .map((d) => `${d.tytul}\nRubryka | wartość | 1`)
    .join("\n\n");
}

/** Jedno żądanie `/kw-transcribe` widziane przez atrapę — pola kontraktu ADR-024 §3.1. */
export type ZadanieTranskrypcji = {
  karta: string | null;
  kwLokalu: string | null;
  nrLokalu: string | null;
};

// Lista per strona i PRZEŻYWA `unroute`: test przełączający atrapę między
// kartami ma widzieć wszystkie żądania, nie tylko te od ostatniego przełączenia.
const zadania = new WeakMap<Page, ZadanieTranskrypcji[]>();

/** Żądania zebrane przez atrapę na tej stronie, w kolejności wysłania. */
export function zadaniaTranskrypcji(page: Page): ZadanieTranskrypcji[] {
  return zadania.get(page) ?? [];
}

/** Wartość jednego pola multipart — tylko pola tekstowe kontraktu, nigdy treść PDF. */
function poleMultipart(cialo: string, nazwa: string): string | null {
  const m = cialo.match(new RegExp(`name="${nazwa}"\r\n\r\n([^\r]*)\r\n`));
  return m ? m[1]! : null;
}

/**
 * Atrapa wybiera księgę po polu multipart `karta` — tym samym, po którym
 * prawdziwy worker wybiera prompt i `zakres` (ADR-024) — więc przepływ lokal →
 * grunt nie zależy od kolejności wywołań. Jawny argument `karta` wygrywa: CL-11
 * i smoke celowo podają jednej karcie księgę drugiej.
 *
 * Kontrakt atrapa pilnuje sama, jak worker: brak `karta` → 422 (stary web,
 * który jej nie wysyła, pada głośno, zamiast dostać księgę), a klucze lokalu
 * przy karcie lokalu → 422 (web wysyła je wyłącznie z karty gruntu). Czy
 * karta gruntu dostała klucze, których wymaga macierz praw — sprawdzają testy
 * na liście `zadaniaTranskrypcji(page)`.
 */
export async function atrapaTranskrypcji(
  page: Page,
  wariant: WariantAtrapy = "ok",
  karta?: KartaAtrapy,
): Promise<void> {
  if (!zadania.has(page)) zadania.set(page, []);
  await page.unroute("**/kw-transcribe");
  await page.route("**/kw-transcribe", async (route) => {
    // utf8, bo pola tekstowe niosą polskie znaki; pliki PDF w E2E są atrapami.
    const cialo = route.request().postDataBuffer()?.toString("utf8") ?? "";
    const zadanie: ZadanieTranskrypcji = {
      karta: poleMultipart(cialo, "karta"),
      kwLokalu: poleMultipart(cialo, "kw_lokalu"),
      nrLokalu: poleMultipart(cialo, "nr_lokalu"),
    };
    zadania.get(page)!.push(zadanie);
    const kartaZadania = zadanie.karta;
    if (kartaZadania !== "lokal" && kartaZadania !== "grunt") {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Brak rodzaju karty księgi (lokal albo grunt)." }),
      });
      return;
    }
    if (kartaZadania === "lokal" && (zadanie.kwLokalu != null || zadanie.nrLokalu != null)) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Atrapa: klucze lokalu przy karcie lokalu." }),
      });
      return;
    }
    if (wariant === "blad") {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ code: "kw_transkrypcja_blad" }),
      });
      return;
    }
    const ksiega = ksiegaZAtrapy(karta ?? kartaZadania);
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
