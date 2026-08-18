// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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

import { ValuationActions } from "@/app/valuations/[id]/valuation-actions";

const baseProps = {
  id: "v1",
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

/**
 * T8 (carried from the Task 4 review): the approve refusal names every
 * blocker, each linked to the step that owns it. The button is disabled while
 * the server-rendered gate says no, so this path is the race — the draft
 * changed under the appraiser, or the request skipped the UI — and it is
 * exactly the moment when "one problem at a time" costs the most.
 */
describe("ValuationActions — an approve refusal lists every blocker with its step", () => {
  it("renders one item per blocker, each linking to the step that owns it", async () => {
    approveValuation.mockResolvedValueOnce({
      error: "Zatwierdzenie zablokowane — Geokodowanie adresu — do weryfikacji.",
      blockers: [
        { path: "provenance.geocode", label: "Geokodowanie adresu — do weryfikacji." },
        { path: "comparables[0]", label: "Transakcja 1 (RCN) — do weryfikacji." },
        { path: "inspectionDate", label: "Data oględzin — brak." },
      ],
    });
    render(<ValuationActions {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /zatwierdź operat/i }));

    const list = await screen.findByTestId("approve-blockers");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(list).getByRole("link", { name: /przejdź do kroku 1\. przedmiot/i }),
    ).toHaveAttribute("href", expect.stringContaining("step=1"));
    expect(within(list).getByRole("link", { name: /przejdź do kroku 3\. próba/i })).toHaveAttribute(
      "href",
      expect.stringContaining("step=3"),
    );
    expect(
      within(list).getByRole("link", { name: /przejdź do kroku 2\. oględziny/i }),
    ).toHaveAttribute("href", expect.stringContaining("step=2"));
  });

  it("falls back to the plain message when the refusal carries no blockers", async () => {
    // `approve-valuation.ts` refuses a draft with no inputs snapshot before it
    // ever builds a blocker list — the renderer must not assume the field.
    approveValuation.mockResolvedValueOnce({
      error: "Zatwierdzenie zablokowane — brak danych wejściowych operatu.",
    });
    render(<ValuationActions {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /zatwierdź operat/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Zatwierdzenie zablokowane — brak danych wejściowych operatu.",
    );
    expect(screen.queryByTestId("approve-blockers")).not.toBeInTheDocument();
  });
});
