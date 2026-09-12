import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistryRun, MAPPING_A, MAPPING_B, type RegistryRun } from "./fixtures/coop-registry";
import OWNERSHIP_PHRASES from "./fixtures/ownership-phrases.json";
import { ImportWizard } from "./pages/import-wizard";
import { InspectionStep, OperatPath, SampleStep, SubjectStep } from "./pages/wizard";

/**
 * Blok „Prawo spółdzielcze” (T-12/13/14) — ścieżki krytyczne przez UI.
 *
 * Pokrycie checklisty `docs/superpowers/qa-spoldzielcze-2026-09-12/CHECKLISTA.md`
 * (wiki-repo) — każdy test deklaruje w nazwie, które punkty (CL-n) zamyka; test
 * bez CL-n jest oznaczony „poza checklistą”. To, co pinują testy jednostkowe
 * (klucz dedup, straż fraz prozy, `rememberedMappingFor`, `computeKcs`, liczność
 * próby doboru), jest tu sprawdzane WYŁĄCZNIE przez skutek widoczny dla użytkownika.
 *
 * Rejestr biura jest JEDNĄ pulą: dobór w kroku 3 czerpie ze wszystkiego, co w nim
 * jest, nie tylko z wierszy tego przebiegu. Dlatego testy kroku 3 asercjonują
 * niezmienniki (źródło próby, odznaki, spójność komunikatu niedoboru z tabelą),
 * a nie magiczne liczby — liczność próby pilnują testy jednostkowe doboru.
 *
 * Determinizm: `NEXT_PUBLIC_PROSE=off` (krok 6 to link „Dalej”), `MAPS_FETCH=off`,
 * autofetch kroku 1 off w CI; geokoder workera w CI to `GEOCODER_STUB=1`
 * (punkt z hasha adresu, zero sieci; adres z „Zmyślona” = brak trafienia).
 * Dane per przebieg: `buildRegistryRun()` — nowa spółdzielnia z unikalnym
 * sufiksem, ceny/mieszkania zależne od runId (klucz treściowy nie zderza się
 * z poprzednim przebiegiem).
 *
 * Uruchomienie:
 *   lokalnie (web z `pnpm start`, worker z `GEOCODER_STUB=1`): `pnpm e2e`
 *   staging (ręcznie, jako zenon, bez zatwierdzania — tylko @staging-safe):
 *     E2E_BASE_URL=https://wyceny-mu.vercel.app SEED_APPRAISER_PASSWORD=… pnpm e2e:staging
 *   żywy RCN na ścieżce własnościowej: dodatkowo `E2E_LIVE_RCN=1`.
 * Wymaga `pdftotext` (poppler) — podgląd operatu jest asercjonowany z tekstu PDF.
 */

// ---------------------------------------------------------------- helpers

async function openSheetA(page: Page, run: RegistryRun) {
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

/** Import sheet A as a new cooperative — the data builder for the wizard tests. */
async function importNewRegister(page: Page, run: RegistryRun) {
  const wizard = await openSheetA(page, run);
  await wizard.newCooperative(run.cooperative);
  await wizard.goToMapping();
  await wizard.map(MAPPING_A);
  await wizard.goToSummary();
  await wizard.runImport();
  await expect(wizard.result).toHaveText(new RegExp(`^Dodano ${run.sheetA.rows} now`));
  return wizard;
}

/** One register per worker for the valuation tests, imported THROUGH THE UI. */
async function importInFreshContext(browser: Browser, run: RegistryRun) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await importNewRegister(page, run);
  await context.close();
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

const coopSubject = (run: RegistryRun, client: string) => ({
  right: "spoldzielcze" as const,
  address: "os. Piastowskie 20, Poznań",
  area: "43.34",
  client: `QA E2E ${run.runId} ${client}`,
});

// ---------------------------------------------------------------- import

test.describe("import rejestru @coop @staging-safe", () => {
  test("CL-1: nowa spółdzielnia — plik z sumą, duplikatem i adresem bez lokalizacji daje dokładne podsumowanie i wynik", async ({
    page,
  }) => {
    const run = buildRegistryRun();
    const wizard = await openSheetA(page, run);
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
      `Dodano ${run.sheetA.rows} nowych wierszy, 1 duplikat (w pliku i już w rejestrze), lokalizacja ustalona dla ${run.sheetA.geocoded}, do poprawki 1.`,
    );
    await page.getByRole("link", { name: "Przejdź do rejestru" }).click();
    await page.getByLabel("Spółdzielnia").selectOption({ label: run.cooperative });
    await expect(page.getByRole("row").filter({ hasText: run.cooperative })).toHaveCount(
      run.sheetA.rows,
    );
  });

  test("CL-2: adres, którego nie da się zgeokodować, ląduje na liście „do poprawki” tej spółdzielni", async ({
    page,
  }) => {
    const run = buildRegistryRun();
    await importNewRegister(page, run);
    await page.goto(
      `/rejestr?sm=${encodeURIComponent(run.cooperative)}&lokalizacja=do-poprawki&okres=all`,
    );
    const rows = page.getByRole("row").filter({ hasText: run.cooperative });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("os. Zmyślona Nieistniejąca");
    await expect(rows.first()).toContainText("do poprawki");
  });

  test("CL-3: powtórny import tego samego pliku podstawia mapowanie i dodaje 0 wierszy", async ({
    page,
  }) => {
    const run = buildRegistryRun();
    await importNewRegister(page, run);

    const wizard = await openSheetA(page, run);
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
    await importNewRegister(page, run);

    // sheet B: other header row → remembered mapping must NOT be laid over it
    let wizard = new ImportWizard(page);
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
    wizard = await openSheetA(page, run);
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
    const wizard = await openSheetA(page, run);
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
  test("poza checklistą (negatywne): duplikat odrzucany po polsku bez adresu, zero nie przechodzi", async ({
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
      // the full run id: the dedup key is content-based, a short suffix would
      // collide with an earlier run on a long-lived register
      await page.getByLabel(/^Nr mieszkania/).fill(run.runId);
      await page.getByLabel(/^Powierzchnia \(m²\)/).fill(area);
      await page.getByLabel(/^Cena \(zł\)/).fill("455000");
    };
    // Next.js keeps an empty route announcer with role=alert — filter to the one with text.
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });

    await fill("45,5");
    await page.getByRole("button", { name: "Zapisz i dodaj kolejną" }).click();
    await expect(page.getByRole("status")).toHaveText(/^Zapisano/);

    await fill("45,5");
    await page.getByRole("button", { name: "Zapisz i dodaj kolejną" }).click();
    await expect(alert).toHaveText(
      "Taka transakcja jest już w rejestrze (ten sam adres, mieszkanie i data albo ten sam numer repertorium).",
    );
    await expect(alert).not.toContainText("Piastowskie");

    await fill("0");
    await page.getByRole("button", { name: "Zapisz i dodaj kolejną" }).click();
    await expect(alert).toHaveText("Powierzchnia i cena muszą być większe od zera.");
  });
});

// ---------------------------------------------------------------- wycena spółdzielcza

test.describe("wycena spółdzielcza @coop @staging-safe", () => {
  // Heavy path: an import in beforeAll, a sample fetch over the WHOLE office
  // register (thousands of rows after many runs → tens of seconds) and a PDF
  // render — one explicit budget instead of a global stretch.
  test.setTimeout(180_000);

  let run: RegistryRun;

  test.beforeAll(async ({ browser }) => {
    run = buildRegistryRun();
    await importInFreshContext(browser, run);
  });

  test("CL-7, CL-9, CL-13 (podgląd): od rodzaju prawa w kroku 1 do podglądu operatu — próba z rejestru, brak RCN, Tabela 1 z ulicą i „—”, §7 o spółdzielni", async ({
    page,
  }) => {
    const subject = new SubjectStep(page);
    await subject.open();
    await subject.fill({ ...coopSubject(run, "piwnica"), basement: true });
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
    // Source of the sample — the banner names the register; it lists cooperatives
    // of the 60 best-ranked rows only, so this run's SM need not be among them on a
    // large office register (not an invariant, hence not asserted).
    await expect(sample.banner).toContainText("z rejestru biura");
    await expect(sample.proposedRows).not.toHaveCount(0);
    // every row in the sample is stamped as a register row — none slipped in as RCN
    await expect(
      sample.proposedRows.filter({ hasNotText: "Rejestr SM — do weryfikacji" }),
    ).toHaveCount(0);
    const rowsBefore = await sample.expectShortfallConsistentWithTable();
    const alternatesBefore = await sample.alternateRows.count();
    const badgesBefore = await sample.registryBadges.count();
    const rejectedBefore = await sample.rejectedCount();

    // CL-9: reject → the sample refills from the alternates → restore brings the row back as a register row
    await sample.rejectFirstProposed();
    await sample.expectRefilledAfterReject(rowsBefore, alternatesBefore, rejectedBefore);
    await sample.restoreFirstRejected();
    await expect(sample.proposedRows).toHaveCount(rowsBefore);
    await expect(sample.registryBadges).toHaveCount(badgesBefore);
    await sample.confirmAndContinue();

    const operat = new OperatPath(page);
    await operat.throughToOperat();
    const iframe = await operat.openPreview();
    const text = await pdfText(page, (await iframe.getAttribute("src"))!);

    expect(text).toContain("spółdzielczego własnościowego prawa do lokalu mieszkalnego");
    expect(text).toContain("pozyskane ze spółdzielni mieszkaniowej");
    expect(text).toMatch(/nie założono księgi/);
    expect(text).toMatch(/korzystania z piwnicy/);
    // All 13 forms the worker's prose guard refuses — except the two places where the
    // TEMPLATE itself still says „nieruchomości lokalowych” (§12.2 and the caption of
    // Tabela 1; known follow-up from review 2 of PR #39, decision for Aneta). Those two
    // are pinned exactly, so a third occurrence (e.g. from prose) still fails.
    const lower = text.toLowerCase();
    for (const phrase of OWNERSHIP_PHRASES.filter((p) => p !== "nieruchomości lokalowych"))
      expect(lower).not.toContain(phrase);
    expect(lower.match(/nieruchomości lokalowych/g) ?? []).toHaveLength(2);
    const rows = tabela1(text);
    expect(rows).toHaveLength(rowsBefore);
    for (const [miasto, ulica] of rows) {
      expect(miasto).toBe("—");
      expect(ulica).toMatch(/^os\. /);
      expect(ulica).not.toMatch(/\d/); // street name only — never the building number
    }
  });

  test("CL-10: komunikat niedoboru zgadza się z tabelą — widoczny tylko poniżej 12 wierszy, z tą samą liczbą i linkiem do Rejestru", async ({
    page,
  }) => {
    const subject = new SubjectStep(page);
    await subject.open();
    // 200 m²: a band (140–260 m²) the fixture never feeds, so on a register that
    // holds only E2E data the sample is empty — but the assertion is the
    // invariant (message ⇔ table), not the emptiness, because the office
    // register is one shared pool.
    await subject.fill({ ...coopSubject(run, "niedobór"), area: "200" });
    await subject.save();
    await new InspectionStep(page).fillDateAndContinue();
    const sample = new SampleStep(page);
    await sample.fetch();
    await sample.expectShortfallConsistentWithTable();
  });
});

// ---------------------------------------------------------------- zatwierdzenie (tylko CI — nigdy na stagingu)

test.describe("zatwierdzenie operatu spółdzielczego @coop", () => {
  // Heavy path: an import in beforeAll, a sample fetch over the WHOLE office
  // register (thousands of rows after many runs → tens of seconds) and a PDF
  // render — one explicit budget instead of a global stretch.
  test.setTimeout(180_000);

  let run: RegistryRun;

  test.beforeAll(async ({ browser }) => {
    run = buildRegistryRun();
    await importInFreshContext(browser, run);
  });

  test("CL-13 (zatwierdzenie): „Zatwierdź i generuj operat” wydaje operat spółdzielczy — status Zatwierdzony, DOCX do pobrania", async ({
    page,
  }) => {
    // The gate needs the step-1 geocode provenance, which only the live subject
    // autofetch writes (GEOPOZ/UUG — off in CI, network-free). Runs locally with a
    // build that has NEXT_PUBLIC_SUBJECT_AUTOFETCH on; never on staging (it issues an operat).
    test.skip(
      process.env.E2E_APPROVE !== "1",
      "zatwierdzenie tylko lokalnie z żywym autofetch: E2E_APPROVE=1",
    );
    const subject = new SubjectStep(page);
    await subject.open();
    await subject.fill({ ...coopSubject(run, "zatwierdzenie"), basement: true });
    await subject.waitForSubjectData();
    await subject.save();
    await new InspectionStep(page).fillDateAndContinue();
    const sample = new SampleStep(page);
    await sample.fetch();
    await sample.confirmAndContinue();
    const operat = new OperatPath(page);
    await operat.throughToOperat();
    await operat.approve();
    await expect(page.getByTestId("valuation-status")).toHaveText("Zatwierdzony");
    const docx = page.getByRole("link", { name: "Pobierz DOCX", exact: true });
    await expect(docx).toBeVisible();
    const res = await page.request.get((await docx.getAttribute("href"))!);
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 2).toString()).toBe("PK"); // a zip = a DOCX
  });
});

// ---------------------------------------------------------------- własność — regresja

test.describe("wycena własnościowa — kontrola regresji @coop @staging-safe", () => {
  const ownSubject = {
    right: "wlasnosc" as const,
    address: "ul. Kościelna 33, Poznań",
    area: "54.3",
    kw: "KW-TEST-E2E",
  };

  test("CL-16: kafel bez „Co się zmieni dalej”, krok 3 z przyciskiem RCN i bez śladu rejestru", async ({
    page,
  }) => {
    const subject = new SubjectStep(page);
    await subject.open();
    await subject.fill({ ...ownSubject, client: "QA E2E własność" });
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
    await subject.fill({ ...ownSubject, client: "QA E2E własność RCN" });
    await subject.save();
    await new InspectionStep(page).fillDateAndContinue();
    const sample = new SampleStep(page);
    await sample.fetch();
    await expect(sample.banner).toContainText("z RCN");
    await expect(sample.proposedRows).not.toHaveCount(0);
    await expect(sample.registryBadges).toHaveCount(0);
  });
});
