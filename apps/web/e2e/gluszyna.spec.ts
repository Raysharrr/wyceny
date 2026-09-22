import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistryRun, MAPPING_A, type RegistryRun } from "./fixtures/coop-registry";
import { ImportWizard } from "./pages/import-wizard";
import { InspectionStep, rateAllFeatures, SampleStep, SubjectStep } from "./pages/wizard";
import { atrapaTranskrypcji, ksiegaZAtrapy, tekstZakladek } from "./support/kw-transcribe-route";

/**
 * Blok „Głuszyna” (zgłoszenie Anety 21.09) — trwały spec E2E, projekt `gluszyna`.
 *
 * Pokrycie checklisty `docs/superpowers/review/2026-09-21-gluszyna/CHECKLISTA.md`
 * (wiki-repo): każdy test deklaruje w nazwie punkty `CL-n`, które zamyka, a
 * macierz `CL-n → test` stoi w `e2e/README.md`. To, co pinują testy jednostkowe
 * (walidator KW, `extremeComparables`, `suggestedRating`, tekst §12.2), jest tu
 * sprawdzane WYŁĄCZNIE przez skutek widoczny dla rzeczoznawcy.
 *
 * Determinizm: proza i mapy wyłączone buildem (`NEXT_PUBLIC_PROSE=off`,
 * `MAPS_FETCH=off`), geokoder workera na `GEOCODER_STUB=1`, a jedyne wyjście w
 * sieć — `/kw-transcribe` — zastąpione atrapą w przeglądarce (`page.route`,
 * `support/kw-transcribe-route.ts`). Zero `waitForTimeout`; jawne budżety tylko
 * przy imporcie, doborze próby i renderze PDF.
 *
 * Czego tu NIE MA i dlaczego:
 * - Z-1 (CL-1, CL-2, komunikat konfiguracyjny kroku 6) jest NIEOSIĄGALNY w tym
 *   projekcie. `proposeProse` to Server Action, a `httpProseProposal` woła
 *   `/prose-proposal` z procesu Next.js — `page.route` widzi wyłącznie ruch
 *   przeglądarki, więc nie ma czego podmienić. Niezależnie od tego CI buduje z
 *   `NEXT_PUBLIC_PROSE=off`, więc krok 6 renderuje zaślepkę z linkiem „Dalej”,
 *   bez przycisku generowania. Pokrycie: `test_prose_config_error_detail`
 *   (worker) i testy jednostkowe akcji (brak podwójnego „kod:”).
 * - §12.2 czytamy z PODGLĄDU kroku 7, nie z wydanego operatu: kartę lokali
 *   skrajnych ma tylko szkic z próbą z rejestru, czyli spółdzielczy, a takiego
 *   w CI nie da się zatwierdzić — brama chce prowenancji geokodowania z żywego
 *   autofetch (patrz `E2E_APPROVE` w `spoldzielcze.spec.ts`). §8.2 nie ma tego
 *   ograniczenia: szkic WŁASNOŚCIOWY z dwiema księgami przechodzi bramę tak
 *   samo, jak w `smoke.spec.ts`, więc test CL-13 czyta wydany DOCX. Kontrola
 *   UKŁADU tabel w Wordzie zostaje po stronie rzeczoznawcy.
 * - Księga LOKALU wklejona na kartę gruntu (druga strona CL-11) ma własny test
 *   w `smoke.spec.ts` — tu stoi wariant przeciwny, który nie miał nigdzie bramki.
 *
 * Uruchomienie: `pnpm e2e` (razem ze smoke i blokiem spółdzielczym).
 * Wymaga `pdftotext` (poppler) — podgląd operatu jest asercjonowany z tekstu PDF.
 */

// ---------------------------------------------------------------- helpers

/** Tekst PDF-a spod `src` ramki podglądu — ta sama droga, co w bloku spółdzielczym. */
async function pdfText(page: Page, iframeSrc: string): Promise<string> {
  const res = await page.request.get(iframeSrc);
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  const file = join(mkdtempSync(join(tmpdir(), "gluszyna-")), "podglad.pdf");
  writeFileSync(file, body);
  return execFileSync("pdftotext", ["-layout", file, "-"]).toString("utf8");
}

/** Jedna linia bez powtórzonych spacji — `pdftotext` i runy Worda tną zdania w dowolnym miejscu. */
const plasko = (t: string) => t.replace(/\s+/g, " ");

/** Tekst DOCX-a — `word/document.xml` bez znaczników; runy Worda tną zdania, więc szukamy po frazach z treści księgi. */
function docxText(plik: string): string {
  return execFileSync("unzip", ["-p", plik, "word/document.xml"])
    .toString("utf8")
    .replace(/<[^>]+>/g, "");
}

/** Import arkusza A przez KREATOR, w osobnym kontekście — jak w bloku spółdzielczym. */
async function importInFreshContext(browser: Browser, run: RegistryRun) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const wizard = new ImportWizard(page);
  await wizard.open();
  await wizard.chooseFile(
    run.xlsx,
    `rejestr-${run.runId}.xlsx`,
    run.sheetA.name,
    run.sheetA.headerRow,
  );
  await wizard.newCooperative(run.cooperative);
  await wizard.goToMapping();
  await wizard.map(MAPPING_A);
  await wizard.goToSummary();
  await wizard.runImport();
  await expect(wizard.result).toHaveText(new RegExp(`^Dodano ${run.sheetA.rows} now`));
  await context.close();
}

/** Szkic spółdzielczy z próbą z rejestru, zatrzymany na kroku 4. */
async function draftWithRegistrySample(page: Page, run: RegistryRun, client: string) {
  const subject = new SubjectStep(page);
  await subject.open();
  await subject.fill({
    right: "spoldzielcze",
    address: "os. Piastowskie 20, Poznań",
    area: "43.34",
    client: `QA E2E ${run.runId} ${client}`,
  });
  await subject.save();
  await new InspectionStep(page).fillDateAndContinue();
  const sample = new SampleStep(page);
  await sample.fetch();
  await sample.confirmAndContinue();
}

/**
 * Oceny cech PRZEDMIOTU (górna karta) — najwyższy opisany poziom każdej cechy.
 * Karty lokali skrajnych celowo NIE dotyka: to jej brak jest tu przedmiotem
 * asercji, a wspólny `rateAllFeatures` z `pages/wizard.ts` ocenia obie naraz.
 */
async function rateSubjectFeaturesOnly(page: Page) {
  const rows = page.locator('[data-testid^="feature-row-"]');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    await rows.nth(i).getByRole("radio").last().click();
  }
}

/**
 * Każda cecha każdego lokalu skrajnego, klikiem w kafelek. `poziom: "najnizszy"`
 * celowo rozjeżdża oceny lokali z oceną przedmiotu: §12.2 drukuje wtedy inne
 * zdanie dla lokali niż dla przedmiotu, więc test odróżnia OCENY rzeczoznawcy
 * od progów liczbowych i od zdania „brak danych w rejestrze”.
 */
async function rateExtremes(page: Page, poziom: "najnizszy" | "najwyzszy") {
  const groups = page.getByTestId("extremes-card").getByRole("radiogroup");
  const n = await groups.count();
  for (let i = 0; i < n; i++) {
    const kafelki = groups.nth(i).getByRole("radio");
    await (poziom === "najnizszy" ? kafelki.first() : kafelki.last()).click();
  }
}

/**
 * Wiersze „cecha – ocena” jednego opisu §12.2 podglądu. Zakres wycinamy po
 * nagłówkach, bo asercja o całym PDF-ie nie odróżniłaby opisu lokalu skrajnego
 * od opisu przedmiotu wyceny — a to właśnie ta różnica jest tu dowodem.
 */
function opis122(text: string, naglowek: string): string[] {
  const od = text.indexOf(naglowek);
  expect(od, `brak w podglądzie: ${naglowek}`).toBeGreaterThanOrEqual(0);
  const reszta = text.slice(od + naglowek.length);
  const koniec = reszta.search(/\n\s*(Opis lokalu|12\.3\.)/);
  return reszta
    .slice(0, koniec < 0 ? undefined : koniec)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes(" – "));
}

/** Kroki 4→7 z prozą OFF; cechy są już ocenione przez wywołującego. */
async function walkFromFeaturesToOperat(page: Page) {
  await page.getByRole("button", { name: "Zatwierdź cechy i dalej" }).click();
  await page.waitForURL(/step=5/);
  await page.getByRole("button", { name: /^(Zatwierdź kalkulację i dalej|Dalej)$/ }).click();
  await page.waitForURL(/step=6/);
  await page.getByRole("link", { name: "Dalej" }).click();
  await page.waitForURL(/step=7/);
}

// ---------------------------------------------------------------- Z-3: treść ksiąg (krok 1)

test.describe("Z-3 treść ksiąg wieczystych — krok 1 @gluszyna", () => {
  test("CL-9: licznik zakładek nazywa brakujące działy, a komplet pięciu przepisuje treść księgi", async ({
    page,
  }) => {
    await atrapaTranskrypcji(page, "ok", "lokal");
    await page.goto("/valuations/new");
    const karta = page.getByTestId("kw-book-lokal");
    await expect(karta).toContainText("0 z 5");

    // Trzy zakładki: licznik zna trzy działy, baner nazywa dwa brakujące i
    // mówi, czego bez nich zabraknie w operacie.
    await page.getByTestId("kw-wklej-lokal").fill(tekstZakladek(["I-O", "I-Sp", "II"], "lokal"));
    await expect(karta).toContainText("3 z 5");
    await expect(karta.getByText(/^Brakuje działów III i IV —/)).toBeVisible();
    await expect(
      karta.getByText(/Bez nich operat nie opisze praw, roszczeń ani hipotek\./),
    ).toBeVisible();

    // Komplet: baner znika, a „Przepisz treść księgi” przepisuje pięć działów
    // i wypełnia pola z treści.
    await page.getByTestId("kw-wklej-lokal").fill(tekstZakladek(undefined, "lokal"));
    await expect(karta).toContainText("5 z 5");
    await expect(karta.getByText(/^Brakuje dział/)).toHaveCount(0);
    await page.getByTestId("kw-przepisz-lokal").click();

    const ksiega = ksiegaZAtrapy("lokal");
    await expect(karta.getByTestId("kw-transcribe-status")).toContainText(
      "Przepisano 5 działów (I-O, I-Sp, II, III, IV) — sprawdzenie treści wypadło pomyślnie.",
      { timeout: 30_000 },
    );
    await expect(page.locator("#kw-lokalu")).toHaveValue(ksiega.naglowek.numerKsiegi);
    await expect(page.locator("#kw-nr-lokalu")).toHaveValue(ksiega.polaDodatkowe.numerLokalu!);
    await expect(page.getByTestId("kw-werdykt-lokal")).toHaveCount(0);
  });

  test("CL-10: werdykt o niezgodnościach jest trwały — wraca po zapisaniu szkicu i powrocie do kroku 1", async ({
    page,
  }) => {
    await atrapaTranskrypcji(page, "walidacja", "lokal");
    await page.goto("/valuations/new");
    await page.getByTestId("kw-wklej-lokal").fill(tekstZakladek(undefined, "lokal"));
    await page.getByTestId("kw-przepisz-lokal").click();

    const werdykt = page.getByTestId("kw-werdykt-lokal");
    await expect(werdykt).toBeVisible({ timeout: 30_000 });
    // Nazwy po polsku, nigdy klasy walidatora — baner czyta go rzeczoznawca.
    await expect(werdykt).toContainText(
      "niezgodności: udział w nieruchomości wspólnej, cyfra kontrolna numeru księgi gruntu",
    );
    await expect(werdykt).not.toContainText("pole_niezgodne");
    // Werdykt jest OSTRZEŻENIEM, nie blokadą: treść mimo niego weszła.
    await expect(page.locator("#kw-lokalu")).not.toHaveValue("");

    // Wyjście na krok 2 i powrót: baner wraca z MIGAWKI, nie ze stanu sesji.
    await page.locator("#address").fill("ul. Testowa 1, Poznań");
    await page.locator("#area").fill("44.23");
    await page.locator("#purpose").selectOption("sprzedaz");
    await page.locator("#client").fill("QA E2E Głuszyna werdykt");
    await page
      .getByTestId("kw-encumbrance")
      .getByRole("radio", { name: "Wartość bez uwzględnienia obciążenia" })
      .click();
    await page.locator("#kw-encumbrance-podstawa").fill("Zgodnie z poleceniem Zleceniodawcy.");
    await new SubjectStep(page).fillPrzeznaczenie("mpzp");
    await page.getByRole("button", { name: "Dane się zgadzają — dalej" }).click();
    await page.waitForURL(/step=2/);
    await page.goto(page.url().replace("step=2", "step=1"));

    await expect(page.getByTestId("kw-werdykt-lokal")).toContainText(
      "udział w nieruchomości wspólnej",
    );
    await expect(page.getByText("W dziale I-Sp księga podaje inny udział.")).toBeVisible();
  });

  test("CL-12: zmiana sposobu — „Zostaw jak jest” nie rusza karty, „Zmień sposób i usuń dane” ją czyści", async ({
    page,
  }) => {
    await atrapaTranskrypcji(page, "ok", "lokal");
    await page.goto("/valuations/new");
    await page.getByTestId("kw-wklej-lokal").fill(tekstZakladek(undefined, "lokal"));
    await page.getByTestId("kw-przepisz-lokal").click();
    const karta = page.getByTestId("kw-book-lokal");
    await expect(karta.getByTestId("kw-transcribe-status")).toContainText("Przepisano", {
      timeout: 30_000,
    });
    const numer = await page.locator("#kw-lokalu").inputValue();
    expect(numer).not.toBe("");

    // Panel wymienia, co zniknie — zanim cokolwiek zniknie.
    await karta.getByRole("radio", { name: "Wgraj PDF" }).click();
    const panel = page.getByTestId("kw-zmiana-sposobu");
    await expect(panel).toContainText("Zmiana sposobu na „Wgraj PDF” usunie dane");
    await expect(panel).toContainText("przepisana treść pięciu działów");

    // „Zostaw jak jest”: karta zostaje dokładnie taka, jaka była.
    await panel.getByRole("button", { name: "Zostaw jak jest" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator("#kw-lokalu")).toHaveValue(numer);
    await expect(karta.getByTestId("kw-transcribe-status")).toContainText("Przepisano");

    // „Zmień sposób i usuń dane”: to zachowanie NOWO DESTRUKCYJNE z checklisty —
    // kasuje numer, pola z treści i samą przepisaną treść.
    await karta.getByRole("radio", { name: "Wgraj PDF" }).click();
    await page
      .getByTestId("kw-zmiana-sposobu")
      .getByRole("button", { name: "Zmień sposób i usuń dane" })
      .click();
    await expect(page.getByTestId("kw-zmiana-sposobu")).toHaveCount(0);
    await expect(page.locator("#kw-lokalu")).toHaveValue("");
    await expect(page.locator("#kw-nr-lokalu")).toHaveValue("");
    await expect(page.locator("#kw-sad")).toHaveValue("");
    await expect(karta.getByTestId("kw-transcribe-status")).toHaveCount(0);
    await expect(page.getByText(/Zbadane księgi: 0 z 2/)).toBeVisible();
  });

  test("CL-11 (negatywny): księga gruntowa wklejona na kartę LOKALU nazywa rodzaj księgi i nie wypełnia pól lokalu", async ({
    page,
  }) => {
    // Wariant przeciwny do tego ze `smoke.spec.ts` (księga lokalu na karcie
    // gruntu) — tamten kierunek ma już bramkę, ten nie miał żadnej.
    await atrapaTranskrypcji(page, "ok", "grunt");
    await page.goto("/valuations/new");
    await page.getByTestId("kw-wklej-lokal").fill(tekstZakladek(undefined, "grunt"));
    await page.getByTestId("kw-przepisz-lokal").click();

    const karta = page.getByTestId("kw-book-lokal");
    await expect(karta.getByTestId("kw-werdykt-lokal")).toContainText(
      "rodzaj księgi (treść opisuje nieruchomość gruntową, a to karta księgi lokalu)",
      { timeout: 30_000 },
    );
    await expect(karta.getByText("Sprawdź, czy wklejono właściwą księgę.")).toBeVisible();
    // Zielonej linii nie ma: sprawdzenie treści nie wypadło pomyślnie.
    await expect(karta.getByTestId("kw-transcribe-status")).toHaveCount(0);
    // Pola, których księga gruntowa nie niesie, zostają puste (CHECKLISTA pkt 11).
    await expect(page.locator("#kw-nr-lokalu")).toHaveValue("");
    await expect(page.locator("#kw-udzial")).toHaveValue("");
    await expect(page.locator("#kw-gruntu")).toHaveValue("");
  });
});

// ---------------------------------------------------------------- Z-3: §8.2 dokumentu

test.describe("Z-3 tabele działów w §8.2 @gluszyna", () => {
  // Zatwierdzenie i render DOCX→PDF po stronie workera — jeden jawny budżet.
  test.setTimeout(180_000);

  test("CL-13: §8.2 cytuje obie księgi; werdykt `ok:false` jest markerem w podglądzie i znika z wydanego operatu", async ({
    page,
  }) => {
    // Ścieżka WŁASNOŚCIOWA, bo tylko ona ma dwie księgi (szkic spółdzielczy nie
    // ma żadnej, więc §8.2 i karta lokali skrajnych nie mieszczą się w jednym
    // szkicu). Zatwierdzenie jest tu osiągalne — to samo robi `smoke.spec.ts`;
    // bramka wymagająca żywego autofetch dotyczy ścieżki spółdzielczej.
    const subject = new SubjectStep(page);
    await subject.open();
    await subject.fill({
      right: "wlasnosc",
      address: "ul. Testowa 1, Poznań",
      area: "54.3",
      client: "QA E2E Głuszyna 8.2",
    });

    // Księga lokalu z niezgodnościami (marker w podglądzie), księga gruntu czysta.
    await atrapaTranskrypcji(page, "walidacja", "lokal");
    await page.getByTestId("kw-wklej-lokal").fill(tekstZakladek(undefined, "lokal"));
    await page.getByTestId("kw-przepisz-lokal").click();
    await expect(page.getByTestId("kw-werdykt-lokal")).toBeVisible({ timeout: 30_000 });
    await atrapaTranskrypcji(page, "ok", "grunt");
    await page.getByTestId("kw-wklej-grunt").fill(tekstZakladek(undefined, "grunt"));
    await page.getByTestId("kw-przepisz-grunt").click();
    await expect(
      page.getByTestId("kw-book-grunt").getByTestId("kw-transcribe-status"),
    ).toContainText("Przepisano 5 działów", { timeout: 30_000 });

    await page.locator("#kw-lokalu").fill("PO1P/00111111/1");
    await page.locator("#kw-gruntu").fill("PO1P/00222222/2");
    await page.locator("#kwg-nr").fill("PO1P/00222222/2");
    await page
      .getByTestId("kw-encumbrance")
      .getByRole("radio", { name: "Wartość bez uwzględnienia obciążenia" })
      .click();
    await page.locator("#kw-encumbrance-podstawa").fill("Zgodnie z poleceniem Zleceniodawcy.");
    await expect(page.getByText(/Zbadane księgi: 2 z 2/)).toBeVisible();
    await subject.save();

    await new InspectionStep(page).fillDateAndContinue();
    for (let i = 3; i < 12; i++)
      await page.getByRole("button", { name: "Dodaj transakcję" }).click();
    for (let i = 0; i < 12; i++)
      await page.locator(`#comparable-price-${i}`).fill(String(12_000 + i * 100));
    await page.getByRole("button", { name: "Zatwierdź próbę i dalej" }).click();
    await page.waitForURL(/step=4/);
    await rateAllFeatures(page);
    await walkFromFeaturesToOperat(page);

    // PODGLĄD: obie tabele działów, grunt PO protokole lokalu, marker werdyktu.
    const iframe = page.locator('iframe[title="Podgląd operatu (PDF)"]');
    await expect(iframe).toBeVisible({ timeout: 90_000 });
    const podglad = await pdfText(page, (await iframe.getAttribute("src"))!);

    const lokalowej = podglad.indexOf("badania księgi wieczystej nieruchomości lokalowej");
    const gruntowej = podglad.indexOf("badania księgi wieczystej nieruchomości gruntowej");
    expect(lokalowej, "§8.2 bez protokołu księgi lokalu").toBeGreaterThanOrEqual(0);
    expect(gruntowej, "§8.2 bez protokołu księgi gruntu").toBeGreaterThan(lokalowej);
    // Pięć działów RAZ DLA KAŻDEJ księgi — po jednym wystąpieniu przed i po
    // protokole gruntu, więc dwie tabele, a nie jedna wydrukowana dwa razy.
    for (const kod of ["I-O", "I-SP", "II", "III", "IV"]) {
      const naglowek = new RegExp(`DZIAŁ ${kod} [-–]`, "g");
      expect(
        podglad.slice(lokalowej, gruntowej).match(naglowek),
        `działy lokalu: ${kod}`,
      ).toHaveLength(1);
      expect(podglad.slice(gruntowej).match(naglowek), `działy gruntu: ${kod}`).toHaveLength(1);
    }
    // Treść, której ręczne wpisanie księgi nigdy nie dawało (defekt z 14.09):
    // adres i właściciel cytowane z działów I-O i II księgi lokalu.
    const ksiega = ksiegaZAtrapy("lokal");
    expect(podglad).toContain(ksiega.polaDodatkowe.numerLokalu!);
    // Marker stoi w wąskiej kolumnie tabeli, więc `pdftotext` łamie go w pół —
    // porównujemy na jednej linii (ten sam zabieg, co w bloku spółdzielczym).
    expect(plasko(podglad)).toContain(
      "[PODGLĄD: SPRAWDZENIE TREŚCI NIE WYPADŁO POMYŚLNIE] niezgodności: " +
        "udział w nieruchomości wspólnej, cyfra kontrolna numeru księgi gruntu",
    );

    // WYDANY OPERAT: te same tabele, bez markera — ostrzeżenie widział rzeczoznawca.
    await page.getByTestId("approve-button").click();
    await expect(page.getByTestId("valuation-status")).toHaveText("Zatwierdzony", {
      timeout: 120_000,
    });
    const docx = page.getByRole("link", { name: "Pobierz DOCX", exact: true });
    const res = await page.request.get((await docx.getAttribute("href"))!);
    expect(res.status()).toBe(200);
    const plik = join(mkdtempSync(join(tmpdir(), "gluszyna-docx-")), "operat.docx");
    writeFileSync(plik, await res.body());
    const xml = docxText(plik);

    expect(xml.match(/DZIAŁ I-O [-–]/g), "§8.2 wydanego operatu: dwie tabele").toHaveLength(2);
    expect(xml).toContain("badania księgi wieczystej nieruchomości gruntowej");
    expect(plasko(xml)).not.toContain("SPRAWDZENIE TREŚCI NIE WYPADŁO POMYŚLNIE");
  });
});

// ---------------------------------------------------------------- Z-2: lokale o cenie skrajnej (krok 4)

test.describe("Z-2 oceny lokali o cenie skrajnej — krok 4 @gluszyna", () => {
  // Ciężka ścieżka: import w `beforeAll`, dobór próby po CAŁYM rejestrze biura
  // i render PDF-a — jeden jawny budżet zamiast globalnego rozciągania.
  test.setTimeout(180_000);

  let run: RegistryRun;

  test.beforeAll(async ({ browser }) => {
    run = buildRegistryRun();
    await importInFreshContext(browser, run);
  });

  test("CL-3, CL-4, CL-5: bez kompletu ocen krok 4 nie przepuszcza, „Przyjmij” bierze podpowiedź z rejestru, a §12.2 drukuje oceny", async ({
    page,
  }) => {
    await draftWithRegistrySample(page, run, "skrajne");

    // CL-3: karta jest pod skalą cech, nic nie jest ocenione, przycisk stoi.
    const karta = page.getByTestId("extremes-card");
    await expect(karta).toBeVisible();
    const lokale = page.locator('[data-testid^="extreme-lokal-"]');
    // Liczba lokali skrajnych to niezmiennik próby (remis cen opisuje każdy
    // lokal przy tej cenie, D-53), a nie stała — rejestr biura jest jedną pulą.
    const ilu = await lokale.count();
    expect(ilu).toBeGreaterThanOrEqual(2);
    await expect(karta).toContainText(`oceniono 0 z ${ilu}`);
    await expect(karta.getByText("Oceń cechy")).toHaveCount(ilu);
    const dalej = page.getByRole("button", { name: "Zatwierdź cechy i dalej" });
    await expect(dalej).toBeDisabled();

    // Cechy przedmiotu ocenione — przycisk NADAL stoi, bo brakuje lokali skrajnych.
    await rateSubjectFeaturesOnly(page);
    await expect(dalej).toBeDisabled();
    await expect(page.getByTestId("footnav-kcs-mid")).toContainText(`lokale skrajne 0 z ${ilu}`);

    // CL-4: „Przyjmij” przy podpowiedzi zaznacza dokładnie podpowiadany poziom.
    // Rejestr biura niesie powierzchnię każdego wiersza, więc podpowiedź ma
    // cecha „Powierzchnia użytkowa”; piętra i P.P rejestr nie podaje, więc ich
    // wiersze podpowiedzi nie mają — i słusznie.
    const podpowiedz = page.getByTestId("extreme-hint-0-powierzchnia-uzytkowa");
    await expect(podpowiedz).toContainText(/^Podpowiedź: powierzchnia lokalu /);
    // Poziom, który podpowiedź NAZYWA — kafelek ma się zaznaczyć dokładnie na nim.
    const poziom = (await podpowiedz.innerText()).match(/→\s*(\S+)/)![1]!;
    const wiersz = page.getByTestId("extreme-row-0-powierzchnia-uzytkowa");
    await expect(wiersz).toHaveAttribute("data-rated", "false");
    await podpowiedz.getByRole("button", { name: "Przyjmij" }).click();
    await expect(wiersz).toHaveAttribute("data-rated", "true");
    await expect(wiersz.getByRole("radio", { checked: true })).toHaveText(poziom);
    // Przyjęta podpowiedź znika — nie ma już czego przyjmować.
    await expect(podpowiedz).toHaveCount(0);

    // Komplet ocen: licznik dochodzi do kompletu, przycisk zwalnia. Poziom
    // NAJNIŻSZY, podczas gdy przedmiot dostał najwyższy — §12.2 ma o lokalach
    // powiedzieć co innego niż o przedmiocie.
    await rateExtremes(page, "najnizszy");
    await expect(karta).toContainText(`oceniono ${ilu} z ${ilu}`);
    await expect(karta.getByText("Oceń cechy")).toHaveCount(0);
    await expect(dalej).toBeEnabled();

    // CL-5: krok 7 nie ma ani jednego blokera B-18…
    await walkFromFeaturesToOperat(page);
    const blokery = page.getByTestId("gate-blockers");
    await expect(blokery.getByText(/^Oceń cechę /)).toHaveCount(0, { timeout: 60_000 });

    // …a §12.2 podglądu cytuje OCENY rzeczoznawcy, nie „brak danych w rejestrze”.
    // Każda cecha każdego lokalu skrajnego dostała najwyższy opisany poziom
    // (podpowiedź powierzchni przyjęta wyżej zostaje nadpisana tym samym
    // klikiem), więc §12.2 ma mówić o wartości najwyższej — a nie o progach,
    // które dla powierzchni i piętra wypadłyby inaczej.
    const despite = page.getByTestId("preview-despite-blockers");
    const iframe = page.locator('iframe[title="Podgląd operatu (PDF)"]');
    await expect(iframe.or(despite)).toBeVisible({ timeout: 60_000 });
    if (await despite.isVisible()) await despite.click();
    await expect(iframe).toBeVisible({ timeout: 90_000 });
    const text = await pdfText(page, (await iframe.getAttribute("src"))!);

    for (const strona of ["najwyższej", "najniższej"]) {
      const wiersze = opis122(text, `Opis lokalu o jednostkowej cenie ${strona} w zbiorze`);
      expect(wiersze, `§12.2, lokal o cenie ${strona}`).toHaveLength(6);
      for (const wiersz of wiersze) expect(wiersz).toContain("– wartość najniższa cechy");
    }
    // Kontrola pozytywna: przedmiot, oceniony najwyżej, trzyma swoje zdanie —
    // więc powyższe „najniższa” to OCENY lokali, a nie jedno zdanie dla wszystkich.
    const przedmiot = opis122(text, "Opis lokalu będącego przedmiotem wyceny");
    expect(przedmiot).toHaveLength(6);
    for (const wiersz of przedmiot) expect(wiersz).toContain("– wartość najwyższa cechy");
    // To jest zdanie z operatu Anety z 14.09 — §12.2 nie ma prawa go powtórzyć.
    expect(text).not.toContain("brak danych w rejestrze do oceny tej cechy");
  });

  test("CL-7 (negatywny): wiersz dopisany do próby w kroku 3 staje się lokalem skrajnym i zapala B-18 w kroku 7", async ({
    page,
  }) => {
    // Komplet ocen zapisany, kalkulacja zatwierdzona — dopiero to otwiera krok 7
    // (`maxReachedStep` trzyma szkic na kroku 5, póki `wr` jest puste).
    await draftWithRegistrySample(page, run, "dopisany");
    await rateSubjectFeaturesOnly(page);
    await rateExtremes(page, "najwyzszy");
    await walkFromFeaturesToOperat(page);

    // Powrót do kroku 3 i wiersz o cenie, jakiej w próbie nie ma. Tabela do
    // ręcznej edycji jest pod rozwijaczem, gdy próba przyszła z rejestru.
    await page.goto(page.url().replace("step=7", "step=3"));
    await page.getByRole("button", { name: /^Próba do kalkulacji/ }).click();
    const ceny = page.locator('[id^="comparable-price-"]');
    const n = await ceny.count();
    await page.getByRole("button", { name: "Dodaj transakcję" }).click();
    await expect(ceny).toHaveCount(n + 1);
    await page.locator(`#comparable-date-${n}`).fill("2025-06-15");
    await page.locator(`#comparable-area-${n}`).fill("30");
    await page.locator(`#comparable-price-${n}`).fill("2000000");
    await page.getByRole("button", { name: "Zatwierdź próbę i dalej" }).click();
    await page.waitForURL(/step=4/);

    // Krok 4 znów trzyma przycisk — nowy lokal skrajny nie ma ocen…
    await expect(page.getByTestId("extremes-card")).toContainText(/oceniono [01] z \d/);
    await expect(page.getByRole("button", { name: "Zatwierdź cechy i dalej" })).toBeDisabled();
    // …a krok 7 (osiągalny dopiero po ponownej kalkulacji, bo zmiana próby
    // wyzerowała WR) nazywa cechę i stronę ceny, zamiast powtarzać jedno zdanie.
    await page.goto(page.url().replace("step=4", "step=5"));
    await page.getByRole("button", { name: "Zatwierdź kalkulację i dalej" }).click();
    await page.waitForURL(/step=6/);
    await page.getByRole("link", { name: "Dalej" }).click();
    await page.waitForURL(/step=7/);
    await expect(
      page.getByTestId("gate-blockers").getByText(/^Oceń cechę .* lokalu o cenie najwyższej/),
    ).not.toHaveCount(0, { timeout: 60_000 });
  });
});

// ---------------------------------------------------------------- S5: odłączone progi (krok 4)

test.describe("S5 odłączone progi — krok 4 @gluszyna", () => {
  test("„Co możesz STRACIĆ” pkt 3: ręczne przepisanie tekstu poziomu odłącza progi, a „Przywróć progi z presetu” je wraca", async ({
    page,
  }) => {
    // Próba wpisana ręcznie wystarczy: ta cecha nosi progi presetu niezależnie
    // od próby, a bez migawki próby nie ma karty lokali skrajnych, która tylko
    // wydłużyłaby ten test.
    const subject = new SubjectStep(page);
    await subject.open();
    await subject.fill({
      right: "wlasnosc",
      address: "ul. Testowa 1, Poznań",
      area: "54.3",
      client: "QA E2E Głuszyna progi",
      kw: "KW-TEST-PROGI",
    });
    await subject.save();
    await new InspectionStep(page).fillDateAndContinue();
    for (const i of [0, 1, 2]) await page.locator(`#comparable-price-${i}`).fill(`${12_000 + i}00`);
    await page.getByRole("button", { name: "Zatwierdź próbę i dalej" }).click();
    await page.waitForURL(/step=4/);

    const wiersz = page.getByTestId("feature-row-polozenie-na-pietrze");
    const baner = wiersz.getByText(/^Tekst poziomu przepisany ręcznie —/);
    const odProgu = page.getByTestId("feature-bound-polozenie-na-pietrze-lepsza-od");
    await expect(baner).toHaveCount(0);

    // Przepisanie tekstu poziomu ręką odłącza progi liczbowe (FH.1).
    await wiersz.getByRole("button", { name: "Edytuj skalę" }).click();
    await expect(odProgu).not.toHaveValue("");
    await page.getByTestId("feature-def-polozenie-na-pietrze-lepsza").fill("własny opis poziomu");
    await expect(baner).toContainText(
      "progi liczbowe zostały odłączone, więc podpowiedź oceny i ocena lokali o cenie " +
        "skrajnej z danych nie działają dla tej cechy",
    );
    // Piętro nie ma mediany próby, więc baner nie dopisuje o niej nawiasu.
    await expect(baner).not.toContainText("mediana próby");
    // Pola „od”/„do” zostają na ekranie (makieta 8) — tylko puste.
    await expect(odProgu).toBeVisible();
    await expect(odProgu).toHaveValue("");

    // Przywrócenie z presetu: baner znika, progi wracają.
    await wiersz.getByRole("button", { name: "Przywróć progi z presetu" }).click();
    await expect(baner).toHaveCount(0);
    await expect(odProgu).not.toHaveValue("");
  });
});
