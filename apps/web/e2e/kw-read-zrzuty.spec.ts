import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Zrzuty trzech stanów karty „Księga lokalu" do opisu PR (sesja b1-kw-read).
 *
 * NIE jest to test regresji i nie wchodzi do `pnpm e2e` — uruchamiany ręcznie,
 * projektem `zrzuty`, przeciw serwerowi zbudowanemu z `NEXT_PUBLIC_WORKER_URL`
 * wskazującym na atrapę workera. Atrapa jest konieczna, nie wygodna: na
 * działającym workerze da się wymusić tylko stan udany — „walidacja nie
 * przeszła" i „błąd odczytu" to odpowiedzi, których prawdziwy model nie
 * wyprodukuje na życzenie.
 *
 * Wariant atrapy przełącza plik wskazany przez `KW_MOCK_VARIANT_FILE`,
 * czytany przy każdym żądaniu.
 */

const VARIANT_FILE = process.env.KW_MOCK_VARIANT_FILE;

test.describe.configure({ mode: "serial" });

async function wgrajKsiege(page: import("@playwright/test").Page, wariant: string) {
  if (!VARIANT_FILE) throw new Error("Brak KW_MOCK_VARIANT_FILE — atrapa nie wie, co zwrócić.");
  writeFileSync(VARIANT_FILE, wariant);

  await page.goto("/valuations/new");
  await page.getByRole("radio", { name: "Wgraj PDF" }).click();
  await page.getByTestId("kw-file-input").setInputFiles({
    name: "ksiega-lokalu.pdf",
    mimeType: "application/pdf",
    // Dane fikcyjne — treść księgi przychodzi z atrapy, nie z tego pliku.
    buffer: Buffer.from("%PDF-1.4 syntetyczna ksiega (atrapa)"),
  });
}

/** Kadr na samą kartę KW — reszta kroku 1 nic tu nie wnosi. */
async function zrzutKarty(page: import("@playwright/test").Page, plik: string) {
  const karta = page.locator("section", { hasText: "Księga wieczysta" }).first();
  await karta.screenshot({ path: `e2e-zrzuty/${plik}` });
}

test("1. odczyt udany — pola z transkrypcji, bez banera", async ({ page }) => {
  await wgrajKsiege(page, "ok");
  // Numer lokalu i dział II pochodzą WYŁĄCZNIE z przepisanej treści — atrapa
  // /kw-extract ich nie zwraca, więc ich obecność dowodzi, że transkrypcja
  // doszła i została scalona.
  await expect(page.locator("#kw-nr-lokalu")).toHaveValue("24", { timeout: 30_000 });
  await expect(page.locator("#kw-akt-rodzaj")).toHaveValue("UMOWA SPRZEDAŻY");
  await expect(page.locator("#kw-akt-rep")).toHaveValue("6497/2018");
  await expect(page.getByTestId("kw-transcribe-warn")).toHaveCount(0);
  await zrzutKarty(page, "01-odczyt-udany.png");
});

test("2. walidacja nie przeszła — pola zostają, treść nie", async ({ page }) => {
  await wgrajKsiege(page, "walidacja");
  const warn = page.getByTestId("kw-transcribe-warn");
  await expect(warn).toBeVisible({ timeout: 30_000 });
  await expect(warn).toContainText("pole_niezgodne:udzial");
  await expect(page.locator("#kw-nr-lokalu")).toHaveValue("24");
  await zrzutKarty(page, "02-walidacja-nie-przeszla.png");
});

test("3. odczyt pliku nieudany — baner błędu z makiety", async ({ page }) => {
  await wgrajKsiege(page, "oba_padly");
  await expect(page.getByText(/Nie udało się odczytać pliku PDF księgi/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("kw-transcribe-warn")).toHaveCount(0);
  await zrzutKarty(page, "03-blad-odczytu-pliku.png");
});
