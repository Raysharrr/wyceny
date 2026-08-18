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
});
