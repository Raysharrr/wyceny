// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Comparable, Feature } from "@/domain/kcs";
import type { Valuation } from "@/ports/valuation";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the
// next test's DOM (duplicate-element errors). And jsdom (v29) ships no
// ResizeObserver, which Radix primitives (Button, rendered by
// ConfirmCalculationButton) touch on mount. Mirrors
// tests/rtl-confirm-calculation.test.tsx.
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

import { StepCalculation } from "@/app/valuations/[id]/steps/step-calculation";

const VID = "11111111-2222-3333-4444-555555555555";

function readyComparables(): Comparable[] {
  return Array.from({ length: 3 }, (_, i) => ({
    pricePerM2: 10_000 + i * 100,
    source: "manual" as const,
  }));
}

function readyFeatures(): Feature[] {
  return [{ name: "standard", weight: 1, rating: "przecietna" }];
}

function baseValuation(overrides: Partial<Valuation> = {}): Valuation {
  return {
    id: VID,
    address: "ul. Kościelna 33, Poznań",
    area: 50,
    wr: 1_040_000,
    inputs: {
      area: 50,
      comparables: readyComparables(),
      features: readyFeatures(),
    },
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose: null,
    kwNumber: null,
    client: null,
    inspectionDate: null,
    ownerId: "owner-1",
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("StepCalculation — step 5 visual parity (Task 10)", () => {
  beforeEach(() => {
    pushMock.mockClear();
    confirmCalculationAction.mockClear();
  });

  it("shows the info AutoBanner and no warn banner when wr is confirmed", () => {
    render(<StepCalculation valuation={baseValuation({ wr: 1_040_000 })} />);

    expect(
      screen.getByText("Wynik policzony automatycznie z zatwierdzonej próby i ocen."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Dane wejściowe zmieniły się/)).not.toBeInTheDocument();
  });

  it("shows the warn AutoBanner with the existing invalidation text when wr is null", () => {
    render(<StepCalculation valuation={baseValuation({ wr: null })} />);

    const warnText = screen.getByText(
      "Dane wejściowe zmieniły się od ostatniej kalkulacji — zatwierdź ponownie, aby zapisać kwotę.",
    );
    expect(warnText).toBeInTheDocument();
    expect(warnText.closest("[data-kind='warn']")).toBeInTheDocument();
  });

  it("renders the confirm button inside a FootNav bar with back link and formatted WR mid when wr is confirmed", () => {
    render(<StepCalculation valuation={baseValuation({ wr: 1_040_000 })} />);

    // confirmed=true (wr already set) — the button's re-confirm label, not
    // part of this task's scope (ConfirmCalculationButton logic is frozen).
    expect(screen.getByRole("button", { name: "Dalej" })).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: /wstecz/i });
    expect(backLink).toHaveAttribute("href", `/valuations/${VID}?step=4`);
    const midAmount = screen.getByText("1 040 000 zł", { selector: "b" });
    expect(midAmount).toBeInTheDocument();
    expect(midAmount.closest("span")).toHaveTextContent(/wartość rynkowa/i);
  });

  it("shows '—' in the FootNav mid slot when wr is invalidated (null)", () => {
    render(<StepCalculation valuation={baseValuation({ wr: null })} />);

    // confirmed=false once wr is nulled out, so the button reverts to its
    // unconfirmed label — unchanged pre-existing behaviour, not part of this task.
    expect(
      screen.getByRole("button", { name: "Zatwierdź kalkulację i dalej" }),
    ).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the not-ready branch (h2 'Kalkulacja niedostępna') with a FootNav back link and no primary action when inputs are incomplete", () => {
    render(
      <StepCalculation
        valuation={baseValuation({
          wr: null,
          inputs: { area: 50, comparables: [], features: [] },
        })}
      />,
    );

    expect(screen.getByText("Kalkulacja niedostępna")).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: /wstecz/i });
    expect(backLink).toHaveAttribute("href", `/valuations/${VID}?step=4`);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
