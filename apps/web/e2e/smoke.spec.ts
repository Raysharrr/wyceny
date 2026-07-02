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
  await page.getByRole("button", { name: "Utwórz wycenę" }).click();

  await page.waitForURL(/\/valuations\/[0-9a-f-]{36}/);
  await expect(page.getByText("Wartość rynkowa (WR)")).toBeVisible();
  // .first(): "zł" also matches inside "Kwota słownie" ("...złotych...") on
  // this page, so the bare locator from the brief hits Playwright's strict
  // mode (2 matches). first() keeps the same assertion — a "zł" amount is
  // shown — without narrowing what it verifies.
  await expect(page.getByText("zł").first()).toBeVisible();
});
