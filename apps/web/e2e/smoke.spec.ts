import { expect, test } from "@playwright/test";

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
  await page.locator("#kwNumber").fill("KW-TEST-1");
  await page.locator("#client").fill("p. Test Testowy");
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
  // step 4: preset cech
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
