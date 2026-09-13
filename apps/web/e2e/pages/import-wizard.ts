import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Thin page object for `/rejestr/import` (three steps). Holds locators and the
 * click sequences only — every assertion about the OUTCOME lives in the test.
 */
export class ImportWizard {
  readonly layoutNotice: Locator;
  readonly summary: Locator;
  readonly finished: Locator;
  readonly result: Locator;
  readonly nextToMapping: Locator;
  readonly nextToSummary: Locator;
  readonly requiredHint: Locator;

  constructor(private readonly page: Page) {
    this.layoutNotice = page.getByTestId("mapping-layout-notice");
    this.summary = page.getByTestId("import-summary");
    this.finished = page.getByText("Import zakończony.", { exact: true });
    this.result = page.getByText(/^Dodano \d+ now/);
    this.nextToMapping = page.getByRole("button", { name: /^Dalej: mapowanie kolumn/ });
    this.nextToSummary = page.getByRole("button", { name: /^Dalej: podsumowanie/ });
    this.requiredHint = page.getByText(/^Zmapuj pola wymagane:/);
  }

  async open() {
    await this.page.goto("/rejestr/import");
    await expect(
      this.page.getByRole("heading", { name: "Import transakcji z pliku XLS" }),
    ).toBeVisible();
  }

  /** Step 1: file, sheet, header row and the cooperative (new or existing). */
  async chooseFile(xlsx: Buffer, fileName: string, sheet: string, headerRow: string) {
    await this.page.getByLabel("Plik XLS").setInputFiles({
      name: fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx,
    });
    const sheetSelect = this.page.getByLabel(/^Arkusz/);
    await expect(sheetSelect).toBeVisible();
    const labels = await sheetSelect.locator("option").allTextContents();
    const label = labels.find((l) => l.startsWith(`${sheet} (`));
    if (!label) throw new Error(`brak arkusza „${sheet}” wśród: ${labels.join(" | ")}`);
    await sheetSelect.selectOption({ label });
    await this.page.getByLabel(/^Wiersz nagłówka/).selectOption(headerRow);
  }

  async newCooperative(name: string) {
    await this.page.getByLabel("Spółdzielnia", { exact: true }).selectOption("__new__");
    await this.page.getByLabel("Nazwa nowej spółdzielni").fill(name);
  }

  async existingCooperative(name: string) {
    await this.page.getByLabel("Spółdzielnia", { exact: true }).selectOption({ label: name });
  }

  async goToMapping() {
    await this.nextToMapping.click();
    await expect(this.page.getByRole("heading", { name: "Mapowanie kolumn" })).toBeVisible();
  }

  /** Step 2: `label → column index` (the wizard's own field labels). */
  async map(mapping: Record<string, string>) {
    for (const [label, column] of Object.entries(mapping)) {
      await this.page.getByLabel(label, { exact: true }).selectOption(column);
    }
  }

  async goToSummary() {
    await this.nextToSummary.click();
    await expect(this.summary).toBeVisible();
  }

  /** Step 3: run the chunked import and wait for the closing line. */
  async runImport() {
    await this.page.getByRole("button", { name: /^Importuj \d+ wiersz/ }).click();
    // Chunks of 20 rows go through the worker's geocoder — slow on a real host.
    await expect(this.finished).toBeVisible({ timeout: 120_000 });
  }
}
