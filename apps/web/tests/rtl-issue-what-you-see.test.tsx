// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const previewOperat = vi.hoisted(() => vi.fn());
const approveValuation = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/preview-operat", () => ({ previewOperat }));
vi.mock("@/app/actions/approve-valuation", () => ({ approveValuation }));
vi.mock("@/app/actions/sign-valuation", () => ({ signValuationAction: vi.fn() }));
vi.mock("@/app/actions/create-new-version", () => ({ createNewVersionAction: vi.fn() }));

import { OperatPreview } from "@/app/valuations/[id]/steps/operat-preview";
import { PreviewMapsProvider } from "@/app/valuations/[id]/steps/preview-maps-state";
import { StepOperat } from "@/app/valuations/[id]/steps/step-operat";
import { ValuationActions } from "@/app/valuations/[id]/valuation-actions";
import type { Valuation } from "@/ports/valuation";
import { approvableInput, confirmedProseFor } from "./fixtures/valuation-inputs";

/**
 * The two halves of step 7, mounted the way `StepOperat` mounts them: the
 * issue button and the reader are separate components with server-rendered
 * cards between them, and the provider is what lets them agree on WHICH
 * document is on screen.
 */
const renderStep7 = () =>
  render(
    <PreviewMapsProvider>
      <ValuationActions
        id="v1"
        gateOk
        canApprove
        canSign={false}
        canCreateNewVersion={false}
        wr={500000}
      />
      <OperatPreview valuationId="v1" hasBlockers={false} />
    </PreviewMapsProvider>,
  );

const mapsDown = {
  error: "Nie udało się pobrać map do operatu — Geoportal nie odpowiada.",
  mapsUnavailable: true,
};

/**
 * Task 12 — issuing issues the document that is on the screen.
 *
 * The „bez map" path moved off the issue and onto the preview (spec §C):
 * a document the appraiser reads without §8.1 maps must not be followed by an
 * issue that quietly puts some in. That only holds if the choice travels the
 * few centimetres from the reader to the issue button — otherwise the issue
 * fetches on its own, and with Geoportal down the appraiser is left with a
 * refusal and no way forward, which is precisely what moving the button away
 * would otherwise have cost them.
 *
 * The choice is CLIENT state on purpose. It belongs to the screen that is
 * being read and expires with it; a reload re-renders the preview and asks
 * Geoportal again. The alternative considered — inferring consent from the
 * preview blob sitting in storage with no freeze marker — reads a decision
 * out of a display cache, and consent to a document that gets signed has to
 * be explicit.
 */
describe("step 7 — the issue takes the maps decision from the preview on screen", () => {
  it("issues without maps after the appraiser read a preview without maps", async () => {
    previewOperat.mockResolvedValueOnce(mapsDown);
    previewOperat.mockResolvedValueOnce({ url: "/api/podglad/v1?v=abc" });
    approveValuation.mockResolvedValueOnce(undefined);
    renderStep7();

    await userEvent.click(await screen.findByTestId("preview-skip-maps"));
    await screen.findByTitle("Podgląd operatu (PDF)");
    await userEvent.click(screen.getByTestId("approve-button"));

    expect(previewOperat).toHaveBeenLastCalledWith("v1", { skipMaps: true });
    expect(approveValuation).toHaveBeenLastCalledWith("v1", { skipMaps: true });
  });

  it("issues with maps when the preview on screen has them", async () => {
    previewOperat.mockResolvedValueOnce({ url: "/api/podglad/v1?v=abc" });
    approveValuation.mockResolvedValueOnce(undefined);
    renderStep7();

    await screen.findByTitle("Podgląd operatu (PDF)");
    await userEvent.click(screen.getByTestId("approve-button"));

    expect(approveValuation).toHaveBeenLastCalledWith("v1", undefined);
  });

  /**
   * A mapless render succeeds, so the error block that carried „Pokaż podgląd
   * bez map" disappears with it. Without a standing notice the appraiser would
   * be looking at a document whose missing §8.1 section is the one thing this
   * screen cannot show them (it is a section that isn't there), with no way
   * back to the maps short of reloading the page.
   */
  it("says on screen that this document has no maps, and offers the way back", async () => {
    previewOperat.mockResolvedValueOnce(mapsDown);
    previewOperat.mockResolvedValueOnce({ url: "/api/podglad/v1?v=abc" });
    renderStep7();

    await userEvent.click(await screen.findByTestId("preview-skip-maps"));

    const notice = await screen.findByTestId("preview-without-maps");
    expect(notice).toHaveTextContent(/bez map/i);
    expect(screen.getByTestId("preview-retry-maps")).toBeInTheDocument();
  });

  it("a successful retry takes the decision back — the maps are on screen again", async () => {
    previewOperat.mockResolvedValueOnce(mapsDown);
    previewOperat.mockResolvedValueOnce({ url: "/api/podglad/v1?v=abc" });
    previewOperat.mockResolvedValueOnce({ url: "/api/podglad/v1?v=def" });
    approveValuation.mockResolvedValueOnce(undefined);
    renderStep7();

    await userEvent.click(await screen.findByTestId("preview-skip-maps"));
    await userEvent.click(await screen.findByTestId("preview-retry-maps"));
    await screen.findByTitle("Podgląd operatu (PDF)");
    expect(screen.queryByTestId("preview-without-maps")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("approve-button"));
    expect(previewOperat).toHaveBeenLastCalledWith("v1", undefined);
    expect(approveValuation).toHaveBeenLastCalledWith("v1", undefined);
  });
});

/**
 * The same handoff, through the composition the appraiser actually gets.
 *
 * The block above mounts the provider by hand, so it would go on passing with
 * `StepOperat` never wrapping its two cards in one — and then the issue would
 * read the context's no-reader default, `false`, and quietly fetch maps for a
 * document the appraiser chose to read without them. This is the case that
 * pins the wiring rather than the mechanism.
 */
describe("StepOperat — the wiring, not just the mechanism", () => {
  const address = "ul. Klonowa 7, m. Nowogród";
  const readyDraft: Valuation = {
    id: "valuation-step7-t12",
    address,
    area: 55,
    wr: 700_000,
    inputs: {
      ...approvableInput("test-user").inputs!,
      prose: confirmedProseFor(address, approvableInput("test-user").inputs!),
    },
    amountInWords: "siedemset tysięcy złotych",
    docUrl: null,
    docxUrl: null,
    purpose: "sprzedaz",
    kwNumber: "KW-TEST-1",
    client: "Jan Testowy",
    inspectionDate: "2026-07-10",
    ownerId: "test-user",
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
    mapsFrozenFor: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };

  it("carries the reader's maps decision to the issue button on the real step", async () => {
    previewOperat.mockResolvedValueOnce(mapsDown);
    previewOperat.mockResolvedValueOnce({ url: "/api/podglad/valuation-step7-t12?v=abc" });
    approveValuation.mockResolvedValueOnce(undefined);
    render(<StepOperat valuation={readyDraft} />);

    await userEvent.click(await screen.findByTestId("preview-skip-maps"));
    await screen.findByTestId("preview-without-maps");
    await userEvent.click(screen.getByTestId("approve-button"));

    expect(approveValuation).toHaveBeenLastCalledWith("valuation-step7-t12", { skipMaps: true });
  });
});
