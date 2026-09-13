import { expect, test as setup } from "@playwright/test";
import { STORAGE_STATE } from "./storage-state";

/**
 * Logs in ONCE per run as the seeded appraiser and stores the session for the
 * `spoldzielcze` / `staging` projects (`storageState`). The password comes from the
 * same variable the seed script uses, so a rotated password never drifts.
 */

setup("zaloguj rzeczoznawcę zenon@wyceny.test", async ({ page }) => {
  const password = process.env.SEED_APPRAISER_PASSWORD;
  if (!password) {
    throw new Error(
      "Brak SEED_APPRAISER_PASSWORD — E2E loguje się na konto zasiane przez `pnpm seed` " +
        "(lokalnie / CI) albo na konto rzeczoznawcy stagingu (hasło w .env.local).",
    );
  }
  await page.goto("/login");
  await page.locator("#email").fill("zenon@wyceny.test");
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await page.waitForURL("**/valuations");
  await expect(page.getByRole("link", { name: "Rejestr spółdzielczy" }).first()).toBeVisible();
  await page.context().storageState({ path: STORAGE_STATE });
});
