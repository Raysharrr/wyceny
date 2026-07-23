// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const saveFeaturesAction = vi.fn();
vi.mock("@/app/actions/wizard", () => ({
  saveFeaturesAction: (...args: unknown[]) => saveFeaturesAction(...args),
}));

import { StepFeatures } from "@/app/valuations/[id]/steps/step-features";
import { FEATURE_PRESETS } from "@/domain/feature-presets";

const VID = "v1";

describe("StepFeatures — bag add/remove (Slice 7, migrated Task 10)", () => {
  it("renders the 6 basic features and an add-from-pool select with the 3 exceptional ones", async () => {
    render(<StepFeatures valuationId={VID} features={[]} comparableAreas={[]} />);
    expect(screen.getByText("standard wykończenia")).toBeTruthy();
    expect(screen.getByText("pomieszczenia przynależne")).toBeTruthy();
    const select = screen.getByTestId("add-feature-select") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("funkcjonalność lokalu");
    expect(options).toContain("liczba izb");
    expect(options).toContain("rodzaj zabudowy budynku");
  });

  it("adding from the pool appends a row with weight 0 and removes it from the select", async () => {
    const user = userEvent.setup();
    render(<StepFeatures valuationId={VID} features={[]} comparableAreas={[]} />);
    const select = screen.getByTestId("add-feature-select") as HTMLSelectElement;
    await user.selectOptions(select, "rodzaj-zabudowy");
    expect(screen.getByText("rodzaj zabudowy budynku")).toBeTruthy();
    expect(Array.from(select.options).map((o) => o.value)).not.toContain("rodzaj-zabudowy");

    // MUST-have: an appended row starts at weight 0 and rating "przecietna"
    // (label "przeciętna"). Anchor on the remove button's testid, then walk
    // up to the <tr> and scope queries to that row.
    const row = screen.getByTestId("remove-feature-rodzaj-zabudowy").closest("tr");
    expect(row).toBeTruthy();
    const weightInput = within(row as HTMLElement).getByRole("spinbutton") as HTMLInputElement;
    expect(weightInput.value).toBe("0");
    const activeRatingButton = within(row as HTMLElement).getByRole("button", {
      name: "rodzaj zabudowy budynku: przeciętna",
    });
    expect(activeRatingButton.getAttribute("data-variant")).toBe("default");
  });

  it("removing a feature deletes its row and returns it to the pool", async () => {
    const user = userEvent.setup();
    render(<StepFeatures valuationId={VID} features={[]} comparableAreas={[]} />);
    await user.click(screen.getByTestId("remove-feature-dodatkowe"));
    // NOTE: don't queryByText("dodatkowe") — the pool <option> now carries that
    // exact text; the row's remove button is the row proxy.
    expect(screen.queryByTestId("remove-feature-dodatkowe")).toBeNull();
    const select = screen.getByTestId("add-feature-select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("dodatkowe");
  });

  it("disables the remove button once only one feature row remains", async () => {
    const user = userEvent.setup();
    render(<StepFeatures valuationId={VID} features={[]} comparableAreas={[]} />);
    let removeButtons = screen.getAllByRole("button", { name: /^Usuń cechę /i });
    expect(removeButtons.length).toBeGreaterThan(1);
    while (removeButtons.length > 1) {
      await user.click(removeButtons[0]);
      removeButtons = screen.getAllByRole("button", { name: /^Usuń cechę /i });
    }
    expect(removeButtons).toHaveLength(1);
    expect((removeButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("StepFeatures — rating-scale definitions (Slice 7, migrated Task 10)", () => {
  it("shows editable default definitions per level", async () => {
    const user = userEvent.setup();
    render(<StepFeatures valuationId={VID} features={[]} comparableAreas={[]} />);
    await user.click(screen.getByTestId("feature-defs-summary-standard-wykonczenia"));
    const input = screen.getByTestId("feature-def-standard-wykonczenia-lepsza") as HTMLInputElement;
    expect(input.value).toBe("standard dobry, wykończenie materiałami lepszej jakości");
  });

  // Old-form behavior (Slice 7) was a live-tracking effect: the powierzchnia
  // definition followed the sample table's median until the appraiser edited
  // it. Here comparables are a FROZEN prop (no live sample table on this
  // step) — the seed happens once, in defaultValues. These three tests
  // preserve the underlying behavior (an empty definition gets the median
  // baked in; a filled one doesn't), not the old live-effect mechanism.
  it("seeds an empty powierzchnia definition from the comparableAreas median, once at mount", async () => {
    const user = userEvent.setup();
    render(<StepFeatures valuationId={VID} features={[]} comparableAreas={[50, 60, 70]} />);
    await user.click(screen.getByTestId("feature-defs-summary-powierzchnia-uzytkowa"));
    const lepsza = screen.getByTestId(
      "feature-def-powierzchnia-uzytkowa-lepsza",
    ) as HTMLInputElement;
    expect(lepsza.value).toContain("60");
  });

  it("a different comparableAreas median seeds a different powierzchnia definition", async () => {
    const user = userEvent.setup();
    render(<StepFeatures valuationId={VID} features={[]} comparableAreas={[50, 80, 90]} />);
    await user.click(screen.getByTestId("feature-defs-summary-powierzchnia-uzytkowa"));
    const lepsza = screen.getByTestId(
      "feature-def-powierzchnia-uzytkowa-lepsza",
    ) as HTMLInputElement;
    expect(lepsza.value).toContain("80");
  });

  it("an already-filled powierzchnia definition is not overwritten by the median", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[
          {
            key: "powierzchnia-uzytkowa",
            name: "powierzchnia użytkowa",
            weight: 0.1,
            rating: "przecietna",
            definitions: { lepsza: "własny próg rzeczoznawcy", gorsza: "" },
          },
        ]}
        comparableAreas={[50, 60, 70]}
      />,
    );
    await user.click(screen.getByTestId("feature-defs-summary-powierzchnia-uzytkowa"));
    const lepsza = screen.getByTestId(
      "feature-def-powierzchnia-uzytkowa-lepsza",
    ) as HTMLInputElement;
    expect(lepsza.value).toBe("własny próg rzeczoznawcy");
  });

  // Controller requirement (spread-copy freshness): editing a feature's
  // definitions must never mutate the shared module-level preset object.
  // This static feature loads via `DEFAULT_FEATURES`, which itself spreads
  // `defaultDefinitions`; a pool-add would go through the same spread.
  it("editing a static feature's definitions does not mutate the shared preset", async () => {
    const user = userEvent.setup();
    render(<StepFeatures valuationId={VID} features={[]} comparableAreas={[]} />);
    const originalLepsza = FEATURE_PRESETS.lokal.find((e) => e.key === "standard-wykonczenia")
      ?.defaultDefinitions.lepsza;
    await user.click(screen.getByTestId("feature-defs-summary-standard-wykonczenia"));
    const input = screen.getByTestId("feature-def-standard-wykonczenia-lepsza") as HTMLInputElement;
    await user.type(input, " EXTRA TEXT");
    expect(
      FEATURE_PRESETS.lokal.find((e) => e.key === "standard-wykonczenia")?.defaultDefinitions
        .lepsza,
    ).toBe(originalLepsza);
  });
});

describe("StepFeatures — submit (Task 10)", () => {
  beforeEach(() => {
    saveFeaturesAction.mockClear();
    pushMock.mockClear();
  });

  it("saves via saveFeaturesAction and navigates to step 5", async () => {
    const user = userEvent.setup();
    saveFeaturesAction.mockResolvedValue({ ok: true });
    render(<StepFeatures valuationId={VID} features={[]} comparableAreas={[]} />);

    await user.click(screen.getByRole("button", { name: /zatwierdź cechy i dalej/i }));

    await waitFor(() => expect(saveFeaturesAction).toHaveBeenCalled());
    expect(saveFeaturesAction).toHaveBeenCalledWith(
      VID,
      expect.objectContaining({ features: expect.any(Array) }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/valuations/${VID}?step=5`));
  });

  it("shows an inline error when the save action returns one", async () => {
    const user = userEvent.setup();
    saveFeaturesAction.mockResolvedValue({
      error: "Nie udało się zapisać cech — spróbuj ponownie.",
    });
    render(<StepFeatures valuationId={VID} features={[]} comparableAreas={[]} />);

    await user.click(screen.getByRole("button", { name: /zatwierdź cechy i dalej/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/nie udało się zapisać cech/i),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
