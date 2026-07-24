// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

import { StepDescriptions } from "@/app/valuations/[id]/steps/step-descriptions";

const VID = "11111111-2222-3333-4444-555555555555";

describe("StepDescriptions", () => {
  it("renders the placeholder card heading and copy", () => {
    render(<StepDescriptions valuationId={VID} />);

    expect(screen.getByRole("heading", { name: "Opisy" })).toBeInTheDocument();
    expect(
      screen.getByText(/Generator prozy sekcji opisowych \(FR-6\) — w przygotowaniu/),
    ).toBeInTheDocument();
  });

  it("renders the FootNav back link (step 5) and primary 'Dalej' link (step 7) with correct targets", () => {
    render(<StepDescriptions valuationId={VID} />);

    expect(screen.getByRole("link", { name: /Wstecz/ })).toHaveAttribute(
      "href",
      `/valuations/${VID}?step=5`,
    );
    // e2e/smoke.spec.ts clicks this exact role+name to advance past step 6 —
    // the label must stay byte-identical to "Dalej".
    expect(screen.getByRole("link", { name: "Dalej" })).toHaveAttribute(
      "href",
      `/valuations/${VID}?step=7`,
    );
  });

  it("shows the FootNav mid copy", () => {
    render(<StepDescriptions valuationId={VID} />);

    expect(screen.getByText("Opisy z szablonu przy zatwierdzeniu")).toBeInTheDocument();
  });
});
