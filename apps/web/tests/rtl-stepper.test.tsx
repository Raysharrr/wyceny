// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

import { Stepper } from "@/app/valuations/[id]/stepper";

const STEP_LABELS: Record<number, string> = {
  1: "Przedmiot",
  2: "Oględziny",
  3: "Próba",
  4: "Cechy",
  5: "Kalkulacja",
  6: "Opisy",
  7: "Operat",
};

describe("Stepper", () => {
  it("renders steps 1-4 as links (reachable, maxReached=4) and 5-7 as disabled spans", () => {
    render(<Stepper current={3} maxReached={4} valuationId="v1" />);

    for (const n of [1, 2, 3, 4]) {
      const link = screen.getByText(STEP_LABELS[n]).closest("a");
      expect(link).toHaveAttribute("href", `/valuations/v1?step=${n}`);
    }

    for (const n of [5, 6, 7]) {
      expect(screen.getByText(STEP_LABELS[n]).closest("a")).toBeNull();
      const disabled = screen.getByText(STEP_LABELS[n]).closest("span[aria-disabled]");
      expect(disabled).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("marks the current step with aria-current=step and other steps without it", () => {
    render(<Stepper current={3} maxReached={4} valuationId="v1" />);

    const currentLink = screen.getByText(STEP_LABELS[3]).closest("a");
    expect(currentLink).toHaveAttribute("aria-current", "step");

    const otherLink = screen.getByText(STEP_LABELS[1]).closest("a");
    expect(otherLink).not.toHaveAttribute("aria-current");
  });

  it("renders labels with full Polish diacritics", () => {
    render(<Stepper current={3} maxReached={4} valuationId="v1" />);

    for (const label of [
      "Przedmiot",
      "Oględziny",
      "Próba",
      "Cechy",
      "Kalkulacja",
      "Opisy",
      "Operat",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders every step as a non-link disabled span in create mode (no valuationId)", () => {
    render(<Stepper current={1} maxReached={1} />);

    // Steps 1-7 are all disabled spans, even step 1 which would otherwise be
    // reachable — advisor I6: no valuationId means there's nowhere to link.
    // The "← Wyceny" home link is unaffected (it never depends on valuationId).
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(screen.getByText(STEP_LABELS[n]).closest("a")).toBeNull();
      const disabled = screen.getByText(STEP_LABELS[n]).closest("span[aria-disabled]");
      expect(disabled).toHaveAttribute("aria-disabled", "true");
    }
  });
});
