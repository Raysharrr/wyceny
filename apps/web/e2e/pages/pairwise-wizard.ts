import { expect, type Page } from "@playwright/test";
import { SubjectStep, InspectionStep } from "./wizard";

export const CUSTOM = "Nasłonecznienie łazienki";
export const PROSE_LABELS = [
  "Analiza i charakterystyka rynku",
  "Opis lokalu — układ funkcjonalny",
  "Charakterystyka bezpośredniego otoczenia",
  "Opis zagospodarowania terenu",
  "Opis standardu wykończenia",
  "Uzasadnienie wyniku — pozycja na tle próby",
] as const;
export const manualTexts = (tag: string) =>
  PROSE_LABELS.map(
    (_, i) =>
      `Syntetyczny opis ${tag}, sekcja ${i + 1}. Rzeczoznawca sprawdził dane i potwierdza ręczny tekst.`,
  );

/** Thin UI driver. Numerical and persistence expectations live in the spec. */
export class PairwiseWizard {
  constructor(readonly page: Page) {}

  async create(right: "wlasnosc" | "spoldzielcze", tag: string) {
    const subject = new SubjectStep(this.page);
    await subject.open();
    await subject.fill({
      right,
      address: `ul. Testowa ${tag}, Poznań`,
      area: "50",
      client: `QA E2E ${tag}`,
      kw: "KW-TEST",
    });
    const id = await subject.save();
    await new InspectionStep(this.page).fillDateAndContinue();
    return id;
  }

  async method(method: "kcs" | "pp") {
    await this.page.getByLabel("Wybierz metodę wyceny").selectOption(method);
    await this.page.getByRole("button", { name: "Potwierdź metodę", exact: true }).click();
    await expect(
      this.page
        .getByRole("status")
        .filter({ hasText: `Potwierdzona metoda: ${method.toUpperCase()}.` }),
    ).toBeVisible();
  }

  async pool(count: number) {
    // Existing manual rows expose placeholders, but have no accessible labels.
    for (let i = 3; i < count; i++)
      await this.page.getByRole("button", { name: "Dodaj transakcję", exact: true }).click();
    for (let i = 0; i < count; i++) {
      await this.page
        .getByPlaceholder("zł/m²", { exact: true })
        .nth(i)
        .fill(String(9000 + i * 100));
      await this.page.getByPlaceholder("m²", { exact: true }).nth(i).fill("50");
      await this.page.getByPlaceholder("2024-07", { exact: true }).nth(i).fill("2026-08");
    }
  }

  choice(n: number) {
    return this.page.getByRole("checkbox", { name: new RegExp(`^Transakcja ${n} w puli:`) });
  }

  async sample() {
    await this.page.getByRole("button", { name: "Zatwierdź próbę i dalej", exact: true }).click();
    await expect(this.page).toHaveURL(/step=4/);
  }

  async custom() {
    // Keep one catalog feature active alongside a custom two-level feature.
    const weights = this.page.getByRole("spinbutton", { name: /^Waga:/ });
    for (const w of await weights.all()) await w.fill("0");
    await this.page
      .getByRole("spinbutton", { name: "Waga: standard wykończenia", exact: true })
      .fill("40.25");
    await this.page.getByRole("button", { name: "+ Inna cecha", exact: true }).click();
    await this.page.getByRole("textbox", { name: "Nazwa cechy", exact: true }).fill(CUSTOM);
    await this.page.getByRole("spinbutton", { name: `Waga: ${CUSTOM}`, exact: true }).fill("59.75");
    await this.page.getByLabel(`Skala: ${CUSTOM}`, { exact: true }).selectOption("two");
    await this.page.getByRole("button", { name: `${CUSTOM}: lepsza`, exact: true }).click();
    await this.page.getByText(`Definicje skali ocen — ${CUSTOM}`, { exact: true }).click();
    await this.page
      .getByRole("textbox", { name: `Definicja: ${CUSTOM} — gorsza`, exact: true })
      .fill("Brak naturalnego światła — opis syntetyczny.");
    await this.page
      .getByRole("textbox", { name: `Definicja: ${CUSTOM} — lepsza`, exact: true })
      .fill("Naturalne światło — opis syntetyczny.");
  }

  async assess(count: number) {
    for (let i = 1; i <= count; i++) {
      await this.page
        .getByLabel(`Ocena: standard wykończenia — porównanie ${i}`, { exact: true })
        .selectOption("przecietna");
      await this.page
        .getByLabel(`Ocena: ${CUSTOM} — porównanie ${i}`, { exact: true })
        .selectOption("lepsza");
    }
  }

  async features(method: "kcs" | "pp") {
    await this.page
      .getByRole("button", {
        name: method === "pp" ? "Potwierdź oceny i poprawki i dalej" : "Zatwierdź cechy i dalej",
        exact: true,
      })
      .click();
    await expect(this.page).toHaveURL(/step=5/);
  }

  async calculation() {
    await this.page
      .getByRole("button", { name: "Zatwierdź kalkulację i dalej", exact: true })
      .click();
    await expect(this.page).toHaveURL(/step=6/);
  }

  async prose(texts: readonly string[], options: { firstVisit?: boolean } = {}) {
    if (options.firstVisit) {
      // This verifies the keyless setup; it cannot make a keyed worker safe.
      await expect(
        this.page.getByRole("alert").filter({
          hasText:
            "Nie udało się wygenerować opisów — spróbuj ponownie albo napisz teksty ręcznie.",
        }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(this.page.getByTestId("prose-usage")).toHaveCount(0);
      await expect(
        this.page.getByRole("textbox", { name: PROSE_LABELS[0], exact: true }),
      ).toBeEnabled();
    }
    for (const [i, label] of PROSE_LABELS.entries())
      await this.page.getByRole("textbox", { name: label, exact: true }).fill(texts[i]);
    await this.page.getByRole("button", { name: "Zatwierdź opisy i dalej", exact: true }).click();
    await expect(this.page).toHaveURL(/step=7/);
  }
}
