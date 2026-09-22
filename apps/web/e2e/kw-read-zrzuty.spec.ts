import { expect, test, type Page } from "@playwright/test";
import {
  atrapaTranskrypcji,
  ksiegaZAtrapy,
  tekstZakladek,
  type WariantAtrapy,
} from "./support/kw-transcribe-route";

/**
 * Zrzuty stanów karty „Księga lokalu" do opisu PR (ADR-021, makiety 1–6). Nie
 * wchodzi do `pnpm e2e` — projekt `zrzuty`. Od ADR-021 atrapa siedzi w
 * przeglądarce (`page.route`), więc nie potrzebuje osobnego procesu ani
 * zmiennej środowiskowej: stany „sprawdzenie nie wypadło pomyślnie" i „błąd"
 * to odpowiedzi, których prawdziwy model nie wyprodukuje na życzenie.
 */
test.describe.configure({ mode: "serial" });

async function wklejKsiege(page: Page, wariant: WariantAtrapy, kody?: string[]) {
  await atrapaTranskrypcji(page, wariant);
  await page.goto("/valuations/new");
  await page.getByTestId("kw-wklej-lokal").fill(tekstZakladek(kody));
  await page.getByTestId("kw-przepisz-lokal").click();
}

/** Kadr na samą kartę KW — reszta kroku 1 nic tu nie wnosi. */
async function zrzutKarty(page: Page, plik: string) {
  await page
    .locator("section", { hasText: "Księga wieczysta" })
    .first()
    .screenshot({ path: `e2e-zrzuty/${plik}` });
}

test("0. stan pusty — obie karty przed czymkolwiek (makieta 1)", async ({ page }) => {
  await page.goto("/valuations/new");
  await expect(page.getByTestId("kw-book-lokal")).toContainText("0 z 5");
  await expect(page.getByText(/Zbadane księgi: 0 z 2/)).toBeVisible();
  await zrzutKarty(page, "00-pusta-karta.png");
});

test("1. wklejenie 3 z 5 — licznik i baner o brakujących działach (makieta 2)", async ({
  page,
}) => {
  await page.goto("/valuations/new");
  await page.getByTestId("kw-wklej-lokal").fill(tekstZakladek(["I-O", "I-Sp", "II"]));
  await expect(page.getByText(/Brakuje działów III i IV/)).toBeVisible();
  await expect(page.getByTestId("kw-book-lokal")).toContainText("3 z 5");
  await zrzutKarty(page, "01-wklejone-3-z-5.png");
});

test("2. przepisana, sprawdzenie pomyślne — pola z treści (makieta 3)", async ({ page }) => {
  await wklejKsiege(page, "ok");
  const ksiega = ksiegaZAtrapy();
  await expect(page.locator("#kw-nr-lokalu")).toHaveValue(ksiega.polaDodatkowe.numerLokalu!, {
    timeout: 30_000,
  });
  await expect(page.locator("#kw-lokalu")).toHaveValue(ksiega.naglowek.numerKsiegi);
  await expect(page.locator("#kw-akt-rep")).toHaveValue(
    ksiega.polaDodatkowe.podstawaNabycia!.repA!,
  );
  await expect(page.getByTestId("kw-transcribe-status")).toContainText("Przepisano 5 działów");
  await expect(page.getByTestId("kw-werdykt-lokal")).toHaveCount(0);
  await zrzutKarty(page, "02-przepisana.png");
});

test("3. sprawdzenie niepomyślne — baner z nazwami po polsku, trwały po powrocie do kroku 1 (makieta 4)", async ({
  page,
}) => {
  await wklejKsiege(page, "walidacja");
  const baner = page.getByTestId("kw-werdykt-lokal");
  await expect(baner).toBeVisible({ timeout: 30_000 });
  await expect(baner).toContainText("udział w nieruchomości wspólnej, cyfra kontrolna numeru");
  await expect(baner).not.toContainText("pole_niezgodne");
  await expect(page.getByText("W dziale I-Sp księga podaje inny udział.")).toBeVisible();
  await zrzutKarty(page, "03-niezgodnosci.png");

  // Trwałość: zapis, wyjście, powrót — baner wraca z migawki, nie z sesji.
  await page.locator("#address").fill("ul. Testowa 1, Poznań");
  await page.locator("#area").fill("44.23");
  await page.locator("#purpose").selectOption("sprzedaz");
  await page.locator("#client").fill("QA zrzuty");
  await page
    .getByTestId("kw-encumbrance")
    .getByRole("radio", { name: "Wartość bez uwzględnienia obciążenia" })
    .click();
  await page.locator("#kw-encumbrance-podstawa").fill("Zgodnie z poleceniem Zleceniodawcy.");
  await page.locator("#subject-przeznaczenie-rodzaj-mpzp").check();
  await page.locator("#subject-przeznaczenie-nazwa").fill("Plan Testowy");
  await page.locator("#subject-przeznaczenie-uchwala").fill("Nr I/1/2020");
  await page.locator("#subject-przeznaczenie-data").fill("2020-01-01");
  await page.locator("#subject-przeznaczenie-symbol").fill("1MW/U");
  await page.getByRole("button", { name: "Dane się zgadzają — dalej" }).click();
  await page.waitForURL(/step=2/);
  await page.goto(page.url().replace("step=2", "step=1"));
  await expect(page.getByTestId("kw-werdykt-lokal")).toBeVisible();
  await zrzutKarty(page, "04-werdykt-po-powrocie.png");
});

test("4. zmiana sposobu przy danych — dialog z listą (makieta 5)", async ({ page }) => {
  await wklejKsiege(page, "ok");
  await expect(page.getByTestId("kw-transcribe-status")).toContainText("Przepisano", {
    timeout: 30_000,
  });
  await page.getByTestId("kw-book-lokal").getByRole("radio", { name: "Wgraj PDF" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Zmiana sposobu wprowadzenia księgi" });
  await expect(dialog).toContainText("przepisana treść pięciu działów");
  await zrzutKarty(page, "05-zmiana-sposobu.png");
  await dialog.getByRole("button", { name: "Zostaw jak jest" }).click();
  await expect(dialog).toHaveCount(0);
});

test("5. kanał PDF — lista plików, rozmiar i przycisk odczytu (makieta 6)", async ({ page }) => {
  await atrapaTranskrypcji(page, "ok");
  await page.goto("/valuations/new");
  await page.getByTestId("kw-book-lokal").getByRole("radio", { name: "Wgraj PDF" }).click();
  await page.getByTestId("kw-file-input").setInputFiles([
    // Dane fikcyjne — treść przychodzi z atrapy, nie z tych plików.
    { name: "dzial-I-O.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(62 * 1024, 32) },
    { name: "dzial-I-Sp.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(48 * 1024, 32) },
    {
      name: "dzial-II-III-IV.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(91 * 1024, 32),
    },
  ]);
  await expect(page.getByText("3 pliki · 201 kB")).toBeVisible();
  await zrzutKarty(page, "06-kanal-pdf.png");
});

test("6. transkrypcja nie doszła — ostrzeżenie, pola puste", async ({ page }) => {
  await wklejKsiege(page, "blad");
  await expect(page.getByTestId("kw-transcribe-warn")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#kw-nr-lokalu")).toHaveValue("");
  await zrzutKarty(page, "07-blad-transkrypcji.png");
});
