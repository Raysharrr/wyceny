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

const approveValuation = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/approve-valuation", () => ({ approveValuation }));
vi.mock("@/app/actions/sign-valuation", () => ({ signValuationAction: vi.fn() }));
vi.mock("@/app/actions/create-new-version", () => ({ createNewVersionAction: vi.fn() }));
vi.mock("@/app/actions/confirm-sample", () => ({ confirmSample: vi.fn() }));
vi.mock("@/app/actions/confirm-subject", () => ({ confirmSubject: vi.fn() }));
vi.mock("@/app/actions/confirm-kw", () => ({ confirmKw: vi.fn() }));
vi.mock("@/app/actions/confirm-features", () => ({ confirmFeatures: vi.fn() }));

import { ValuationActions } from "@/app/valuations/[id]/valuation-actions";

const baseProps = {
  id: "v1",
  hasToVerify: false,
  hasSubjectToVerify: false,
  hasKwToVerify: false,
  hasFeaturesToVerify: false,
  gateOk: true,
  canApprove: true,
  canSign: false,
  canCreateNewVersion: false,
};

describe("ValuationActions — maps fallback", () => {
  it("shows the maps-fallback block with both buttons when approve reports mapsUnavailable", async () => {
    approveValuation.mockResolvedValueOnce({
      error: "Nie udało się pobrać map do operatu — timeout.",
      mapsUnavailable: true,
    });
    render(<ValuationActions {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /zatwierdź operat/i }));
    expect(await screen.findByTestId("maps-fallback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /spróbuj ponownie/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zatwierdź bez map/i })).toBeInTheDocument();
  });

  it("does not show the maps-fallback block for plain (non-maps) errors", async () => {
    approveValuation.mockResolvedValueOnce({
      error: "Zatwierdzenie zablokowane — brak danych wejściowych operatu.",
    });
    render(<ValuationActions {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /zatwierdź operat/i }));
    expect(await screen.findByText(/zatwierdzenie zablokowane/i)).toBeInTheDocument();
    expect(screen.queryByTestId("maps-fallback")).not.toBeInTheDocument();
  });

  it("clicking 'Zatwierdź bez map' calls approveValuation with skipMaps: true", async () => {
    approveValuation.mockResolvedValueOnce({
      error: "Nie udało się pobrać map do operatu — timeout.",
      mapsUnavailable: true,
    });
    approveValuation.mockResolvedValueOnce(undefined);
    render(<ValuationActions {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /zatwierdź operat/i }));
    await screen.findByTestId("maps-fallback");
    await userEvent.click(screen.getByRole("button", { name: /zatwierdź bez map/i }));
    expect(approveValuation).toHaveBeenLastCalledWith("v1", { skipMaps: true });
  });

  it("clicking 'Spróbuj ponownie' calls approveValuation again without opts", async () => {
    approveValuation.mockResolvedValueOnce({
      error: "Nie udało się pobrać map do operatu — timeout.",
      mapsUnavailable: true,
    });
    approveValuation.mockResolvedValueOnce(undefined);
    render(<ValuationActions {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /zatwierdź operat/i }));
    await screen.findByTestId("maps-fallback");
    await userEvent.click(screen.getByRole("button", { name: /spróbuj ponownie/i }));
    expect(approveValuation).toHaveBeenLastCalledWith("v1", undefined);
  });
});
