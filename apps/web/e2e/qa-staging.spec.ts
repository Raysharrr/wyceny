import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const OUT = process.env.QA_OUT!;
const ID = readFileSync(`${OUT}/valuation-id.txt`, "utf8").trim();

test("domkniecie: potwierdzenia rzeczoznawcy + zatwierdzenie", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/login");
  await page.locator("#email").fill(process.env.QA_EMAIL!);
  await page.locator("#password").fill(process.env.QA_PASSWORD!);
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await page.waitForURL("**/valuations");
  await page.goto(`/valuations/${ID}?step=7`);
  await page.waitForTimeout(3000);

  for (let i = 0; i < 5; i++) {
    let clicked = false;
    for (const name of ["Potwierdź próbę z RCN", "Potwierdź dane przedmiotu", "Potwierdź cechy"]) {
      const b = page.getByRole("button", { name });
      if (await b.count()) {
        await b.first().click();
        await page.waitForTimeout(3000);
        clicked = true;
      }
    }
    if (!clicked) break;
  }
  const before = await page.evaluate(() => document.body.innerText);
  console.log(
    "BLOKERY PO POTWIERDZENIACH:",
    /zablokowane[\s\S]{0,400}/.exec(before)?.[0] ?? "BRAK — brama otwarta",
  );

  await expect(page.getByTestId("approve-button")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("valuation-status")).toHaveText("Zatwierdzony", {
    timeout: 300_000,
  });
  await page.screenshot({ path: `${OUT}/krok-7.png`, fullPage: true });
  const href = await page
    .getByRole("link", { name: "Pobierz DOCX", exact: true })
    .getAttribute("href");
  const docx = await page.request.get(href!);
  writeFileSync(`${OUT}/operat-wygenerowany.docx`, await docx.body());
  console.log("DOCX:", docx.status(), (await docx.body()).length);
});
