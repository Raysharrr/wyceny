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
import type { Comparable } from "@/domain/kcs";

const VID = "v1";

// Synthetic placeholder sample (F-9: no PII, no real transactions) used by
// tests that don't exercise the live KCS sidebar — any positive price/area
// satisfies `computeKcs` without affecting the assertions below.
const PLACEHOLDER_AREA = 65;

function placeholderComparables(areas: Array<number | undefined>): Comparable[] {
  return areas.map((area) => ({ pricePerM2: 10000, area }));
}

describe("StepFeatures — bag add/remove (Slice 7, migrated Task 10)", () => {
  it("renders the 6 basic features and an add-from-pool select with the 3 exceptional ones", async () => {
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
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
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
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
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    await user.click(screen.getByTestId("remove-feature-dodatkowe"));
    // NOTE: don't queryByText("dodatkowe") — the pool <option> now carries that
    // exact text; the row's remove button is the row proxy.
    expect(screen.queryByTestId("remove-feature-dodatkowe")).toBeNull();
    const select = screen.getByTestId("add-feature-select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("dodatkowe");
  });

  it("disables the remove button once only one feature row remains", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
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
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
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
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={placeholderComparables([50, 60, 70])}
        area={PLACEHOLDER_AREA}
      />,
    );
    await user.click(screen.getByTestId("feature-defs-summary-powierzchnia-uzytkowa"));
    const lepsza = screen.getByTestId(
      "feature-def-powierzchnia-uzytkowa-lepsza",
    ) as HTMLInputElement;
    expect(lepsza.value).toContain("60");
  });

  it("a different comparableAreas median seeds a different powierzchnia definition", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={placeholderComparables([50, 80, 90])}
        area={PLACEHOLDER_AREA}
      />,
    );
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
        comparables={placeholderComparables([50, 60, 70])}
        area={PLACEHOLDER_AREA}
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
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
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
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );

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
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );

    await user.click(screen.getByRole("button", { name: /zatwierdź cechy i dalej/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/nie udało się zapisać cech/i),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("StepFeatures — live ΣUi/WR sidebar (Task 9)", () => {
  // Synthetic priced sample (F-9: no PII/real transactions) — avg 10 000
  // zł/m², vmin 0,800, vmax 1,200.
  const PRICED_COMPARABLES: Comparable[] = [
    { pricePerM2: 8000, area: 60 },
    { pricePerM2: 10000, area: 65 },
    { pricePerM2: 12000, area: 70 },
  ];
  const SUBJECT_AREA = 71.63;

  it("shows the live ΣUi/WR preview and recomputes it when a rating changes", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={PRICED_COMPARABLES}
        area={SUBJECT_AREA}
      />,
    );

    // DEFAULT_FEATURES starts all "przecietna" — weights sum to 100%, so ΣUi
    // starts at exactly 1,000 (the rangebar's own "average" midpoint label).
    expect(screen.getByTestId("sidebar-sum-ui").textContent).toBe("1,000");
    expect(screen.getByTestId("sidebar-wr-preview").textContent).toMatch(/zł$/);
    const midInitial = screen.getByTestId("footnav-kcs-mid").textContent ?? "";
    expect(midInitial).toContain("ΣUi");
    expect(midInitial).toContain("1,000");
    expect(midInitial).toMatch(/zł$/);

    // "standard wykończenia" carries 40% weight — flipping it to "lepsza"
    // moves its contribution from weight·1 to weight·vmax (1,200), i.e.
    // ΣUi 1,000 → 1,080.
    await user.click(screen.getByRole("button", { name: "standard wykończenia: lepsza" }));

    await waitFor(() => expect(screen.getByTestId("sidebar-sum-ui").textContent).toBe("1,080"));
    expect(screen.getByTestId("sidebar-wr-preview").textContent).toMatch(/zł$/);
    expect(screen.getByTestId("footnav-kcs-mid").textContent).toContain("1,080");
  });

  it("shows '—' in the sidebar and FootNav when comparables are empty (throw-path guard)", () => {
    render(<StepFeatures valuationId={VID} features={[]} comparables={[]} area={SUBJECT_AREA} />);
    expect(screen.getByTestId("sidebar-sum-ui").textContent).toBe("—");
    expect(screen.getByTestId("sidebar-wr-preview").textContent).toBe("—");
    expect(screen.getByTestId("footnav-kcs-mid").textContent).toBe("—");
  });
});
