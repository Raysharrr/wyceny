import { expect, test } from "@playwright/test";
import { SubjectStep, rateAllFeatures } from "./pages/wizard";
import { atrapaTranskrypcji, tekstZakladek } from "./support/kw-transcribe-route";

// Offline smoke: manual-entry paths only (the RCN fetch needs live GUGiK).
// The admin password is read from the SAME variable the seed script uses
// (`scripts/seed-users.ts`) — hard-coding it here would silently drift from
// the seeded account the moment the password is rotated.
const ADMIN_PASSWORD = ((): string => {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      "Brak SEED_ADMIN_PASSWORD — smoke loguje się na konto zasiane przez `pnpm seed`. " +
        "Ustaw tę samą wartość, której użyto przy zasiewie bazy.",
    );
  }
  return password;
})();

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#email").fill("aneta@wyceny.test");
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await page.waitForURL("**/valuations");
}

async function createDraftStep1(page: import("@playwright/test").Page) {
  await page.goto("/valuations/new");
  await page.locator("#address").fill("ul. Testowa 1, Poznań");
  await page.locator("#area").fill("54.3");
  await page.locator("#purpose").selectOption("sprzedaz");
  await page.locator("#client").fill("p. Test Testowy");
  // ADR-021: obie księgi zbadane przez PRZEPISANIE treści (atrapa
  // /kw-transcribe w przeglądarce) — bez tego krok 7 blokuje na B-06,
  // niezależnie od tego, jak kompletny jest reszta szkicu.
  await new SubjectStep(page).examineBooks({ kwLokalu: "KW-TEST-1", kwGruntu: "KW-TEST-2" });
  // M-10: §9 nazywa dokument, z którego odczytano przeznaczenie. Bez kompletu
  // pięciu części B-02 nie wypuści operatu, a §9 nie wydrukuje o przeznaczeniu
  // nic — dokładnie to zgłosiła Aneta 14.09.
  await page.locator("#subject-przeznaczenie-rodzaj-mpzp").check();
  await page.locator("#subject-przeznaczenie-nazwa").fill("Plan Testowy");
  await page.locator("#subject-przeznaczenie-uchwala").fill("Nr I/1/2020 Rady Gminy Testowej");
  await page.locator("#subject-przeznaczenie-data").fill("2020-01-01");
  await page
    .locator("#subject-przeznaczenie-symbol")
    .fill("1MW/U – tereny zabudowy mieszkaniowej wielorodzinnej");
  await page.getByRole("button", { name: "Dane się zgadzają — dalej" }).click();
  await page.waitForURL(/\/valuations\/[0-9a-f-]{36}\?step=2/);
  // Regression net for the RSC-boundary 500 (server render of an existing
  // draft's step 1 calling a "use client" module's export): revisiting step 1
  // on a saved draft must render, not crash.
  await page.goto(page.url().replace("step=2", "step=1"));
  await expect(page.getByRole("button", { name: "Dane się zgadzają — dalej" })).toBeVisible();
  await page.goto(page.url().replace("step=1", "step=2"));
}

async function walkToOperat(page: import("@playwright/test").Page, prices: string[]) {
  // step 2: data oględzin + dalej
  await page.locator("#inspectionDate").fill("2026-07-01");
  await page.locator("#inspectionDate").blur();
  await page.getByRole("link", { name: "Dalej" }).click();
  await page.waitForURL(/step=3/);
  // step 3: transakcje ręczne
  for (let i = 3; i < prices.length; i++)
    await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  for (const [i, price] of prices.entries())
    await page.locator(`#comparable-price-${i}`).fill(price);
  await page.getByRole("button", { name: "Zatwierdź próbę i dalej" }).click();
  await page.waitForURL(/step=4/);
  // step 4: preset cech — każda cecha dostaje ocenę (brak oceny domyślnej, ADR-016)
  await rateAllFeatures(page);
  await page.getByRole("button", { name: "Zatwierdź cechy i dalej" }).click();
  await page.waitForURL(/step=5/);
  // step 5: kalkulacja
  await expect(page.getByText("Suma współczynników (ΣUi)")).toBeVisible();
  await page.getByRole("button", { name: "Zatwierdź kalkulację i dalej" }).click();
  await page.waitForURL(/step=6/);
  // step 6: placeholder
  await page.getByRole("link", { name: "Dalej" }).click();
  await page.waitForURL(/step=7/);
}

test("wizard draft, 3 transactions: blocked on operat step, with a link back to step 3", async ({
  page,
}) => {
  await login(page);
  await createDraftStep1(page);
  await walkToOperat(page, ["12000", "13000", "14000"]);
  const blockers = page.getByTestId("gate-blockers");
  await expect(blockers).toContainText("co najmniej 12");
  await expect(page.getByTestId("approve-button")).toBeDisabled();

  // T8: step 7 reports and links back — the sample is fixed where it is
  // visible. Following the link is the assertion that matters: a href that
  // resolves to a step the draft cannot open would leave the appraiser
  // exactly where they were.
  await blockers.getByRole("link", { name: /Przejdź do kroku 3\. Próba/ }).click();
  await page.waitForURL(/step=3/);
  await expect(page.getByRole("button", { name: "Zatwierdź próbę i dalej" })).toBeVisible();
});

test("wizard full flow: 12 transactions → approve → Zatwierdzony + PDF", async ({ page }) => {
  await login(page);
  await createDraftStep1(page);
  await walkToOperat(
    page,
    Array.from({ length: 12 }, (_, i) => String(12_000 + i * 100)),
  );
  // T8: step 7 offers no confirmation at all any more — each group is
  // confirmed by the save on the step that shows it (T7). The four buttons
  // are gone from the component, so this asserts the whole class rather than
  // the one the flow used to click.
  await expect(page.getByRole("button", { name: /^Potwierdź / })).toHaveCount(0);
  await expect(page.getByTestId("gate-blockers")).toHaveCount(0);
  await expect(page.getByTestId("approve-button")).toBeEnabled();
  // T10-T12: the appraiser reads the document BEFORE issuing it, and issuing
  // reuses what they read. With no blockers the render starts on mount, so
  // this is the whole slice in one assertion — and the only place the preview
  // is exercised against a real worker and a real render. The timeout is the
  // worker's DOCX->PDF conversion, not the page.
  await expect(page.locator('iframe[title="Podgląd operatu (PDF)"]')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("valuation-status")).toHaveText("Zatwierdzony", {
    timeout: 30_000,
  });
  const iframe = page.locator('iframe[title="Operat szacunkowy (PDF)"]');
  await expect(iframe).toBeVisible();
  const pdfResponse = await page.request.get((await iframe.getAttribute("src"))!);
  expect(pdfResponse.status()).toBe(200);
  expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByRole("link", { name: "Pobierz DOCX", exact: true })).toBeVisible();
});

// T-22: the tools screens rendered by a REAL server. Both the crossroads and
// `ToolsNav` build their links from one `TOOLS` list, and while that list lived
// in the `"use client"` module next to `ToolsNav` the crossroads crashed with
// "TOOLS.map is not a function" — a plain value exported from a client island
/**
 * Wariant NEGATYWNY reguły rodzaju księgi (S3d): księga LOKALU wklejona na
 * kartę gruntu. Poza testami RTL ta ścieżka nie miała pokrycia — a to właśnie
 * ona przewróciła smoke, gdy atrapa podawała obu kartom tę samą księgę.
 * Werdykt jest OSTRZEŻENIEM, nie blokadą (ADR-021 reg. 5): treść zostaje,
 * baner nazywa niezgodność, zielonej linii nie ma.
 */
test("karta gruntu ostrzega, gdy wklejono na nią księgę lokalu", async ({ page }) => {
  await login(page);
  await atrapaTranskrypcji(page, "ok", "lokal");
  await page.goto("/valuations/new");
  await page.getByTestId("kw-wklej-grunt").fill(tekstZakladek(undefined, "lokal"));
  await page.getByTestId("kw-przepisz-grunt").click();

  const karta = page.getByTestId("kw-book-grunt");
  await expect(karta.getByTestId("kw-werdykt-grunt")).toContainText(
    "rodzaj księgi (treść nie opisuje nieruchomości gruntowej, a to karta księgi gruntu)",
    { timeout: 30_000 },
  );
  await expect(karta.getByText("Sprawdź, czy wklejono właściwą księgę.")).toBeVisible();
  // Zielonej linii nie ma: sprawdzenie treści nie wypadło pomyślnie.
  await expect(karta.getByTestId("kw-transcribe-status")).toHaveCount(0);
  // Treść jednak przepisana — ostrzeżenie, nie blokada: numer z nagłówka wszedł.
  await expect(page.locator("#kwg-nr")).not.toHaveValue("");
});

// reaches a Server Component as a client reference, not as the array. jsdom has
// no RSC boundary and `next build` does not execute the page, so only a request
// to a running server sees it (same class of bug as the step-1 regression net
// above). No upload here: CI is network-free and has no worker.
test("narzędzia: rozdroże renderuje obie karty i prowadzi do konwertera i do rejestru", async ({
  page,
}) => {
  await login(page);

  await page.goto("/narzedzia");
  await expect(page.getByRole("heading", { name: "Narzędzia biura" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rejestr spółdzielczy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wydruk z RCN → Excel" })).toBeVisible();

  await page
    .locator("section")
    .filter({ hasText: "Wydruk z RCN → Excel" })
    .getByRole("link", { name: "Otwórz" })
    .click();
  await page.waitForURL("**/narzedzia/rcn-pdf");
  await expect(page.getByText("Wybierz plik")).toBeVisible();
  await expect(page.getByText("PDF, do 4 MB")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Narzędzia" });
  await expect(nav.getByRole("link", { name: "Wydruk z RCN → Excel" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await nav.getByRole("link", { name: "Rejestr spółdzielczy" }).click();
  await page.waitForURL("**/rejestr");
  await expect(page.getByRole("heading", { name: "Rejestr spółdzielczy" })).toBeVisible();

  // Review 1 R1: the pills are the first child of each page's OWN container, so
  // they line up with that page's heading — including `/rejestr/transakcja`,
  // which is `max-w-[1024px]` while the others are `max-w-[1240px]`. A fixed
  // width on the nav itself left that one hanging 108 px to the left.
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of ["/rejestr", "/rejestr/import", "/rejestr/transakcja", "/narzedzia/rcn-pdf"]) {
    await page.goto(path);
    // The FIRST PILL, not the `<nav>` box: a nav with its own horizontal
    // padding sits flush with the container while its pills are still indented,
    // so measuring the wrapper would pass on exactly the layout R1 is about.
    const pillBox = await page
      .getByRole("navigation", { name: "Narzędzia" })
      .getByRole("link")
      .first()
      .boundingBox();
    const headingBox = await page.locator("h1").first().boundingBox();
    expect(pillBox, `${path}: brak pigułek nawigacji narzędzi`).not.toBeNull();
    expect(Math.round(headingBox!.x), `${path}: pigułki nie trzymają kontenera strony`).toBe(
      Math.round(pillBox!.x),
    );
  }
});
