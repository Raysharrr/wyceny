// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("@/app/actions/approve-valuation", () => ({ approveValuation: vi.fn() }));
vi.mock("@/app/actions/sign-valuation", () => ({ signValuationAction: vi.fn() }));
vi.mock("@/app/actions/create-new-version", () => ({ createNewVersionAction: vi.fn() }));

import { ValuationActions } from "@/app/valuations/[id]/valuation-actions";
import { currencyFormatter } from "@/app/valuations/[id]/cards";

const baseProps = {
  id: "v1",
  gateOk: true,
  canApprove: true,
  canSign: false,
  canCreateNewVersion: false,
};

// Intl.NumberFormat("pl-PL") uses NBSP as the thousands separator, which RTL's
// default text normalizer collapses to a plain space on the DOM side only —
// a regex with `\s` in its place matches both after normalization.
const wrTextRegex = new RegExp(currencyFormatter.format(500000).replace(/\s/gu, "\\s"));

describe("ValuationActions — step 7 FootNav (Task 6)", () => {
  it("renders the approve button inside a FootNav bar with back link and formatted WR when canApprove", () => {
    render(<ValuationActions {...baseProps} wr={500000} />);
    const approveButton = screen.getByTestId("approve-button");
    expect(approveButton).toBeInTheDocument();
    expect(approveButton).toHaveAccessibleName(/zatwierdź i generuj operat/i);
    const backLink = screen.getByRole("link", { name: /wstecz/i });
    expect(backLink).toHaveAttribute("href", "?step=6");
    expect(screen.getByText(wrTextRegex, { selector: "b" })).toBeInTheDocument();
  });

  it("renders no FootNav DOM at all when canApprove is false (flat view)", () => {
    render(<ValuationActions {...baseProps} canApprove={false} wr={500000} />);
    expect(screen.queryByTestId("approve-button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /wstecz/i })).not.toBeInTheDocument();
    expect(screen.queryByText(wrTextRegex, { selector: "b" })).not.toBeInTheDocument();
  });

  /**
   * T12: the bar's middle slot carries STATE, in the shape every other step
   * uses — a label and a value, or "—" when there is none (steps 4 and 5).
   * It used to carry the WR blocker's sentence, an INSTRUCTION, which is the
   * one thing the bar is not for: that blocker is already on the list above,
   * with a link to the step that clears it, so nothing was lost by the swap.
   */
  it('falls back to "—" in mid when wr is null, like every other step', () => {
    render(<ValuationActions {...baseProps} wr={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/kalkulacja niezatwierdzona/i)).not.toBeInTheDocument();
  });

  it('falls back to "—" when wr is omitted entirely (optional prop, advisor I2)', () => {
    render(<ValuationActions {...baseProps} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/kalkulacja niezatwierdzona/i)).not.toBeInTheDocument();
  });
});
