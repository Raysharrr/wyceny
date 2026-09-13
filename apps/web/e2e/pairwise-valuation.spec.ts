import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import PizZip from "pizzip";
import { CUSTOM, PROSE_LABELS, PairwiseWizard, manualTexts } from "./pages/pairwise-wizard";

// Approval/signature fixtures are local-only, including when E2E_BASE_URL is supplied.
// Production guards are untouched; the harness refuses an accidental hosted target.
test.beforeEach(async ({ baseURL }) => {
  for (const value of [baseURL, process.env.DATABASE_URL, process.env.WORKER_URL]) {
    expect(value, "pairwise suite needs explicit local app/database/worker URLs").toBeTruthy();
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(value!).hostname);
  }
  expect(process.env.E2E_PAIRWISE).toBe("1");
  expect(process.env.NEXT_PUBLIC_PROSE).not.toBe("off");
});

test.setTimeout(120_000);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function saved(id: string) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query(
      "select inputs, stub_wr as wr, status, doc_url from valuation where id=$1",
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  } finally {
    await pool.end();
  }
}
async function storedPdf(id: string) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query("select content_bytes from document where key=$1", [
      `operat-${id}.pdf`,
    ]);
    expect(rows).toHaveLength(1);
    return rows[0].content_bytes as Buffer;
  } finally {
    await pool.end();
  }
}
async function pdf(page: Page, src: string, info: TestInfo, name: string) {
  const res = await page.request.get(src);
  expect(res.status()).toBe(200);
  const bytes = await res.body();
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const file = info.outputPath(`${name}.pdf`);
  writeFileSync(file, bytes);
  const text = execFileSync("pdftotext", ["-layout", file, "-"])
    .toString()
    .replace(/\s+/g, " ")
    .trim();
  expect(text).not.toMatch(/\{\{?|undefined|NaN/);
  await info.attach(`${name}.pdf`, { path: file, contentType: "application/pdf" });
  return { bytes, text, sha256: sha(bytes) };
}
async function docx(page: Page, info: TestInfo, name: string) {
  const href = await page
    .getByRole("link", { name: "Pobierz DOCX", exact: true })
    .getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  const bytes = await res.body();
  writeFileSync(info.outputPath(`${name}.docx`), bytes);
  const zip = new PizZip(bytes);
  const xml = zip.file("word/document.xml")!.asText();
  const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1])
    .join(" ")
    .replace(/\s+/g, " ");
  return { bytes, text, zip };
}

for (const method of ["kcs", "pp"] as const) {
  for (const right of ["wlasnosc", "spoldzielcze"] as const) {
    test(`AC01/03/04/08/09/11: ${method} × ${right} save → reload → manual Opisy → real PDF → approve → sign`, async ({
      page,
    }, info) => {
      const tag = `${method}-${right}-${randomUUID().slice(0, 8)}`;
      const selectedCount = right === "spoldzielcze" ? 5 : 3;
      const flow = new PairwiseWizard(page);
      // Same synthetic wave for every test, never a person's signature.
      await page.goto("/profile");
      await page
        .getByLabel("Skan podpisu", { exact: true })
        .setInputFiles(path.resolve("tests/fixtures/signature-synthetic.png"));
      await page.getByRole("button", { name: "Zapisz podpis", exact: true }).click();
      await expect(page.getByRole("img", { name: "Aktualny skan podpisu" })).toBeVisible();
      const id = await flow.create(right, tag);
      await flow.method(method);
      await flow.pool(method === "kcs" ? 12 : 6);
      if (method === "pp") for (let n = 1; n <= selectedCount; n++) await flow.choice(n).check();
      await flow.sample();
      await flow.custom();
      if (method === "pp") await flow.assess(selectedCount);
      await flow.features(method);
      const before = await saved(id);
      expect(before.inputs.methodConfirmed).toBe(true);
      expect(before.inputs.features.find((f: { key: string }) => f.key === "inne")).toMatchObject({
        name: CUSTOM,
        weight: 0.5975,
        ratingScale: "two",
      });
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Zatwierdź kalkulację i dalej", exact: true }),
      ).toBeVisible();
      await flow.calculation();
      // Active editors are mandatory. Keyless worker returns an honest failure;
      // wait for the editor to become enabled, then exercise real manual confirm.
      await expect(page.getByRole("textbox", { name: PROSE_LABELS[0], exact: true })).toBeEnabled({
        timeout: 30_000,
      });
      await expect(
        page.getByText("Generator prozy sekcji opisowych (FR-6) — w przygotowaniu.", {
          exact: false,
        }),
      ).toHaveCount(0);
      const texts = manualTexts(tag);
      await flow.prose(texts);
      await page.goto(`/valuations/${id}?step=6`);
      for (const [i, label] of PROSE_LABELS.entries())
        await expect(page.getByRole("textbox", { name: label, exact: true })).toHaveValue(texts[i]);
      await expect(page.getByText("Rzeczoznawca — potwierdzone", { exact: true })).toHaveCount(6);
      await flow.prose(texts);
      const preview = page.getByTitle("Podgląd operatu (PDF)");
      await expect(preview).toBeVisible({ timeout: 60_000 });
      const previewPdf = await pdf(page, (await preview.getAttribute("src"))!, info, "preview");
      for (const text of texts) expect(previewPdf.text).toContain(text);
      expect(previewPdf.text).toContain(CUSTOM);
      expect(previewPdf.text).toMatch(
        right === "spoldzielcze" ? /spółdzielczego własnościowego prawa/ : /prawa własności/,
      );
      if (method === "pp") {
        for (const title of [
          "Charakterystyka wybranych",
          "Porównanie nieruchomości wycenianej",
          "Obliczenie skorygowanej ceny",
          "Określenie wartości rynkowej",
        ])
          expect(previewPdf.text).toContain(title);
        expect(previewPdf.text).toContain(selectedCount === 3 ? "455 000" : "460 000");
        const columns = Array.from({ length: selectedCount }, (_, i) => i + 1).join(" ");
        expect(previewPdf.text.includes(`Cecha Przedmiot ${columns} Data transakcji`)).toBe(true);
      } else {
        expect(previewPdf.text).toContain("494 200");
        expect(previewPdf.text).toContain("40,25");
        expect(previewPdf.text).toContain("59,75");
      }
      await page.getByRole("button", { name: "Zatwierdź i generuj operat", exact: true }).click();
      await expect(page.getByTestId("valuation-status")).toHaveText("Zatwierdzony", {
        timeout: 60_000,
      });
      const issued = page.getByTitle("Operat szacunkowy (PDF)");
      const approvedUrl = (await issued.getAttribute("src"))!;
      const approved = await pdf(page, approvedUrl, info, "approved");
      const approvedDocx = await docx(page, info, "approved");
      await page
        .getByRole("button", { name: "Podpisz operat (nieodwracalne)", exact: true })
        .click();
      await expect(page.getByTestId("valuation-status")).toHaveText("Podpisany", {
        timeout: 60_000,
      });
      const signedUrl = (await issued.getAttribute("src"))!;
      const signed = await pdf(page, signedUrl, info, "signed");
      const signedDocx = await docx(page, info, "signed");
      expect(signed.text).toBe(approved.text);
      for (const text of texts)
        expect(signed.text.includes(text), "signed PDF retains each accepted manual section").toBe(
          true,
        );
      expect(signedDocx.text).toBe(approvedDocx.text);
      const signature = readFileSync("tests/fixtures/signature-synthetic.png");
      expect(
        Object.keys(signedDocx.zip.files)
          .filter((n) => n.startsWith("word/media/"))
          .some((n) => signedDocx.zip.file(n)?.asNodeBuffer().equals(signature)),
      ).toBe(true);
      expect(sha(await storedPdf(id))).toBe(approved.sha256);
      await page.goto(`/valuations/${id}?step=4`);
      await expect(
        page.getByRole("button", { name: "Utwórz nową wersję", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^(Potwierdź oceny|Zatwierdź cechy|Podpisz operat)/ }),
      ).toHaveCount(0);
      expect(sha(await (await page.request.get(signedUrl)).body())).toBe(signed.sha256);
      const final = await saved(id);
      expect(final.status).toBe("signed");
      expect(final.wr).toBe(method === "kcs" ? 494200 : selectedCount === 3 ? 455000 : 460000);
      expect(final.inputs.prose.sections.uzasadnienie.value).toBe(texts[5]);
      await page.screenshot({ path: info.outputPath("signed.png"), fullPage: true });
      await info.attach("lifecycle.json", {
        body: JSON.stringify({
          id,
          method,
          right,
          wr: final.wr,
          preview: previewPdf.sha256,
          approved: approved.sha256,
          signed: signed.sha256,
        }),
        contentType: "application/json",
      });
    });
  }
}

test("AC01/02/05: explicit method, KCS 11/12, PP 2/3/5, maximum and identity-preserving reorder", async ({
  page,
}) => {
  const flow = new PairwiseWizard(page);
  const id = await flow.create("wlasnosc", randomUUID().slice(0, 8));
  await page.getByLabel("Wybierz metodę wyceny").selectOption("pp");
  await page.reload();
  await expect(page.getByText("Metoda wymaga potwierdzenia.", { exact: true })).toBeVisible();
  expect((await saved(id)).inputs.methodConfirmed).not.toBe(true);
  await flow.method("kcs");
  await flow.pool(11);
  await flow.sample();
  await flow.features("kcs");
  await expect(page.getByTestId("calculation-blockers")).toContainText("co najmniej 12");
  await expect(
    page.getByRole("button", { name: "Zatwierdź kalkulację i dalej", exact: true }),
  ).toHaveCount(0);
  await page.goto(`/valuations/${id}?step=3`);
  await page.getByRole("button", { name: "Dodaj transakcję", exact: true }).click();
  await page.getByPlaceholder("zł/m²", { exact: true }).nth(11).fill("10100");
  await flow.sample();
  await flow.features("kcs");
  await flow.calculation();
  expect((await saved(id)).wr).toBe(477500);
  await page.goto(`/valuations/${id}?step=3`);
  await flow.method("pp");
  expect((await saved(id)).wr).toBeNull();
  await expect(flow.choice(1)).not.toBeChecked();
  await flow.choice(1).check();
  await flow.choice(2).check();
  await expect(page.getByRole("button", { name: "Zapisz pulę", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zapisz pulę", exact: true }).click();
  await expect(
    page.getByText("Pula zapisana. Do porównywania parami wybierz od 3 do 5 transakcji.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/step=3/);
  expect((await saved(id)).inputs.pairwise.selectedComparableIds).toHaveLength(2);
  await flow.choice(3).check();
  await flow.choice(4).check();
  await flow.choice(5).check();
  await expect(flow.choice(6)).toBeDisabled();
  await page.getByRole("button", { name: /^Przesuń wcześniej — Transakcja 5 w puli:/ }).click();
  await flow.sample();
  const snapshot = (await saved(id)).inputs;
  expect(snapshot.comparables).toHaveLength(12);
  const ids = snapshot.comparables.map((r: { id: string }) => `manual:${r.id}`);
  expect(snapshot.pairwise.selectedComparableIds).toEqual([ids[0], ids[1], ids[2], ids[4], ids[3]]);
  await page.goto(`/valuations/${id}?step=3`);
  await page.reload();
  for (const n of [1, 2, 3, 4, 5]) await expect(flow.choice(n)).toBeChecked();
  await flow.choice(4).uncheck();
  await flow.choice(5).uncheck();
  await flow.sample();
  expect((await saved(id)).inputs.pairwise.selectedComparableIds).toHaveLength(3);
  await flow.custom();
  await flow.assess(3);
  await page.getByLabel(`Ocena: ${CUSTOM} — porównanie 3`, { exact: true }).selectOption("gorsza");
  await flow.features("pp");
  const assessed = (await saved(id)).inputs.pairwise.comparisons;
  await page.goto(`/valuations/${id}?step=3`);
  await page.getByRole("button", { name: /^Przesuń wcześniej — Transakcja 3 w puli:/ }).click();
  await flow.sample();
  await expect(page.getByLabel(`Ocena: ${CUSTOM} — porównanie 2`, { exact: true })).toHaveValue(
    "gorsza",
  );
  expect((await saved(id)).inputs.pairwise.comparisons).toEqual(assessed);
  await page.goto(`/valuations/${id}?step=3`);
  await flow.method("kcs");
  const after = (await saved(id)).inputs;
  expect(after.comparables).toEqual(snapshot.comparables);
  await expect(page.getByPlaceholder("zł/m²", { exact: true })).toHaveCount(12);
});

test("AC03/04/06/09: custom validation, scale cleanup, overrides, Enter, stale form and retained manual Opisy", async ({
  page,
  context,
}, info) => {
  const flow = new PairwiseWizard(page);
  const id = await flow.create("spoldzielcze", randomUUID().slice(0, 8));
  await flow.method("pp");
  await flow.pool(6);
  for (const n of [1, 2, 3]) await flow.choice(n).check();
  await flow.sample();
  await flow.custom();
  await expect(page.getByRole("button", { name: "+ Inna cecha", exact: true })).toHaveCount(0);
  const customName = page.getByRole("textbox", { name: "Nazwa cechy", exact: true });
  const confirm = page.getByRole("button", {
    name: "Potwierdź oceny i poprawki i dalej",
    exact: true,
  });
  await customName.fill("lokalizacja");
  await confirm.click();
  await expect(
    page.getByText(/Nazwa własnej cechy nie może powtarzać|Nazwy cech muszą być unikalne/).first(),
  ).toBeVisible();
  await customName.fill(CUSTOM);
  await page.getByRole("spinbutton", { name: `Waga: ${CUSTOM}`, exact: true }).fill("70");
  await expect(page.getByTestId("footnav-kcs-mid")).toHaveText("—");
  await confirm.click();
  await expect(page).toHaveURL(/step=4/);
  await page.getByRole("spinbutton", { name: `Waga: ${CUSTOM}`, exact: true }).fill("59.75");
  // A three-level middle rating must disappear from both subject and cells.
  await page.getByLabel(`Skala: ${CUSTOM}`, { exact: true }).selectOption("three");
  await page
    .getByRole("textbox", { name: `Definicja: ${CUSTOM} — przecietna`, exact: true })
    .fill("Pośrednie światło.");
  await page.getByRole("button", { name: `${CUSTOM}: przeciętna`, exact: true }).click();
  await page
    .getByLabel(`Ocena: ${CUSTOM} — porównanie 1`, { exact: true })
    .selectOption("przecietna");
  await page.getByLabel(`Skala: ${CUSTOM}`, { exact: true }).selectOption("two");
  await expect(
    page.getByRole("button", { name: `${CUSTOM}: przeciętna`, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel(`Ocena: ${CUSTOM} — porównanie 1`, { exact: true })).toHaveValue("");
  await expect(
    page
      .getByLabel(`Ocena: ${CUSTOM} — porównanie 1`, { exact: true })
      .getByRole("option", { name: "przeciętna", exact: true }),
  ).toHaveCount(0);
  await confirm.click();
  await expect(page).toHaveURL(/step=4/);
  await page.getByRole("button", { name: `${CUSTOM}: lepsza`, exact: true }).click();
  await flow.assess(3);
  const multiplier = page.getByLabel(`Mnożnik: ${CUSTOM} — porównanie 2`, { exact: true });
  await multiplier.fill("-1.25");
  await expect(page.getByTestId("footnav-kcs-mid")).toHaveText("—");
  const reason = page.getByLabel(`Uzasadnienie: ${CUSTOM} — porównanie 2`, { exact: true });
  await reason.fill("Syntetyczny wyjątek — sprawdzona korekta.");
  await expect(page.getByTestId("footnav-kcs-mid")).toContainText("452 500");
  await multiplier.press("Enter");
  await customName.press("Enter");
  await expect(page).toHaveURL(/step=4/);
  expect((await saved(id)).inputs.pairwise.confirmedBasis).toBeUndefined();
  // Working save remounts values and token together; wait for its navigation.
  await Promise.all([
    page.waitForEvent("framenavigated"),
    page.getByRole("button", { name: "Zapisz oceny robocze", exact: true }).click(),
  ]);
  await expect(multiplier).toHaveValue("-1.25");
  const stale = await context.newPage();
  await stale.goto(`/valuations/${id}?step=4`);
  await expect(
    stale.getByLabel(`Uzasadnienie: ${CUSTOM} — porównanie 2`, { exact: true }),
  ).toHaveValue("Syntetyczny wyjątek — sprawdzona korekta.");
  await reason.fill("Syntetyczny wyjątek po ponownej kontroli.");
  await Promise.all([
    page.waitForEvent("framenavigated"),
    page.getByRole("button", { name: "Zapisz oceny robocze", exact: true }).click(),
  ]);
  await stale
    .getByRole("button", { name: "Potwierdź oceny i poprawki i dalej", exact: true })
    .click();
  await expect(
    stale.getByRole("alert").filter({ hasText: "Dane wyceny zmieniły się" }),
  ).toBeVisible();
  await stale.screenshot({ path: info.outputPath("stale-form.png"), fullPage: true });
  expect((await saved(id)).inputs.pairwise.confirmedBasis).toBeUndefined();
  await stale.close();
  // Explicit keyboard activation of the confirmation remains valid.
  await confirm.press("Enter");
  await expect(page).toHaveURL(/step=5/);
  await flow.calculation();
  const texts = manualTexts("staleness");
  await flow.prose(texts);
  const before = await saved(id);
  await page.goto(`/valuations/${id}?step=4`);
  // Same rounded WR, different correction: only dependent prose becomes stale.
  await page.getByLabel(`Mnożnik: ${CUSTOM} — porównanie 2`, { exact: true }).fill("-1.25001");
  await flow.features("pp");
  await flow.calculation();
  expect((await saved(id)).wr).toBe(before.wr);
  for (const [i, label] of PROSE_LABELS.entries())
    await expect(page.getByRole("textbox", { name: label, exact: true })).toHaveValue(texts[i]);
  await expect(page.getByTestId("prose-stale-uzasadnienie")).toContainText("nieaktualna");
  for (const section of [
    "analiza_rynku",
    "opis_lokalu",
    "otoczenie",
    "zagospodarowanie",
    "standard",
  ])
    await expect(page.getByTestId(`prose-stale-${section}`)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("manual-prose-stale.png"), fullPage: true });
  await flow.prose(texts);
  await page.goto(`/valuations/${id}?step=6`);
  await expect(page.getByTestId("prose-stale-uzasadnienie")).toHaveCount(0);
});

test("AC08/12: PP4 real preview and contextual Help match method and feature controls", async ({
  page,
}, info) => {
  const flow = new PairwiseWizard(page);
  const id = await flow.create("wlasnosc", randomUUID().slice(0, 8));
  await page.getByRole("link", { name: "Pomoc — ten krok", exact: true }).click();
  await expect(page).toHaveURL(/\/pomoc\/krok-3-proba/);
  await expect(page.getByText(/Szóstej transakcji nie można zaznaczyć/)).toBeVisible();
  await page.goto(`/valuations/${id}?step=3`);
  await flow.method("pp");
  await flow.pool(6);
  for (const n of [1, 2, 3, 4]) await flow.choice(n).check();
  await flow.sample();
  await page.getByRole("link", { name: "Pomoc — ten krok", exact: true }).click();
  await expect(page).toHaveURL(/\/pomoc\/krok-4-cechy/);
  await expect(
    page.getByRole("heading", { name: "Własna cecha i skala 2/3", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Enter w polu nazwy/)).toBeVisible();
  await page.goto(`/valuations/${id}?step=4`);
  await flow.custom();
  await flow.assess(4);
  await flow.features("pp");
  await flow.calculation();
  await flow.prose(manualTexts("pp-four"));
  const preview = page.getByTitle("Podgląd operatu (PDF)");
  await expect(preview).toBeVisible({ timeout: 60_000 });
  const result = await pdf(page, (await preview.getAttribute("src"))!, info, "pp-four-preview");
  expect(result.text).toContain("457 500");
  expect(result.text.includes("Cecha Przedmiot 1 2 3 4 Data transakcji")).toBe(true);
});
