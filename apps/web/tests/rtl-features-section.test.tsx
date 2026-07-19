// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the next
// test's DOM (duplicate-element errors). And jsdom (v29) ships no
// ResizeObserver, which Radix primitives in the full form touch on mount.
afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// The full-form tests fill the address field; its blur fires the EGiB/MPZP
// auto-fetch, which (with mocked getSubjectData) would throw. Same guard the
// e2e uses to stay network-free.
process.env.NEXT_PUBLIC_SUBJECT_AUTOFETCH = "off";

// The parent form imports these; rendering the real <NewValuationForm/> pulls
// every module it touches that hits the network, the DB, or `next/navigation`
// — mocked here to pure stubs.
vi.mock("@/app/actions/create-valuation", () => ({
  createValuation: vi.fn(async () => undefined),
}));
vi.mock("@/app/actions/get-sample-proposal", () => ({ getSampleProposal: vi.fn() }));
vi.mock("@/app/actions/get-subject-data", () => ({ getSubjectData: vi.fn() }));
vi.mock("@/app/actions/mint-kw-token", () => ({
  mintKwUploadToken: vi.fn(async () => ({ token: "exp.nonce.sig" })),
}));
vi.mock("@/lib/kw-extract-client", () => ({ extractKw: vi.fn() }));

import { NewValuationForm } from "@/app/valuations/new/new-valuation-form";
import { FEATURE_PRESETS } from "@/domain/feature-presets";

describe("features section — bag add/remove (Slice 7)", () => {
  it("renders the 6 basic features and an add-from-pool select with the 3 exceptional ones", async () => {
    render(<NewValuationForm />);
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
    render(<NewValuationForm />);
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
    render(<NewValuationForm />);
    await user.click(screen.getByTestId("remove-feature-dodatkowe"));
    // NOTE: don't queryByText("dodatkowe") — the pool <option> now carries that
    // exact text (advisor finding #4); the row's remove button is the row proxy.
    expect(screen.queryByTestId("remove-feature-dodatkowe")).toBeNull();
    const select = screen.getByTestId("add-feature-select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toContain("dodatkowe");
  });

  it("disables the remove button once only one feature row remains", async () => {
    const user = userEvent.setup();
    render(<NewValuationForm />);
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

describe("features section — rating-scale definitions (Slice 7)", () => {
  it("shows editable default definitions per level", async () => {
    const user = userEvent.setup();
    render(<NewValuationForm />);
    await user.click(screen.getByTestId("feature-defs-summary-standard-wykonczenia"));
    const input = screen.getByTestId("feature-def-standard-wykonczenia-lepsza") as HTMLInputElement;
    expect(input.value).toBe("standard dobry, wykończenie materiałami lepszej jakości");
  });

  it("prefills powierzchnia definitions from the sample area median and re-tracks it", async () => {
    const user = userEvent.setup();
    render(<NewValuationForm />);
    // Comparable-area inputs carry NO labels (advisor finding #5) — target
    // their ids (#comparable-area-N, see new-valuation-form.tsx ~:527). Do
    // NOT use the subject "Powierzchnia (m²)" label — that field is the
    // SUBJECT area and never feeds the median.
    const areaInput = (i: number) =>
      document.querySelector(`#comparable-area-${i}`) as HTMLInputElement;
    const areas = [areaInput(0), areaInput(1), areaInput(2)];
    await user.type(areas[0], "50");
    await user.type(areas[1], "60");
    await user.type(areas[2], "70");
    await user.click(screen.getByTestId("feature-defs-summary-powierzchnia-uzytkowa"));
    const lepsza = screen.getByTestId(
      "feature-def-powierzchnia-uzytkowa-lepsza",
    ) as HTMLInputElement;
    expect(lepsza.value).toContain("60");
    // median changes → prefill follows (not yet edited)
    await user.clear(areas[2]);
    await user.type(areas[2], "90");
    expect(lepsza.value).toContain("60"); // median of 50,60,90 is still 60
    await user.clear(areas[1]);
    await user.type(areas[1], "80");
    expect(lepsza.value).toContain("80"); // median of 50,80,90
  });

  it("a manual edit freezes the powierzchnia definitions against later sample changes", async () => {
    const user = userEvent.setup();
    render(<NewValuationForm />);
    await user.click(screen.getByTestId("feature-defs-summary-powierzchnia-uzytkowa"));
    const lepsza = screen.getByTestId(
      "feature-def-powierzchnia-uzytkowa-lepsza",
    ) as HTMLInputElement;
    await user.type(lepsza, "własny próg rzeczoznawcy");
    const area0 = document.querySelector("#comparable-area-0") as HTMLInputElement;
    await user.type(area0, "55");
    expect(lepsza.value).toContain("własny próg rzeczoznawcy");
  });

  // Controller requirement deferred from Task 5 review (spread-copy freshness):
  // editing a feature's definitions must never mutate the shared module-level
  // preset object. This static feature loads via `DEFAULT_FEATURES`
  // (`defaultFeatureFormValues()`, which itself spreads `defaultDefinitions`);
  // a pool-add would go through the same spread in `appendFeature` below —
  // either path must hand the form a real copy, not a live reference.
  it("editing a static feature's definitions does not mutate the shared preset", async () => {
    const user = userEvent.setup();
    render(<NewValuationForm />);
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
