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

// FlatView mounts ValuationActions (a "use client" component wired to 7
// Server Actions) whenever isOwner + hasAnyAction — mirrors the mock block
// from rtl-valuation-actions-footnav.test.tsx so rendering it here doesn't
// pull in real server-action modules.
vi.mock("@/app/actions/approve-valuation", () => ({ approveValuation: vi.fn() }));
vi.mock("@/app/actions/sign-valuation", () => ({ signValuationAction: vi.fn() }));
vi.mock("@/app/actions/create-new-version", () => ({ createNewVersionAction: vi.fn() }));

import { FlatView } from "@/app/valuations/[id]/flat-view";
import type { Valuation } from "@/ports/valuation";
import { approvableInputs } from "./fixtures/valuation-inputs";

const baseValuation: Valuation = {
  id: "11111111-1111-1111-1111-111111111111",
  address: "Kościelna 33/36, Poznań",
  area: 33.3,
  wr: 333000,
  inputs: approvableInputs(),
  amountInWords: "trzysta trzydzieści trzy tysiące złotych",
  docUrl: "https://example.test/operat.pdf",
  docxUrl: "https://example.test/operat.docx",
  purpose: "sprzedaz",
  kwNumber: "PO1P/1/6",
  client: "Jan Testowy",
  inspectionDate: "2026-07-01",
  ownerId: "owner-1",
  status: "approved",
  approvedAt: new Date("2026-07-20T10:00:00.000Z"),
  signedAt: null,
  supersedesId: null,
  mapsFrozenFor: null,
  createdAt: new Date("2026-07-01T09:00:00.000Z"),
};

const baseProps = {
  valuation: baseValuation,
  isOwner: true,
  isDraft: false,
  canSign: true,
  successor: undefined,
  allBlockers: [],
  gateOk: true,
  hasAnyAction: true,
  canCreateNewVersion: false,
};

describe("FlatView — approved valuation, PDF variant (Task 13)", () => {
  it("renders the Wynik card and the frozen PDF iframe, with no FootNav DOM", () => {
    render(<FlatView {...baseProps} />);

    expect(screen.getByRole("heading", { name: "Wynik" })).toBeInTheDocument();
    expect(screen.getByText("33,3 m²")).toBeInTheDocument();

    const iframe = screen.getByTitle("Operat szacunkowy (PDF)");
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute("src", baseValuation.docUrl);

    // "Pobierz DOCX" stays byte-frozen (e2e/smoke.spec.ts checks it exact) —
    // relocating it into the page-head must not leave a duplicate behind.
    expect(screen.getAllByRole("link", { name: "Pobierz DOCX" })).toHaveLength(1);

    // ValuationActions mounts (canSign) — canApprove is always false on the
    // flat view, so no FootNav DOM (no "Wstecz" link, no approve button).
    expect(screen.getByTestId("sign-button")).toBeInTheDocument();
    expect(screen.queryByTestId("approve-button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /wstecz/i })).not.toBeInTheDocument();
  });

  // The reader used to share a row with a sidebar, which cost it ~38% of the
  // shell. Order is what encodes the fix — summary cards first, document
  // after — and it is the one thing a CSS-blind renderer can still check.
  it("puts the summary cards BEFORE the document, not beside it", () => {
    render(<FlatView {...baseProps} />);

    const wynik = screen.getByRole("heading", { name: "Wynik" });
    const iframe = screen.getByTitle("Operat szacunkowy (PDF)");

    expect(wynik.compareDocumentPosition(iframe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("explains what signing does, next to the button that does it", () => {
    render(<FlatView {...baseProps} />);

    const explainer = screen.getByTestId("sign-explainer");
    expect(explainer).toHaveTextContent("Podpisanie jest ostateczne.");
    expect(explainer).toHaveTextContent("Utwórz nową wersję");

    // Gone with the button: a valuation nobody may sign must not carry a
    // warning about signing it.
    cleanup();
    render(<FlatView {...baseProps} canSign={false} />);
    expect(screen.queryByTestId("sign-explainer")).not.toBeInTheDocument();
  });
});

// The variant page.tsx routes an ADMIN to when they open someone else's
// draft: no document exists yet, so the data cards ARE the page. They used to
// live in the left column of the two-column grid; with that grid gone they
// have to keep rendering from their new place.
describe("FlatView — draft seen by a non-owner admin (no document)", () => {
  const draftProps = {
    ...baseProps,
    valuation: { ...baseValuation, status: "in_progress", docUrl: null, docxUrl: null },
    isOwner: false,
    isDraft: true,
    canSign: false,
    hasAnyAction: false,
    allBlockers: [{ path: "provenance.geocode", label: "Geokodowanie adresu — brak prowenancji." }],
  } satisfies Parameters<typeof FlatView>[0];

  it("renders the data cards and the blockers, and no reader", () => {
    render(<FlatView {...draftProps} />);

    expect(screen.queryByTitle("Operat szacunkowy (PDF)")).not.toBeInTheDocument();
    expect(screen.getByTestId("gate-blockers")).toHaveTextContent(
      "Geokodowanie adresu — brak prowenancji.",
    );
    expect(screen.getByRole("heading", { name: /Cechy/ })).toBeInTheDocument();
    // Not the owner and nothing to do — no action card, so no sign explainer.
    expect(screen.queryByTestId("sign-explainer")).not.toBeInTheDocument();
  });
});
