import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistryRun, MAPPING_A, MAPPING_B, type RegistryRun } from "./fixtures/coop-registry";
import { ImportWizard } from "./pages/import-wizard";
import { InspectionStep, OperatPath, SampleStep, SubjectStep } from "./pages/wizard";

/**
 * Blok „Prawo spółdzielcze” (T-12/13/14) — ścieżki krytyczne przez UI.
 *
 * Pokrycie checklisty `docs/superpowers/qa-spoldzielcze-2026-09-12/CHECKLISTA.md`
 * (wiki-repo) — każdy test deklaruje w nazwie, które punkty (CL-n) zamyka.
 * To, co pinują testy jednostkowe (klucz dedup, straż fraz prozy,
 * `rememberedMappingFor`, `computeKcs`), jest tu sprawdzane WYŁĄCZNIE przez
 * skutek widoczny dla użytkownika.
 *
 * Determinizm: `NEXT_PUBLIC_PROSE=off` (krok 6 to link „Dalej”), `MAPS_FETCH=off`,
 * autofetch kroku 1 off w CI; geokoder workera w CI to `GEOCODER_STUB=1`
 * (punkt z hasha adresu, zero sieci). Dane per przebieg: `buildRegistryRun()`
 * (nowa spółdzielnia z unikalnym sufiksem, ceny/mieszkania zależne od runId —
 * klucz treściowy nigdy nie zderza się z poprzednim przebiegiem).
 *
 * Uruchomienie:
 *   lokalnie (web z `pnpm start`, worker z `GEOCODER_STUB=1`): `pnpm e2e`
 *   staging (ręcznie, jako zenon, bez zatwierdzania):
 *     E2E_BASE_URL=https://wyceny-mu.vercel.app SEED_APPRAISER_PASSWORD=… pnpm e2e:staging
 *   żywy RCN na ścieżce własnościowej: dodatkowo `E2E_LIVE_RCN=1`.
 * Wymaga `pdftotext` (poppler) na maszynie — podgląd operatu jest asercjonowany z tekstu PDF.
 */

// ---------------------------------------------------------------- helpers

async function importSheetA(page: Page, run: RegistryRun) {
  const wizard = new ImportWizard(page);
  await wizard.open();
  await wizard.chooseFile(
    run.xlsx,
    `rejestr-${run.runId}.xlsx`,
    run.sheetA.name,
    run.sheetA.headerRow,
  );
  return wizard;
}

async function pdfText(page: Page, iframeSrc: string): Promise<string> {
  const res = await page.request.get(iframeSrc);
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  const file = join(mkdtempSync(join(tmpdir(), "operat-")), "podglad.pdf");
  writeFileSync(file, body);
  return execFileSync("pdftotext", ["-layout", file, "-"]).toString("utf8");
}

/** Rows of „Tabela 1” as [miasto, ulica] pairs, parsed from the PDF text layout. */
function tabela1(text: string): [string, string][] {
  const from = text.indexOf("Tabela 1. Charakterystyka");
  const to = text.indexOf("Tabela 2.", from);
  return text
    .slice(from, to)
    .split("\n")
    .map((l) => l.match(/^\s*\d{4}-\d{2}\s+(\S+)\s+(.+?)\s{2,}\d/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => [m[1]!, m[2]!.trim()]);
}

// ---------------------------------------------------------------- import

test.describe("import rejestru @coop @staging-safe", () => {
  test("CL-1: nowa spółdzielnia — plik z sumą i duplikatem daje dokładne podsumowanie i wynik", async ({
    page,
  }) => {
    const run = buildRegistryRun();
    const wizard = await importSheetA(page, run);
    await wizard.newCooperative(run.cooperative);
    await wizard.goToMapping();
    await expect(wizard.layoutNotice).toHaveCount(0);
    await wizard.map(MAPPING_A);
    await wizard.goToSummary();
    await expect(wizard.summary).toHaveText(
      new RegExp(
        `^${run.sheetA.rows} wiersz\\w*, 1 duplikat pominięto, 1 wiersz sum/średnich pominięto`,
      ),
    );
    await wizard.runImport();
    await expect(wizard.result).toHaveText(
      new RegExp(
        `^Dodano ${run.sheetA.rows} now\\w+ wiersz\\w*, 1 duplikat \\(w pliku i już w rejestrze\\), lokalizacja ustalona dla \\d+, do poprawki \\d+\\.$`,
      ),
    );
    await page.getByRole("link", { name: "Przejdź do rejestru" }).click();
    await page.getByLabel("Spółdzielnia").selectOption({ label: run.cooperative });
    await expect(page.getByRole("row").filter({ hasText: run.cooperative })).toHaveCount(
      Math.min(run.sheetA.rows, 50),
    );
  });

  test("CL-3: powtórny import tego samego pliku podstawia mapowanie i dodaje 0 wierszy", async ({
    page,
  }) => {
    const run = buildRegistryRun();
    let wizard = await importSheetA(page, run);
    await wizard.newCooperative(run.cooperative);
    await wizard.goToMapping();
    await wizard.map(MAPPING_A);
    await wizard.goToSummary();
    await wizard.runImport();

    wizard = await importSheetA(page, run);
    await wizard.existingCooperative(run.cooperative);
    await wizard.goToMapping();
    await expect(wizard.layoutNotice).toHaveCount(0);
    // the remembered mapping is applied: nothing to fill, "Dalej" already enabled
    await expect(wizard.nextToSummary).toBeEnabled();
    await expect(page.getByLabel("Cena [zł]", { exact: true })).toHaveValue(MAPPING_A["Cena [zł]"]);
    await wizard.goToSummary();
    await wizard.runImport();
    await expect(wizard.result).toHaveText(/^Dodano 0 nowych wierszy, \d+ duplikat/);
  });

  test("CL-4, CL-5: arkusz o innym układzie tej samej spółdzielni — komunikat, mapowanie od zera, a powrót do pierwszego układu nie dubluje wierszy", async ({
    page,
  }) => {
    const run = buildRegistryRun();
    let wizard = await importSheetA(page, run);
    await wizard.newCooperative(run.cooperative);
    await wizard.goToMapping();
    await wizard.map(MAPPING_A);
    await wizard.goToSummary();
    await wizard.runImport();

    // sheet B: other header row → remembered mapping must NOT be laid over it
    wizard = new ImportWizard(page);
    await wizard.open();
    await wizard.chooseFile(
      run.xlsx,
      `rejestr-${run.runId}.xlsx`,
      run.sheetB.name,
      run.sheetB.headerRow,
    );
    await wizard.existingCooperative(run.cooperative);
    await wizard.goToMapping();
    await expect(wizard.layoutNotice).toHaveText(
      "Ten plik ma inny układ kolumn niż poprzedni import tej spółdzielni — zmapuj kolumny jeszcze raz. Zapamiętane mapowanie nie zostało zastosowane.",
    );
    await expect(wizard.nextToSummary).toBeDisabled();
    await wizard.map(MAPPING_B);
    await wizard.goToSummary();
    await wizard.runImport();
    await expect(wizard.result).toHaveText(new RegExp(`^Dodano ${run.sheetB.rows} now\\w+ wiersz`));

    // back to sheet A: the mapping remembered from B must not switch dedup off (staging O-1)
    wizard = await importSheetA(page, run);
    await wizard.existingCooperative(run.cooperative);
    await wizard.goToMapping();
    await expect(wizard.layoutNotice).toBeVisible();
    await wizard.map(MAPPING_A);
    await wizard.goToSummary();
    await wizard.runImport();
    await expect(wizard.result).toHaveText(/^Dodano 0 nowych wierszy/);
  });

  test("CL-1 (negatywny): brak wymaganego mapowania blokuje „Dalej” i nazywa brakujące pola", async ({
    page,
  }) => {
    const run = buildRegistryRun();
    const wizard = await importSheetA(page, run);
    await wizard.newCooperative(run.cooperative);
    await wizard.goToMapping();
    await wizard.map({ "Adres (ulica / osiedle)": MAPPING_A["Adres (ulica / osiedle)"] });
    await expect(wizard.nextToSummary).toBeDisabled();
    await expect(wizard.requiredHint).toHaveText(
      "Zmapuj pola wymagane: Nr budynku, Nr mieszkania, Powierzchnia [m²], Cena [zł], Data transakcji.",
    );
  });
});

// ---------------------------------------------------------------- formularz ręczny

test.describe("formularz ręczny @coop @staging-safe", () => {
  test("CL-2 (negatywny): duplikat odrzucany po polsku bez adresu, zero nie przechodzi", async ({
    page,
  }) => {
    const run = buildRegistryRun();
    await page.goto("/rejestr/transakcja");
    await page.getByLabel("Spółdzielnia", { exact: true }).selectOption("__new__");
    await page.getByLabel("Nazwa nowej spółdzielni").fill(run.cooperative);
    const fill = async (area: string) => {
      await page.getByLabel(/^Data transakcji/).fill("2025-05-05");
      await page.getByLabel(/^Adres \(ulica \/ osiedle\)/).fill("os. Piastowskie");
      await page.getByLabel(/^Nr budynku/).fill("7");
      await page.getByLabel(/^Nr mieszkania/).fill(run.runId.slice(-3));
      await page.getByLabel(/^Powierzchnia \(m²\)/).fill(area);
      await page.getByLabel(/^Cena \(zł\)/).fill("455000");
    };
    await fill("45,5");
    await page.getByRole("button", { name: "Zapisz i dodaj kolejną" }).click();
    await expect(page.getByRole("status")).toHaveText(/^Zapisano/);

    await fill("45,5");
    await page.getByRole("button", { name: "Zapisz i dodaj kolejną" }).click();
    // Next.js keeps an empty route announcer with role=alert — filter to the one with text.
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toHaveText(
      "Taka transakcja jest już w rejestrze (ten sam adres, mieszkanie i data albo ten sam numer repertorium).",
    );
    await expect(alert).not.toContainText("Piastowskie");

    await fill("0");
    await page.getByRole("button", { name: "Zapisz i dodaj kolejną" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(
      "Powierzchnia i cena muszą być większe od zera.",
    );
  });
});

// ---------------------------------------------------------------- wycena spółdzielcza

test.describe("wycena spółdzielcza @coop @staging-safe", () => {
  let run: RegistryRun;

  test.beforeAll(async ({ browser }) => {
    // One register per worker, imported THROUGH THE UI (the import tests above
    // prove the wizard; here it is only the data builder for the wizard steps).
    run = buildRegistryRun();
    const page = await browser.newPage();
    const wizard = await importSheetA(page, run);
    await wizard.newCooperative(run.cooperative);
    await wizard.goToMapping();
    await wizard.map(MAPPING_A);
    await wizard.goToSummary();
    await wizard.runImport();
    await expect(wizard.result).toHaveText(new RegExp(`^Dodano ${run.sheetA.rows} now`));
    await page.close();
  });

  test("CL-7, CL-9, CL-13: od rodzaju prawa w kroku 1 do podglądu operatu — próba z rejestru, brak RCN, Tabela 1 z ulicą i „—”, §7 o spółdzielni", async ({
    page,
  }) => {
    const subject = new SubjectStep(page);
    await subject.open();
    await subject.fill({
      right: "spoldzielcze",
      address: "os. Piastowskie 20, Poznań",
      area: "43.34",
      client: `QA E2E ${run.runId}`,
      basement: true,
    });
    await expect(subject.summary).toContainText("Rodzaj prawa");
    await expect(subject.summary).toContainText("Spółdzielcze własnościowe prawo do lokalu");
    await expect(subject.summary).toContainText("Krok 3 pobierze próbę z rejestru biura");
    await expect(page.getByTestId("kw-number-coop-hint")).toBeVisible();
    await subject.save();
    await new InspectionStep(page).fillDateAndContinue();

    const sample = new SampleStep(page);
    await expect(sample.registerButton).toBeVisible();
    await expect(sample.rcnButton).toHaveCount(0);
    await expect(page.getByText("RCN")).toHaveCount(0);
    await sample.fetch();
    await expect(sample.banner).toContainText("z rejestru biura");
    await expect(sample.banner).toContainText(run.cooperative.replace(/^SM /, ""));
    const proposed = await sample.proposedRows.count();
    expect(proposed).toBeGreaterThanOrEqual(12);
    await expect(sample.registryBadges.first()).toBeVisible();
    await expect(sample.shortfall).toHaveCount(0);

    // reject → restore: the row comes back stamped as a register row, not RCN
    await sample.rejectFirstProposed();
    await expect(page.getByRole("button", { name: /^Odrzucone \(/ })).toBeVisible();
    await sample.restoreFirstRejected();
    await expect(sample.proposedRows).toHaveCount(proposed);
    await expect(sample.registryBadges).toHaveCount(await sample.registryBadges.count());
    await sample.confirmAndContinue();

    const operat = new OperatPath(page);
    await operat.throughToOperat();
    const iframe = await operat.openPreview();
    const text = await pdfText(page, (await iframe.getAttribute("src"))!);

    expect(text).toContain("spółdzielczego własnościowego prawa do lokalu mieszkalnego");
    expect(text).toContain("pozyskane ze spółdzielni mieszkaniowej");
    expect(text).toMatch(/nie założono księgi/);
    expect(text).toMatch(/korzystania z piwnicy/);
    expect(text).not.toMatch(/prawa własności|prawo własności/);
    const rows = tabela1(text);
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const [miasto, ulica] of rows) {
      expect(miasto).toBe("—");
      expect(ulica).toMatch(/^os\. /);
      expect(ulica).not.toMatch(/\d/); // street name only — never the building number
    }
  });

  test("CL-10: niedobór liczy wiersze W PRÓBIE, nie pulę po paśmie, i linkuje do Rejestru", async ({
    page,
  }) => {
    const subject = new SubjectStep(page);
    await subject.open();
    // 200 m²: the ±30 % band (140–260 m²) admits none of the fixture rows — of
    // THIS run or of any other run sharing the register (the office register is
    // one pool, so a count that depended on what other runs imported would be
    // flaky). The message must then say exactly what the table shows: zero rows,
    // below the required twelve, with the way out (the register) linked.
    await subject.fill({
      right: "spoldzielcze",
      address: "os. Piastowskie 20, Poznań",
      area: "200",
      client: `QA E2E ${run.runId} niedobór`,
    });
    await subject.save();
    await new InspectionStep(page).fillDateAndContinue();
    const sample = new SampleStep(page);
    await sample.fetch();
    await expect(sample.proposedRows).toHaveCount(0);
    await expect(sample.shortfall).toContainText(/\b0 transakcji/);
    await expect(sample.shortfall).toContainText("wymagane 12");
    await expect(
      sample.shortfall.getByRole("link", { name: "Dodaj transakcje w Rejestrze →" }),
    ).toHaveAttribute("href", "/rejestr");
  });
});

// ---------------------------------------------------------------- własność — regresja

test.describe("wycena własnościowa — kontrola regresji @coop @staging-safe", () => {
  test("CL-16: kafel bez „Co się zmieni dalej”, krok 3 z przyciskiem RCN i bez śladu rejestru", async ({
    page,
  }) => {
    const subject = new SubjectStep(page);
    await subject.open();
    await subject.fill({
      right: "wlasnosc",
      address: "ul. Kościelna 33, Poznań",
      area: "54.3",
      client: "QA E2E własność",
      kw: "KW-TEST-E2E",
    });
    await expect(subject.summary).toContainText("Własność lokalu");
    await expect(subject.summary).not.toContainText("Co się zmieni dalej");
    await expect(page.getByRole("checkbox", { name: "Lokal ma przynależną piwnicę" })).toHaveCount(
      0,
    );
    await subject.save();
    await new InspectionStep(page).fillDateAndContinue();
    const sample = new SampleStep(page);
    await expect(sample.rcnButton).toBeVisible();
    await expect(sample.registerButton).toHaveCount(0);
    await expect(sample.registryBadges).toHaveCount(0);
    await expect(sample.shortfall).toHaveCount(0);
  });

  test("CL-16 (żywy RCN, tylko E2E_LIVE_RCN=1): pobranie z RCN daje próbę bez odznak rejestru", async ({
    page,
  }) => {
    test.skip(process.env.E2E_LIVE_RCN !== "1", "żywe GUGiK tylko za flagą E2E_LIVE_RCN=1");
    const subject = new SubjectStep(page);
    await subject.open();
    await subject.fill({
      right: "wlasnosc",
      address: "ul. Kościelna 33, Poznań",
      area: "54.3",
      client: "QA E2E własność RCN",
      kw: "KW-TEST-E2E",
    });
    await subject.save();
    await new InspectionStep(page).fillDateAndContinue();
    const sample = new SampleStep(page);
    await sample.fetch();
    await expect(sample.banner).toContainText("z RCN");
    await expect(sample.proposedRows).toHaveCount(20);
    await expect(sample.registryBadges).toHaveCount(0);
  });
});
