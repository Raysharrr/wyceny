// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Registers `toBeInTheDocument` etc. on vitest's `expect` — see
// rtl-signature-form.test.tsx for why this is a per-file import.
import "@testing-library/jest-dom/vitest";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the next
// test's DOM (duplicate-element errors). And jsdom (v29) ships no
// ResizeObserver, which Radix primitives touch on mount.
afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const signValuationAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/sign-valuation", () => ({ signValuationAction }));
vi.mock("@/app/actions/confirm-sample", () => ({ confirmSample: vi.fn() }));
vi.mock("@/app/actions/confirm-subject", () => ({ confirmSubject: vi.fn() }));
vi.mock("@/app/actions/confirm-kw", () => ({ confirmKw: vi.fn() }));
vi.mock("@/app/actions/confirm-features", () => ({ confirmFeatures: vi.fn() }));
vi.mock("@/app/actions/approve-valuation", () => ({ approveValuation: vi.fn() }));

import { ValuationActions } from "@/app/valuations/[id]/valuation-actions";

const baseProps = {
  id: "v1",
  hasToVerify: false,
  hasSubjectToVerify: false,
  hasKwToVerify: false,
  hasFeaturesToVerify: false,
  gateOk: true,
  canApprove: false,
};

describe("ValuationActions — sign", () => {
  it("hides the approve button outside drafts (canApprove=false)", () => {
    render(<ValuationActions {...baseProps} canSign />);
    expect(screen.queryByRole("button", { name: /zatwierdź/i })).not.toBeInTheDocument();
  });

  it("shows the sign button only when canSign", () => {
    render(<ValuationActions {...baseProps} canSign />);
    expect(screen.getByRole("button", { name: /podpisz operat/i })).toBeInTheDocument();
    cleanup();
    render(<ValuationActions {...baseProps} canSign={false} />);
    expect(screen.queryByRole("button", { name: /podpisz operat/i })).not.toBeInTheDocument();
  });

  it("fires the action and surfaces its error", async () => {
    signValuationAction.mockResolvedValueOnce({
      error: "Brak skanu podpisu — wgraj go w profilu.",
    });
    render(<ValuationActions {...baseProps} canSign />);
    await userEvent.click(screen.getByRole("button", { name: /podpisz operat/i }));
    expect(await screen.findByText(/brak skanu podpisu/i)).toBeInTheDocument();
  });
});
