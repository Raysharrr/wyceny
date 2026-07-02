import { expect, test } from "@playwright/test";

// The one smoke path: login → create valuation → detail shows WR.
// Demo credentials come from scripts/seed.ts (local/dev only, not secrets).
test("login → create valuation → detail shows WR", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("aneta@wyceny.test");
  await page.locator("#password").fill("Admin123!");
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await page.waitForURL("**/valuations");

  await page.goto("/valuations/new");
  await page.locator("#address").fill("ul. Testowa 1, Poznań");
  await page.locator("#area").fill("54.3");

  // The form now requires >= 3 comparable transactions (KCS Task 3). Only
  // price is required per row — date/area stay blank. Default features
  // already sum to 100%, so no interaction needed there.
  const prices = ["12000", "13000", "14000"];
  for (const [i, price] of prices.entries()) {
    await page.locator(`#comparable-price-${i}`).fill(price);
  }

  await page.getByRole("button", { name: "Utwórz wycenę" }).click();

  await page.waitForURL(/\/valuations\/[0-9a-f-]{36}/);
  await expect(page.getByText("Wartość rynkowa (WR)")).toBeVisible();
  // data-testid instead of the brittle `getByText("zł").first()`: once
  // comparables render their own zł/m² prices on this page, DOM-order
  // .first() could silently match the wrong element.
  await expect(page.getByTestId("wr-value")).toBeVisible();
});
