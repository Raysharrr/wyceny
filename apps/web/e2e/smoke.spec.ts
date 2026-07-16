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

async function fillDraft(page: import("@playwright/test").Page, prices: string[]) {
  await page.goto("/valuations/new");
  await page.locator("#address").fill("ul. Testowa 1, Poznań");
  await page.locator("#area").fill("54.3");
  await page.locator("#purpose").selectOption("sprzedaz");
  await page.locator("#kwNumber").fill("KW-TEST-1");
  await page.locator("#client").fill("p. Test Testowy");
  await page.locator("#inspectionDate").fill("2026-07-01");
  // The form starts with 3 rows; add the rest.
  for (let i = 3; i < prices.length; i++) {
    await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  }
  for (const [i, price] of prices.entries()) {
    await page.locator(`#comparable-price-${i}`).fill(price);
  }
  await page.getByRole("button", { name: "Zapisz szkic" }).click();
  await page.waitForURL(/\/valuations\/[0-9a-f-]{36}/);
}

test("draft with 3 transactions: WR visible, approval blocked by F-4 gate", async ({ page }) => {
  await login(page);
  await fillDraft(page, ["12000", "13000", "14000"]);

  await expect(page.getByText("Wartość rynkowa (WR)")).toBeVisible();
  await expect(page.getByTestId("wr-value")).toBeVisible();
  await expect(page.getByText("Suma współczynników (ΣUi)")).toBeVisible();

  await expect(page.getByTestId("valuation-status")).toHaveText("Szkic");
  await expect(page.getByTestId("gate-blockers")).toContainText("co najmniej 12");
  await expect(page.getByTestId("approve-button")).toBeDisabled();
});

test("draft with 12 manual transactions: approve → Zatwierdzony + operat PDF/DOCX", async ({
  page,
}) => {
  await login(page);
  const prices = Array.from({ length: 12 }, (_, i) => String(12_000 + i * 100));
  await fillDraft(page, prices);

  await expect(page.getByTestId("valuation-status")).toHaveText("Szkic");
  // Manual rows are confirmed at the ACL — no to_verify, gate passes on >=12.
  await expect(page.getByTestId("approve-button")).toBeEnabled();
  await page.getByTestId("approve-button").click();

  await expect(page.getByTestId("valuation-status")).toHaveText("Zatwierdzony", {
    timeout: 30_000, // generation incl. LibreOffice conversion
  });
  await expect(page.getByText("Zatwierdzono:")).toBeVisible();

  const iframe = page.locator('iframe[title="Operat szacunkowy (PDF)"]');
  await expect(iframe).toBeVisible();
  const pdfUrl = await iframe.getAttribute("src");
  const pdfResponse = await page.request.get(pdfUrl!);
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
  expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await expect(page.getByRole("link", { name: "Pobierz DOCX" })).toBeVisible();
});
