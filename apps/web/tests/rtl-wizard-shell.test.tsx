// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

import { WizardShell } from "@/components/wizard/wizard-shell";

describe("WizardShell", () => {
  it("renders the StepHeader for the given step plus the children content", () => {
    render(
      <WizardShell currentStep={3} maxReachedStep={4} valuationId="v1">
        <p>Zawartość kroku 3</p>
      </WizardShell>,
    );

    expect(screen.getByText("KROK 3/7 — DOBÓR PRÓBY TRANSAKCJI")).toBeInTheDocument();
    expect(screen.getByText("Próba porównawcza")).toBeInTheDocument();
    expect(screen.getByText("Zawartość kroku 3")).toBeInTheDocument();
  });

  it("renders zero step links in create mode (no valuationId)", () => {
    render(
      <WizardShell currentStep={1} maxReachedStep={1}>
        <p>Zawartość kroku 1</p>
      </WizardShell>,
    );

    for (const label of [
      "Przedmiot",
      "Oględziny",
      "Próba",
      "Cechy",
      "Kalkulacja",
      "Opisy",
      "Operat",
    ]) {
      expect(screen.getByText(label).closest("a")).toBeNull();
    }
  });
});
