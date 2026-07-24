// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the
// next test's DOM (duplicate-element errors). And jsdom (v29) ships no
// ResizeObserver, which Radix primitives (Button, inside InspectionSection)
// touch on mount. Mirrors tests/rtl-inspection-section.test.tsx.
afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const saveInspectionDate = vi.fn();
// InspectionSection's own actions — mocked to pure stubs so it renders
// without touching the network (same mock set as
// tests/rtl-inspection-section.test.tsx).
const removeInspectionPhoto = vi.fn();
const saveInspectionNote = vi.fn();
const uploadInspectionPhoto = vi.fn();
vi.mock("@/app/actions/inspection", () => ({
  saveInspectionDate: (...args: unknown[]) => saveInspectionDate(...args),
  removeInspectionPhoto: (...args: unknown[]) => removeInspectionPhoto(...args),
  saveInspectionNote: (...args: unknown[]) => saveInspectionNote(...args),
  uploadInspectionPhoto: (...args: unknown[]) => uploadInspectionPhoto(...args),
}));

const mintKwUploadToken = vi.fn();
vi.mock("@/app/actions/mint-kw-token", () => ({
  mintKwUploadToken: (...args: unknown[]) => mintKwUploadToken(...args),
}));

const processPhoto = vi.fn();
vi.mock("@/lib/photo-process-client", () => ({
  processPhoto: (...args: unknown[]) => processPhoto(...args),
}));

import { StepInspection } from "@/app/valuations/[id]/steps/step-inspection";

const VID = "11111111-2222-3333-4444-555555555555";

describe("StepInspection", () => {
  it("changing the date and blurring calls saveInspectionDate(valuationId, date) and refreshes", async () => {
    saveInspectionDate.mockResolvedValue(undefined);
    render(<StepInspection valuationId={VID} inspection={null} inspectionDate={null} />);

    const input = screen.getByLabelText("Data oględzin");
    fireEvent.change(input, { target: { value: "2026-07-01" } });
    fireEvent.blur(input);

    await waitFor(() => expect(saveInspectionDate).toHaveBeenCalled());
    const lastCall = saveInspectionDate.mock.calls.findLast(() => true);
    expect(lastCall).toEqual([VID, "2026-07-01"]);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("shows an inline error message when the save action returns one", async () => {
    saveInspectionDate.mockResolvedValue({ error: "Podaj datę w formacie RRRR-MM-DD." });
    render(<StepInspection valuationId={VID} inspection={null} inspectionDate={null} />);

    const input = screen.getByLabelText("Data oględzin");
    fireEvent.change(input, { target: { value: "nieprawidlowe" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/podaj datę w formacie/i),
    );
  });

  it("prefills the date field from inspectionDate and renders InspectionSection", () => {
    render(<StepInspection valuationId={VID} inspection={null} inspectionDate="2026-06-15" />);

    const input = screen.getByLabelText("Data oględzin") as HTMLInputElement;
    expect(input.value).toBe("2026-06-15");
    expect(screen.getByTestId("inspection-section")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Oględziny" })).toBeDefined();
  });

  it("renders the FootNav back link (step 1) and primary 'Dalej' link (step 3) with correct targets", () => {
    render(<StepInspection valuationId={VID} inspection={null} inspectionDate={null} />);

    expect(screen.getByRole("link", { name: /Wstecz/ })).toHaveAttribute(
      "href",
      `/valuations/${VID}?step=1`,
    );
    // e2e/smoke.spec.ts clicks this exact role+name to advance past step 2 —
    // the label must stay byte-identical to "Dalej".
    expect(screen.getByRole("link", { name: "Dalej" })).toHaveAttribute(
      "href",
      `/valuations/${VID}?step=3`,
    );
  });

  it("shows the live photo count in the FootNav mid slot", () => {
    const inspection = {
      note: null,
      photos: { otoczenie: ["a"], budynekZewn: [], wnetrza: ["b", "c"] },
    };
    render(<StepInspection valuationId={VID} inspection={inspection} inspectionDate={null} />);

    expect(screen.getByText("Oględziny:")).toBeInTheDocument();
    expect(screen.getByText("3 zdjęć")).toBeInTheDocument();
  });
});
