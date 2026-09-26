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

// ---------------------------------------------------------------------------
// ADR-024 — stany karty „Księga gruntu” (T1–T6w ze specu §7) do opisu PR.
// ---------------------------------------------------------------------------

/** Kadr na samą kartę gruntu. */
async function zrzutGruntu(page: Page, plik: string) {
  await page.getByTestId("kw-book-grunt").screenshot({ path: `e2e-zrzuty/${plik}` });
}

/** Księga lokalu przepisana przez atrapę — jej numer i numer lokalu są kluczami gruntu. */
async function przepiszLokal(page: Page) {
  await page.getByTestId("kw-wklej-lokal").fill(tekstZakladek(undefined, "lokal"));
  await page.getByTestId("kw-przepisz-lokal").click();
  await expect(page.getByTestId("kw-book-lokal").getByTestId("kw-transcribe-status")).toContainText(
    "Przepisano",
    { timeout: 30_000 },
  );
}

async function przepiszGrunt(page: Page) {
  await page.getByTestId("kw-wklej-grunt").fill(tekstZakladek(undefined, "grunt"));
  await page.getByTestId("kw-przepisz-grunt").click();
}

test("10. karta gruntu zablokowana — pusta karta lokalu (T1, M2)", async ({ page }) => {
  await page.goto("/valuations/new");
  await page.getByTestId("kw-wklej-grunt").fill(tekstZakladek(undefined, "grunt"));
  await expect(page.getByTestId("kw-grunt-zablokowane")).toBeVisible();
  await expect(page.getByTestId("kw-przepisz-grunt")).toBeDisabled();
  await zrzutGruntu(page, "10-grunt-t1-zablokowana.png");
});

test("11. karta gruntu w trakcie przepisywania (T2)", async ({ page }) => {
  await atrapaTranskrypcji(page);
  await page.goto("/valuations/new");
  await przepiszLokal(page);
  // Odpowiedź gruntu wstrzymana do zrobienia zrzutu — stan „loading” trwa.
  let zwolnij!: () => void;
  const wstrzymana = new Promise<void>((r) => (zwolnij = r));
  await page.route("**/kw-transcribe", async (route) => {
    await wstrzymana;
    await route.abort();
  });
  await przepiszGrunt(page);
  await expect(page.getByTestId("kw-book-grunt").getByTestId("kw-transcribe-status")).toContainText(
    "Przepisuję księgę gruntu",
  );
  await zrzutGruntu(page, "11-grunt-t2-w-toku.png");
  zwolnij();
});

test("12. przepisano — T3a (oba klucze), T4 po zmianie numeru księgi lokalu", async ({ page }) => {
  await atrapaTranskrypcji(page);
  await page.goto("/valuations/new");
  await przepiszLokal(page);
  await przepiszGrunt(page);
  await expect(page.getByTestId("kw-book-grunt").getByTestId("kw-transcribe-status")).toContainText(
    "z list lokali tylko lokal nr",
    { timeout: 30_000 },
  );
  await zrzutGruntu(page, "12-grunt-t3a.png");
  await page.locator("#kw-lokalu").fill("KW-TEST-INNY");
  await expect(page.getByTestId("kw-grunt-inny-lokal")).toBeVisible();
  await zrzutGruntu(page, "15-grunt-t4-inny-lokal.png");
});

test("13. przepisano — T3b (sam numer KW lokalu)", async ({ page }) => {
  await atrapaTranskrypcji(page);
  await page.goto("/valuations/new");
  await page.locator("#kw-lokalu").fill("KW-TEST-LOKAL");
  await przepiszGrunt(page);
  await expect(page.getByTestId("kw-book-grunt").getByTestId("kw-transcribe-status")).toContainText(
    "z list lokali tylko przedmiotowy lokal",
    { timeout: 30_000 },
  );
  await zrzutGruntu(page, "13-grunt-t3b.png");
});

test("14. przepisano — T3c (lokal deweloperski, bez kluczy)", async ({ page }) => {
  await atrapaTranskrypcji(page);
  await page.goto("/valuations/new");
  await page.getByLabel(/Lokal bez własnej KW/).check();
  await przepiszGrunt(page);
  await expect(page.getByTestId("kw-book-grunt").getByTestId("kw-transcribe-status")).toContainText(
    "bez list lokali",
    { timeout: 30_000 },
  );
  await zrzutGruntu(page, "14-grunt-t3c.png");
});

test("16. T5 w banerze werdyktu — brak wiersza przedmiotowego lokalu w dziale II", async ({
  page,
}) => {
  await atrapaTranskrypcji(page);
  await page.goto("/valuations/new");
  await przepiszLokal(page);
  // Werdykt, którego fikstura nie da (jej wiersz lokalu jest na miejscu).
  await page.unroute("**/kw-transcribe");
  await page.route("**/kw-transcribe", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...ksiegaZAtrapy("grunt"),
        walidacja: { ok: false, bledy: [{ klasa: "brak_wiersza_lokalu", dzial: "II" }] },
      }),
    }),
  );
  await przepiszGrunt(page);
  await expect(page.getByTestId("kw-werdykt-grunt")).toContainText(
    "brak wiersza przedmiotowego lokalu w dziale II",
    { timeout: 30_000 },
  );
  await zrzutGruntu(page, "16-grunt-t5-baner.png");
});

test("17. porażka — T6 (PDF) i T6w (wklejenie) na karcie gruntu", async ({ page }) => {
  await atrapaTranskrypcji(page);
  await page.goto("/valuations/new");
  await przepiszLokal(page);
  await atrapaTranskrypcji(page, "blad");
  await przepiszGrunt(page);
  await expect(page.getByTestId("kw-book-grunt").getByTestId("kw-transcribe-warn")).toContainText(
    "Nie udało się przepisać wklejonej treści",
    { timeout: 30_000 },
  );
  await zrzutGruntu(page, "17-grunt-t6w-wklejenie.png");
  await page.getByTestId("kw-book-grunt").getByRole("radio", { name: "Wgraj PDF" }).click();
  await page.getByTestId("kwg-file-input").setInputFiles({
    name: "grunt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(8 * 1024, 32),
  });
  await page
    .getByTestId("kw-book-grunt")
    .getByRole("button", { name: "Odczytaj i przepisz księgę" })
    .click();
  await expect(page.getByTestId("kw-book-grunt").getByTestId("kw-transcribe-warn")).toContainText(
    "z tego pliku",
    { timeout: 30_000 },
  );
  await zrzutGruntu(page, "18-grunt-t6-pdf.png");
});
