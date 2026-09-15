// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const reopenValuationAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/reopen-valuation", () => ({ reopenValuationAction }));
vi.mock("@/app/actions/sign-valuation", () => ({ signValuationAction: vi.fn() }));
vi.mock("@/app/actions/create-new-version", () => ({ createNewVersionAction: vi.fn() }));
vi.mock("@/app/actions/approve-valuation", () => ({ approveValuation: vi.fn() }));

import { ValuationActions } from "@/app/valuations/[id]/valuation-actions";

const baseProps = {
  id: "v1",
  gateOk: true,
  canApprove: false,
  canSign: false,
  canCreateNewVersion: false,
};

const BUTTON = /cofnij zatwierdzenie i popraw/i;
const CONFIRM = "Cofnij zatwierdzenie";

/**
 * „Cofnij zatwierdzenie i popraw” (spec §4, wiersz „Krok 7”, §12a runda 1).
 * The texts are asserted VERBATIM: they are what tells the appraiser a new
 * version of the document will be produced and the current file kept, and a
 * paraphrase would quietly change that promise.
 */
describe("ValuationActions — cofnięcie zatwierdzenia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the button only when the valuation may be reopened", () => {
    render(<ValuationActions {...baseProps} canReopen />);
    expect(screen.getByRole("button", { name: BUTTON })).toBeInTheDocument();
    cleanup();
    render(<ValuationActions {...baseProps} canReopen={false} />);
    expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
  });

  it("asks before doing anything — the click alone reopens nothing", async () => {
    render(<ValuationActions {...baseProps} canReopen />);

    await userEvent.click(screen.getByRole("button", { name: BUTTON }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Cofnąć zatwierdzenie?");
    expect(dialog).toHaveTextContent(
      "Operat wróci do edycji. Po poprawkach zatwierdzisz go ponownie i powstanie nowa wersja dokumentu. Obecny plik przestanie być dostępny do pobrania.",
    );
    // The withdrawn file really does become unreachable (`/api/docs/[key]`
    // authorises through doc_url/docx_url, which reopening clears), so the
    // window must not promise a history screen that does not exist.
    expect(dialog).not.toHaveTextContent("w historii wyceny");
    expect(reopenValuationAction).not.toHaveBeenCalled();
  });

  it("[Anuluj] closes the window and changes nothing", async () => {
    render(<ValuationActions {...baseProps} canReopen />);
    await userEvent.click(screen.getByRole("button", { name: BUTTON }));

    await userEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(reopenValuationAction).not.toHaveBeenCalled();
    // And the way back in is still there.
    expect(screen.getByRole("button", { name: BUTTON })).toBeInTheDocument();
  });

  it("[Cofnij zatwierdzenie] runs the action for this valuation", async () => {
    reopenValuationAction.mockResolvedValueOnce(undefined);
    render(<ValuationActions {...baseProps} canReopen />);
    await userEvent.click(screen.getByRole("button", { name: BUTTON }));

    await userEvent.click(screen.getByRole("button", { name: CONFIRM }));

    expect(reopenValuationAction).toHaveBeenCalledWith("v1");
  });

  it("surfaces the action's refusal instead of pretending it worked", async () => {
    reopenValuationAction.mockResolvedValueOnce({
      error: "Cofnąć zatwierdzenie można tylko w operacie zatwierdzonym i jeszcze niepodpisanym.",
    });
    render(<ValuationActions {...baseProps} canReopen />);
    await userEvent.click(screen.getByRole("button", { name: BUTTON }));

    await userEvent.click(screen.getByRole("button", { name: CONFIRM }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/tylko w operacie zatwierdzonym/i);
  });
});
