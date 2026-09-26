import { expect, test, type Page } from "@playwright/test";
import { SubjectStep } from "./pages/wizard";
import {
  atrapaTranskrypcji,
  ksiegaZAtrapy,
  tekstZakladek,
  zadaniaTranskrypcji,
} from "./support/kw-transcribe-route";

/**
 * ADR-024 — księga gruntu przepisywana wybiórczo: macierz praw do lokalu
 * (spec §9) po stronie przeglądarki, projekt `ksiega-gruntu`.
 *
 * Każdy test nosi w tytule wiersz macierzy (`M1`, `M5`, `M6`, `M8`); M2 stoi w
 * `smoke.spec.ts`, a M3, M4, M7 i M9 — w testach RTL i domeny
 * (`rtl-kw-section.test.tsx`, `kw-klucze.test.ts`). Atrapa `/kw-transcribe`
 * wybiera księgę po polu `karta` żądania i zbiera żądania do asercji kluczy.
 * Numery KW wyłącznie z fikstur workera (F-9) albo bez kształtu numeru KW.
 */

// Teksty ze specu §7 — zatwierdzone przez usera 26.09.
const T3 = (listy: string) =>
  `✓ Przepisano 5 działów (I-O, I-Sp, II, III, IV), ${listy}. Sprawdzenie treści wypadło pomyślnie.`;
const T4 = "Księgę gruntu przepisano dla innego lokalu. Przepisz ją ponownie.";

const statusKarty = (page: Page, book: "lokal" | "grunt") =>
  page.getByTestId(`kw-book-${book}`).getByTestId("kw-transcribe-status");

async function przepisz(page: Page, book: "lokal" | "grunt") {
  await page.getByTestId(`kw-wklej-${book}`).fill(tekstZakladek(undefined, book));
  await page.getByTestId(`kw-przepisz-${book}`).click();
  await expect(statusKarty(page, book)).toContainText("Przepisano 5 działów", {
    timeout: 30_000,
  });
}

const zadaniaKarty = (page: Page, karta: "lokal" | "grunt") =>
  zadaniaTranskrypcji(page).filter((z) => z.karta === karta);

test.describe("ADR-024 księga gruntu — macierz praw do lokalu @ksiega-gruntu", () => {
  test("M1: własność — karta gruntu wysyła klucze z karty lokalu, status T3a", async ({ page }) => {
    await atrapaTranskrypcji(page);
    await page.goto("/valuations/new");
    // Przepisana księga lokalu wypełnia oba klucze: numer KW i numer lokalu.
    await przepisz(page, "lokal");
    const lokal = ksiegaZAtrapy("lokal");
    await expect(page.locator("#kw-lokalu")).toHaveValue(lokal.naglowek.numerKsiegi);
    await przepisz(page, "grunt");

    await expect(statusKarty(page, "grunt")).toHaveText(
      T3(`z list lokali tylko lokal nr ${lokal.polaDodatkowe.numerLokalu}`),
    );
    expect(zadaniaKarty(page, "lokal")).toEqual([
      { karta: "lokal", kwLokalu: null, nrLokalu: null },
    ]);
    expect(zadaniaKarty(page, "grunt")).toEqual([
      {
        karta: "grunt",
        kwLokalu: lokal.naglowek.numerKsiegi,
        nrLokalu: lokal.polaDodatkowe.numerLokalu,
      },
    ]);
    await expect(page.getByTestId("kw-grunt-inny-lokal")).toHaveCount(0);
  });

  test("M5: lokal deweloperski — karta gruntu bez kluczy, status T3c", async ({ page }) => {
    await atrapaTranskrypcji(page);
    await page.goto("/valuations/new");
    await page.getByLabel(/Lokal bez własnej KW/).check();
    await expect(page.getByTestId("kw-grunt-zablokowane")).toHaveCount(0);
    await przepisz(page, "grunt");

    await expect(statusKarty(page, "grunt")).toHaveText(T3("bez list lokali"));
    expect(zadaniaKarty(page, "grunt")).toEqual([
      { karta: "grunt", kwLokalu: null, nrLokalu: null },
    ]);
  });

  test("M6: spółdzielcze — karty gruntu nie ma", async ({ page }) => {
    await page.goto("/valuations/new");
    await expect(page.getByTestId("kw-book-grunt")).toBeVisible();
    await page.getByRole("radio", { name: "Spółdzielcze własnościowe prawo do lokalu" }).click();
    await expect(page.getByTestId("kw-book-grunt")).toHaveCount(0);
    await expect(page.getByTestId("kw-grunt-zablokowane")).toHaveCount(0);
  });

  test("M8: sam numer lokalu → bez T4; zmiana numeru księgi lokalu po gruncie → T4, a krok 1 i tak przechodzi dalej", async ({
    page,
  }) => {
    const subject = new SubjectStep(page);
    await subject.open();
    await subject.fill({
      right: "wlasnosc",
      address: "ul. Testowa 1, Poznań",
      area: "44.23",
      client: "QA E2E ADR-024 M8",
    });
    await atrapaTranskrypcji(page);
    await przepisz(page, "lokal");
    await przepisz(page, "grunt");

    // Numer lokalu nie wybiera wiersza — wybiera go numer KW (decyzja 26.09).
    await page.locator("#kw-nr-lokalu").fill("25");
    await expect(page.getByTestId("kw-grunt-inny-lokal")).toHaveCount(0);

    // Numer bez kształtu numeru KW (F-9) — ważne tylko, że inny niż wysłany.
    await page.locator("#kw-lokalu").fill("KW-TEST-M8");
    await expect(page.getByTestId("kw-grunt-inny-lokal")).toHaveText(T4);

    // T4 to ostrzeżenie, nie blokada: szkic zapisuje się i idzie do kroku 2.
    await page
      .getByTestId("kw-encumbrance")
      .getByRole("radio", { name: "Wartość bez uwzględnienia obciążenia" })
      .click();
    await page.locator("#kw-encumbrance-podstawa").fill("Zgodnie z poleceniem Zleceniodawcy.");
    await subject.save();
  });
});
