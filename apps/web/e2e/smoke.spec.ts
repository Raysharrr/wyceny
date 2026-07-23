import { expect, test } from "@playwright/test";

// Offline smoke: manual-entry paths only (the RCN fetch needs live GUGiK).
// Demo credentials come from scripts/seed.ts (local/dev only, not secrets).

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#email").fill("aneta@wyceny.test");
  await page.locator("#password").fill("Admin123!");
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

test("wizard draft, 3 transactions: blocked by F-4 on operat step", async ({ page }) => {
  await login(page);
  await createDraftStep1(page);
  await walkToOperat(page, ["12000", "13000", "14000"]);
  await expect(page.getByTestId("gate-blockers")).toContainText("co najmniej 12");
  await expect(page.getByTestId("approve-button")).toBeDisabled();
});

test("wizard full flow: 12 transactions → approve → Zatwierdzony + PDF", async ({ page }) => {
  await login(page);
  await createDraftStep1(page);
  await walkToOperat(
    page,
    Array.from({ length: 12 }, (_, i) => String(12_000 + i * 100)),
  );
  await page.getByTestId("confirm-features-button").click();
  await expect(page.getByTestId("confirm-features-button")).toHaveCount(0);
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
});
