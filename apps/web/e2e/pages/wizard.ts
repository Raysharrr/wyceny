import { expect, type Locator, type Page } from "@playwright/test";

/** Step 1 of `/valuations/new` — only the fields the cooperative block touches. */
export class SubjectStep {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto("/valuations/new");
    await expect(this.page.getByRole("radiogroup", { name: "Rodzaj prawa" })).toBeVisible();
  }

  async fill(o: {
    right: "wlasnosc" | "spoldzielcze";
    address: string;
    area: string;
    client: string;
    kw?: string;
    basement?: boolean;
  }) {
    await this.page
      .getByRole("radio", {
        name:
          o.right === "spoldzielcze"
            ? "Spółdzielcze własnościowe prawo do lokalu"
            : "Własność lokalu",
      })
      .click();
    await this.page.locator("#address").fill(o.address);
    await this.page.locator("#area").fill(o.area);
    await this.page.locator("#purpose").selectOption("sprzedaz");
    await this.page.locator("#client").fill(o.client);
    await this.page.getByRole("button", { name: /^Wpisz ręcznie/ }).click();
    if (o.kw) await this.page.locator("#kwNumber").fill(o.kw);
    if (o.basement)
      await this.page.getByRole("checkbox", { name: "Lokal ma przynależną piwnicę" }).check();
  }

  get summary(): Locator {
    return this.page.getByTestId("subject-summary");
  }

  /** Saves the draft; resolves to the valuation id from the URL. */
  async save(): Promise<string> {
    await this.page.getByRole("button", { name: "Dane się zgadzają — dalej" }).click();
    await this.page.waitForURL(/\/valuations\/[0-9a-f-]{36}\?step=2/);
    return this.page.url().match(/valuations\/([0-9a-f-]{36})/)![1]!;
  }
}

/** Step 2 — the one field the gate needs. */
export class InspectionStep {
  constructor(private readonly page: Page) {}

  async fillDateAndContinue(date = "2026-09-01") {
    await this.page.locator("#inspectionDate").fill(date);
    await this.page.locator("#inspectionDate").blur();
    await this.page.getByRole("link", { name: "Dalej" }).click();
    await this.page.waitForURL(/step=3/);
  }
}

/** Step 3 — sample from the register (or RCN). */
export class SampleStep {
  readonly fetchButton: Locator;
  readonly banner: Locator;
  readonly shortfall: Locator;
  readonly proposedRows: Locator;
  readonly registryBadges: Locator;
  readonly rcnButton: Locator;
  readonly registerButton: Locator;

  constructor(private readonly page: Page) {
    this.fetchButton = page.locator("#fetch-sample");
    this.banner = page.getByRole("status").filter({ hasText: "Dobrano" });
    this.shortfall = page.getByTestId("registry-shortfall");
    this.proposedRows = page.getByTestId("proposed-row");
    this.registryBadges = page.getByText("Rejestr SM — do weryfikacji", { exact: true });
    this.rcnButton = page.getByRole("button", { name: "Pobierz próbę z RCN", exact: true });
    this.registerButton = page.getByRole("button", {
      name: "Pobierz próbę z rejestru",
      exact: true,
    });
  }

  async radius(m: 500 | 1000 | 2000 | 3000) {
    await this.page.getByRole("button", { name: `${m} m`, exact: true }).click();
  }

  async fetch() {
    await this.fetchButton.click();
    await expect(this.banner).toBeVisible({ timeout: 60_000 });
  }

  /** Opens the side panel of the first proposed row and rejects it with a reason. */
  async rejectFirstProposed() {
    await this.proposedRows.first().click();
    await this.page.getByRole("button", { name: "Odrzuć", exact: true }).click();
    await this.page.locator('input[name="reject-reason"][value="too_far"]').check();
    await this.page.getByRole("button", { name: "Potwierdź odrzucenie" }).click();
  }

  async restoreFirstRejected() {
    await this.page.getByRole("button", { name: /^Odrzucone \(/ }).click();
    await this.page.getByRole("button", { name: "Przywróć" }).first().click();
  }

  async confirmAndContinue() {
    await this.page.getByRole("button", { name: "Zatwierdź próbę i dalej" }).click();
    await this.page.waitForURL(/step=4/);
  }
}

/** Steps 4–7 with prose OFF: preset features, calculation, placeholder, preview. */
export class OperatPath {
  constructor(private readonly page: Page) {}

  async throughToOperat() {
    await this.page.getByRole("button", { name: "Zatwierdź cechy i dalej" }).click();
    await this.page.waitForURL(/step=5/);
    await this.page.getByRole("button", { name: /^(Zatwierdź kalkulację i dalej|Dalej)$/ }).click();
    await this.page.waitForURL(/step=6/);
    await this.page.getByRole("link", { name: "Dalej" }).click();
    await this.page.waitForURL(/step=7/);
  }

  /**
   * The preview renders on its own when the gate is clear; with blockers the
   * appraiser asks for it explicitly. Which of the two happens depends on the
   * environment (CI runs with subject autofetch off, so the geocode-provenance
   * blocker is present; staging has it off), not on the code under test —
   * hence the one conditional living here and not in a test.
   */
  async openPreview(): Promise<Locator> {
    const iframe = this.page.locator('iframe[title="Podgląd operatu (PDF)"]');
    const despite = this.page.getByTestId("preview-despite-blockers");
    await expect(iframe.or(despite)).toBeVisible({ timeout: 60_000 });
    if (await despite.isVisible()) await despite.click();
    await expect(iframe).toBeVisible({ timeout: 90_000 });
    return iframe;
  }
}
