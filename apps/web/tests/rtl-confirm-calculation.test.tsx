// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the
// next test's DOM (duplicate-element errors). And jsdom (v29) ships no
// ResizeObserver, which Radix primitives (Button) touch on mount. Mirrors
// tests/rtl-step-inspection.test.tsx.
afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const confirmCalculationAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/wizard", () => ({ confirmCalculationAction }));

import { ConfirmCalculationButton } from "@/app/valuations/[id]/steps/confirm-calculation-button";

describe("ConfirmCalculationButton", () => {
  beforeEach(() => {
    pushMock.mockClear();
    confirmCalculationAction.mockClear();
  });

  it("confirms the calculation and navigates to step 6", async () => {
    confirmCalculationAction.mockResolvedValueOnce({ ok: true });
    render(<ConfirmCalculationButton valuationId="v1" confirmed={false} />);

    await userEvent.click(screen.getByRole("button", { name: /zatwierdź kalkulację i dalej/i }));

    const lastCall = confirmCalculationAction.mock.calls.findLast(() => true);
    expect(lastCall).toEqual(["v1"]);
    expect(pushMock).toHaveBeenCalledWith("/valuations/v1?step=6");
  });

  it("shows an inline error and does not navigate when the action fails", async () => {
    confirmCalculationAction.mockResolvedValueOnce({
      error: "Uzupełnij próbę (krok 3) i cechy (krok 4).",
    });
    render(<ConfirmCalculationButton valuationId="v1" confirmed={false} />);

    await userEvent.click(screen.getByRole("button", { name: /zatwierdź kalkulację i dalej/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/uzupełnij próbę/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("labels the button 'Zatwierdź kalkulację i dalej' when confirmed=false", () => {
    render(<ConfirmCalculationButton valuationId="v1" confirmed={false} />);
    expect(
      screen.getByRole("button", { name: "Zatwierdź kalkulację i dalej" }),
    ).toBeInTheDocument();
  });

  it("labels the button 'Dalej' when confirmed=true (re-confirm is idempotent and cheap)", () => {
    render(<ConfirmCalculationButton valuationId="v1" confirmed />);
    expect(screen.getByRole("button", { name: "Dalej" })).toBeInTheDocument();
  });
});
