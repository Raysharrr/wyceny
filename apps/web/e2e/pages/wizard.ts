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
    /**
     * Podstawa przeznaczenia terenu (M-10). Domyślnie MPZP, bo tak wygląda
     * większość wycen — ale KAŻDY szkic musi ją nieść, niezależnie od rodzaju
     * prawa: §7 i §9 drukują ją w obu rodzajach operatu (punkt §7 leży poza
     * ogrodzeniem `{#prawo_wlasnosc}`), a B-02 nie wypuści operatu bez niej.
     */
    przeznaczenie?: "mpzp" | "plan_ogolny" | "studium";
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
    if (o.right === "spoldzielcze") {
      // A coop right has no book of its own (T-12): one optional flat number,
      // and no examination section at all.
      if (o.kw) await this.page.locator("#kwNumber").fill(o.kw);
    } else if (o.kw) {
      await this.page.locator("#kw-lokalu").fill(o.kw);
    }
    if (o.basement)
      await this.page.getByRole("checkbox", { name: "Lokal ma przynależną piwnicę" }).check();
    await this.fillPrzeznaczenie(o.przeznaczenie ?? "mpzp");
  }

  /**
   * Wszystkie pięć części naraz, bo §9 składa z nich JEDNO zdanie i B-02
   * wymaga kompletu. Symbol jest zawsze wpisywany ręcznie — nawet gdy uchwała
   * podpowiada się sama (Poznań, plan ogólny), strefy nie podpowiada nic.
   */
  async fillPrzeznaczenie(rodzaj: "mpzp" | "plan_ogolny" | "studium") {
    await this.page.locator(`#subject-przeznaczenie-rodzaj-${rodzaj}`).check();
    const nazwa = this.page.locator("#subject-przeznaczenie-nazwa");
    const uchwala = this.page.locator("#subject-przeznaczenie-uchwala");
    const data = this.page.locator("#subject-przeznaczenie-data");
    // Plan ogólny w Poznaniu podpowiada uchwałę sam — nadpisanie jej tutaj
    // zatarłoby regresję w podpowiedzi, więc wypełniamy tylko puste pola.
    if (!(await nazwa.inputValue())) {
      await nazwa.fill(rodzaj === "mpzp" ? "Plan Testowy" : "Gminy Testowej");
    }
    if (!(await uchwala.inputValue())) await uchwala.fill("Nr I/1/2020 Rady Gminy Testowej");
    if (!(await data.inputValue())) await data.fill("2020-01-01");
    await this.page
      .locator("#subject-przeznaczenie-symbol")
      .fill("1MW/U – tereny zabudowy mieszkaniowej wielorodzinnej");
  }

  /**
   * The examination both books need before step 7 will let the operat out
   * (B-06, ADR-018). Manual path — the office's own — with both dzialy
   * answered "no entries", which is also what keeps B-07 out of the way.
   */
  async examineBooks(o: { kwLokalu: string; kwGruntu: string }) {
    await this.page.locator("#kw-lokalu").fill(o.kwLokalu);
    await this.page.locator("#kw-gruntu").fill(o.kwGruntu);
    await this.page.locator("#kwg-nr").fill(o.kwGruntu);
    for (const group of await this.page.getByRole("radiogroup", { name: /^Dział I(II|V)/ }).all()) {
      await group.getByRole("radio", { name: "Brak wpisów" }).click();
    }
    await expect(this.page.getByText(/Zbadane księgi: 2 z 2/)).toBeVisible();
  }

  get summary(): Locator {
    return this.page.getByTestId("subject-summary");
  }

  /** Live subject autofetch (EGiB/MPZP/geocoder) finished — the gate's geocode provenance is what it writes. */
  async waitForSubjectData() {
    await expect(this.page.getByTestId("subject-fetch-status")).toContainText(
      "Pobrano dane przedmiotu",
      { timeout: 90_000 },
    );
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
    this.fetchButton = page.getByRole("button", { name: /^Pobierz próbę/ });
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
    // The step renders server-side first; a click that lands before React hydrates
    // is silently lost (seen once in ~30 runs: page idle, no „Pobieranie…”, no
    // banner). Click until the fetch visibly starts, then wait for the result.
    const started = this.banner.or(this.page.getByRole("button", { name: "Pobieranie…" }));
    await expect(async () => {
      await this.fetchButton.click({ timeout: 5_000 });
      await expect(started).toBeVisible({ timeout: 5_000 });
    }).toPass({ intervals: [1_000, 2_000, 4_000], timeout: 30_000 });
    // a large office register (thousands of rows) plus Street View enrichment can take a while
    await expect(this.banner).toBeVisible({ timeout: 120_000 });
  }

  /** Opens the side panel of the first proposed row and rejects it with a reason. */
  async rejectFirstProposed() {
    await this.proposedRows.first().click();
    await this.page.getByRole("button", { name: "Odrzuć", exact: true }).click();
    await this.page.locator('input[name="reject-reason"][value="too_far"]').check();
    await this.page.getByRole("button", { name: "Potwierdź odrzucenie" }).click();
  }

  async restoreFirstRejected() {
    await this.rejectedToggle.click();
    await this.page.getByRole("button", { name: "Przywróć" }).first().click();
  }

  /**
   * The one thing the shortfall message must never do is disagree with the
   * table: it is visible exactly when fewer than 12 rows are in the sample, and
   * then it names that number and links to the register. Which side of 12 a
   * run lands on depends on the whole office register (one shared pool), not on
   * this run's rows — hence the branch lives here, documented, and the tests
   * assert the invariant instead of a magic count.
   */
  async expectShortfallConsistentWithTable() {
    await expect(this.banner).toBeVisible();
    // the banner and the table come from ONE state update, so the count is settled
    const rows = await this.proposedRows.count();
    if (rows < 12) {
      await expect(this.shortfall).toContainText(new RegExp(`\\b${rows} transakcj`));
      await expect(this.shortfall).toContainText("wymagane 12");
      await expect(
        this.shortfall.getByRole("link", { name: "Dodaj transakcje w Rejestrze →" }),
      ).toHaveAttribute("href", "/rejestr");
    } else {
      await expect(this.shortfall).toHaveCount(0);
    }
    return rows;
  }

  /**
   * After a rejection the selection refills the sample from the alternates, so
   * the row count stays put as long as an alternate exists (checklist CL-9:
   * „licznik próby zostaje 20”); with none left it drops by one.
   */
  async expectRefilledAfterReject(
    rowsBefore: number,
    alternatesBefore: number,
    rejectedBefore: number,
  ) {
    // „Odrzucone (N)” counts the selection's own rejections too — only the delta is ours
    await expect(this.rejectedToggle).toHaveText(
      new RegExp(`^Odrzucone \\(${rejectedBefore + 1}\\)`),
    );
    await expect(this.proposedRows).toHaveCount(alternatesBefore > 0 ? rowsBefore : rowsBefore - 1);
  }

  get rejectedToggle(): Locator {
    return this.page.getByRole("button", { name: /^Odrzucone \(\d+\)/ });
  }

  /** Number in „Odrzucone (N)”; 0 when the section is not rendered (nothing rejected yet). */
  async rejectedCount(): Promise<number> {
    const n = await this.rejectedToggle.count();
    return n ? Number((await this.rejectedToggle.innerText()).match(/\((\d+)\)/)?.[1] ?? 0) : 0;
  }

  get alternateRows(): Locator {
    return this.page.getByTestId("alternate-row");
  }

  async confirmAndContinue() {
    await this.page.getByRole("button", { name: "Zatwierdź próbę i dalej" }).click();
    await this.page.waitForURL(/step=4/);
  }
}

/**
 * Step 4 (ADR-016): there is no default rating. A feature whose scale has
 * fewer than two described levels (powierzchnia without sample areas) gets a
 * two-level scale under „Edytuj skalę” first; then every feature takes its
 * first card. Fictional texts (F-9).
 */
export async function rateAllFeatures(page: Page) {
  const rows = page.locator('[data-testid^="feature-row-"]');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if ((await row.getByRole("radio").count()) < 2) {
      await row.getByRole("button", { name: "Edytuj skalę" }).click();
      const levels = row.getByPlaceholder("puste pole — poziom nie pojawi się w operacie");
      await levels.nth(0).fill("opis poziomu gorszego");
      await levels.nth(2).fill("opis poziomu lepszego");
    }
    await row.getByRole("radio").first().click();
  }
}

/** Steps 4–7 with prose OFF: preset features rated, calculation, placeholder, preview. */
export class OperatPath {
  constructor(private readonly page: Page) {}

  async throughToOperat() {
    await rateAllFeatures(this.page);
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

  /** Issues the operat — CI only (`@staging-safe` tests never call this). */
  async approve() {
    // On failure, say WHAT blocks — "disabled" tells the reader nothing.
    const blockers = this.page.getByTestId("gate-blockers");
    await expect(blockers)
      .toHaveCount(0, { timeout: 60_000 })
      .catch(async () => {
        throw new Error(`Zatwierdzenie zablokowane: ${await blockers.innerText()}`);
      });
    const button = this.page.getByTestId("approve-button");
    await expect(button).toBeEnabled({ timeout: 60_000 });
    await button.click();
    await expect(this.page.getByTestId("valuation-status")).toBeVisible({ timeout: 120_000 });
  }
}
