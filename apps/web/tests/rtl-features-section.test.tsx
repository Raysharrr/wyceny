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
import type { Comparable, KcsInput } from "@/domain/kcs";

const VID = "v1";

// Synthetic placeholder sample (F-9: no PII, no real transactions) used by
// tests that don't exercise the live KCS sidebar — any positive price/area
// satisfies `computeKcs` without affecting the assertions below.
const PLACEHOLDER_AREA = 65;

function placeholderComparables(areas: Array<number | undefined>): Comparable[] {
  return areas.map((area) => ({ pricePerM2: 10000, area }));
}

// Synthetic priced sample (F-9: no PII/real transactions) — avg 10 000
// zł/m², vmin 0,800, vmax 1,200.
const PRICED_COMPARABLES: Comparable[] = [
  { pricePerM2: 8000, area: 60 },
  { pricePerM2: 10000, area: 65 },
  { pricePerM2: 12000, area: 70 },
];

/** A feature row, found by its preset key. */
const row = (key: string) => screen.getByTestId(`feature-row-${key}`);
/** The level cards of a feature, as radios. */
const cards = (key: string) => within(row(key)).queryAllByRole("radio");

async function rateEvery(user: ReturnType<typeof userEvent.setup>) {
  for (const group of screen.getAllByRole("radiogroup")) {
    await user.click(within(group).getAllByRole("radio")[0]);
  }
}

describe("StepFeatures — bag add/remove (Slice 7, migrated Task 10)", () => {
  it("renders the 6 basic features and an add-from-pool select with the 3 exceptional ones", async () => {
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    expect(screen.getByText("Standard wykończenia")).toBeTruthy();
    expect(screen.getByText("Pomieszczenia przynależne")).toBeTruthy();
    const select = screen.getByTestId("add-feature-select") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("Funkcjonalność lokalu");
    expect(options).toContain("Liczba izb");
    expect(options).toContain("Rodzaj zabudowy budynku");
  });

  it("adding from the pool appends a row with weight 0, NO rating, and removes it from the select", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    const select = screen.getByTestId("add-feature-select") as HTMLSelectElement;
    await user.selectOptions(select, "rodzaj-zabudowy");
    expect(screen.getByText("Rodzaj zabudowy budynku")).toBeTruthy();
    expect(Array.from(select.options).map((o) => o.value)).not.toContain("rodzaj-zabudowy");

    const added = row("rodzaj-zabudowy");
    expect((within(added).getByRole("spinbutton") as HTMLInputElement).value).toBe("0");
    // ADR-016 reg. 3: nothing is selected, the row asks for a rating.
    expect(cards("rodzaj-zabudowy").map((c) => c.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
    ]);
    expect(within(added).getByText("Wybierz ocenę")).toBeTruthy();
  });

  it("removing a feature deletes its row and returns it to the pool", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    await user.click(screen.getByTestId("remove-feature-dodatkowe"));
    // NOTE: don't queryByText("Dodatkowe") — the pool <option> now carries that
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

describe("StepFeatures — level cards and ratings (ADR-016, P5)", () => {
  it("shows a card only for each DESCRIBED level, with its name and definition", () => {
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    const group = screen.getByRole("radiogroup", { name: "Lokalizacja szczegółowa" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0].textContent).toContain("przeciętna");
    expect(radios[0].textContent).toContain(
      "położenie w otoczeniu zabudowy mieszkaniowej wielorodzinnej i terenów zielonych",
    );
    expect(radios[1].textContent).toContain("lepsza");
    expect(cards("standard-wykonczenia")).toHaveLength(3);
  });

  it("no rating by default: every row asks „Wybierz ocenę”, counters read 0 of 6", () => {
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={PRICED_COMPARABLES}
        area={PLACEHOLDER_AREA}
      />,
    );
    expect(
      screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    expect(screen.getAllByText("Wybierz ocenę")).toHaveLength(6);
    expect(screen.getByText("oceniono 0 z 6")).toBeTruthy();
    expect(screen.getByTestId("footnav-kcs-mid").textContent).toBe("Oceniono 0 z 6 cech");
  });

  it("clicking a card selects it, counts the feature and shows its Ui", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={PRICED_COMPARABLES}
        area={PLACEHOLDER_AREA}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Standard wykończenia" });
    const przecietna = within(group).getAllByRole("radio")[1];
    await user.click(przecietna);

    expect(przecietna.getAttribute("aria-checked")).toBe("true");
    expect(within(row("standard-wykonczenia")).queryByText("Wybierz ocenę")).toBeNull();
    // 40 % at mid → Ui = w = 0,400.
    expect(within(row("standard-wykonczenia")).getByText("Ui 0,400")).toBeTruthy();
    expect(screen.getByText("oceniono 1 z 6")).toBeTruthy();
    expect(screen.getByTestId("footnav-kcs-mid").textContent).toBe("Oceniono 1 z 6 cech");
  });

  it("two described levels: the lower one is Ui min (lokalizacja przeciętna → w·Vmin)", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={PRICED_COMPARABLES}
        area={PLACEHOLDER_AREA}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Lokalizacja szczegółowa" });
    await user.click(within(group).getAllByRole("radio")[0]);
    // 10 % × Vmin 0,800 = 0,080.
    expect(within(row("lokalizacja")).getByText("Ui 0,080")).toBeTruthy();
  });

  it("ΣUi and WR wait for the full set of ratings", () => {
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={PRICED_COMPARABLES}
        area={PLACEHOLDER_AREA}
      />,
    );
    expect(screen.getByTestId("sidebar-sum-ui").textContent).toBe("—");
    expect(
      screen.getByText("Wybierz oceny wszystkich cech (brakuje 6), żeby policzyć współczynnik."),
    ).toBeTruthy();
    expect(screen.getByText("Pojawi się po ocenie wszystkich cech.")).toBeTruthy();
    expect(screen.queryByTestId("sidebar-wr-preview")).toBeNull();
  });

  it("definitions are edited under „Edytuj skalę”; clearing the selected level's text clears the rating", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={PRICED_COMPARABLES}
        area={PLACEHOLDER_AREA}
      />,
    );
    const standard = row("standard-wykonczenia");
    expect(screen.queryByTestId("feature-def-standard-wykonczenia-lepsza")).toBeNull();
    await user.click(within(standard).getAllByRole("radio")[2]); // lepsza

    await user.click(within(standard).getByRole("button", { name: "Edytuj skalę" }));
    const lepsza = screen.getByTestId(
      "feature-def-standard-wykonczenia-lepsza",
    ) as HTMLInputElement;
    expect(lepsza.value).toBe("standard dobry, wykończenie materiałami lepszej jakości");

    await user.clear(lepsza);
    expect(cards("standard-wykonczenia")).toHaveLength(2);
    expect(
      cards("standard-wykonczenia").some((c) => c.getAttribute("aria-checked") === "true"),
    ).toBe(false);
    expect(within(standard).getByText("Wybierz ocenę")).toBeTruthy();
  });

  it("a scale left with fewer than two levels says so in the row, before any submit (B-10)", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    const lokalizacja = row("lokalizacja");
    await user.click(within(lokalizacja).getByRole("button", { name: "Edytuj skalę" }));
    await user.clear(screen.getByTestId("feature-def-lokalizacja-lepsza"));
    await user.clear(screen.getByTestId("feature-def-lokalizacja-przecietna"));

    expect(cards("lokalizacja")).toHaveLength(0);
    expect(within(lokalizacja).getByRole("alert").textContent).toBe(
      "Cecha „Lokalizacja szczegółowa” musi mieć opisane co najmniej dwa poziomy.",
    );
  });

  it("the level cards follow the ARIA radio-group pattern (one tab stop, arrows, End)", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    const radios = cards("standard-wykonczenia") as HTMLElement[];
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);

    radios[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);

    await user.keyboard("{End}");
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
    // The group wraps, like the ARIA pattern.
    await user.keyboard("{ArrowRight}");
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
  });

  it("describing a missing level under „Edytuj skalę” adds its card", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    const lokalizacja = row("lokalizacja");
    await user.click(within(lokalizacja).getByRole("button", { name: "Edytuj skalę" }));
    await user.type(screen.getByTestId("feature-def-lokalizacja-gorsza"), "opis gorszej");
    expect(cards("lokalizacja")).toHaveLength(3);
  });

  it("legacy draft: a kept rating on a described level shows selected; a cleared one asks again", () => {
    render(
      <StepFeatures
        valuationId={VID}
        features={[
          {
            key: "lokalizacja",
            name: "Lokalizacja szczegółowa",
            weight: 0.5,
            rating: "przecietna",
            definitions: { lepsza: "opis lepszej", przecietna: "opis przeciętnej" },
          },
          {
            key: "powierzchnia-uzytkowa",
            name: "Powierzchnia użytkowa",
            weight: 0.5,
            rating: null,
            definitions: { lepsza: "do 46 m²", gorsza: "od 47 m²" },
          },
        ]}
        comparables={PRICED_COMPARABLES}
        area={PLACEHOLDER_AREA}
      />,
    );
    expect(cards("lokalizacja")[0].getAttribute("aria-checked")).toBe("true");
    expect(within(row("powierzchnia-uzytkowa")).getByText("Wybierz ocenę")).toBeTruthy();
    expect(screen.getByText("oceniono 1 z 2")).toBeTruthy();
  });
});

describe("StepFeatures — rating-scale definitions (Slice 7, migrated Task 10)", () => {
  // Old-form behavior (Slice 7) was a live-tracking effect: the powierzchnia
  // definition followed the sample table's median until the appraiser edited
  // it. Here comparables are a FROZEN prop (no live sample table on this
  // step) — the seed happens once, in defaultValues. These three tests
  // preserve the underlying behavior (an empty definition gets the median
  // baked in; a filled one doesn't), not the old live-effect mechanism.
  async function openScale(key: string) {
    const user = userEvent.setup();
    await user.click(within(row(key)).getByRole("button", { name: "Edytuj skalę" }));
    return user;
  }

  it("seeds an empty powierzchnia definition from the comparableAreas median, once at mount", async () => {
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={placeholderComparables([50, 60, 70])}
        area={PLACEHOLDER_AREA}
      />,
    );
    await openScale("powierzchnia-uzytkowa");
    const lepsza = screen.getByTestId(
      "feature-def-powierzchnia-uzytkowa-lepsza",
    ) as HTMLInputElement;
    expect(lepsza.value).toBe("do 59 m²");
  });

  it("a different comparableAreas median seeds a different powierzchnia definition", async () => {
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={placeholderComparables([50, 80, 90])}
        area={PLACEHOLDER_AREA}
      />,
    );
    await openScale("powierzchnia-uzytkowa");
    const lepsza = screen.getByTestId(
      "feature-def-powierzchnia-uzytkowa-lepsza",
    ) as HTMLInputElement;
    expect(lepsza.value).toBe("do 79 m²");
  });

  it("an already-filled powierzchnia definition is not overwritten by the median", async () => {
    render(
      <StepFeatures
        valuationId={VID}
        features={[
          {
            key: "powierzchnia-uzytkowa",
            name: "powierzchnia użytkowa",
            weight: 0.1,
            rating: null,
            definitions: { lepsza: "własny próg rzeczoznawcy", gorsza: "" },
          },
        ]}
        comparables={placeholderComparables([50, 60, 70])}
        area={PLACEHOLDER_AREA}
      />,
    );
    await openScale("powierzchnia-uzytkowa");
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
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    const originalLepsza = FEATURE_PRESETS.lokal.find((e) => e.key === "standard-wykonczenia")
      ?.defaultDefinitions.lepsza;
    const user = await openScale("standard-wykonczenia");
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

  it("„Zatwierdź cechy i dalej” stays disabled until every feature is rated", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={placeholderComparables([50, 60, 70])}
        area={PLACEHOLDER_AREA}
      />,
    );
    const submit = screen.getByRole("button", { name: /zatwierdź cechy i dalej/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await rateEvery(user);
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("saves via saveFeaturesAction and navigates to step 5", async () => {
    const user = userEvent.setup();
    saveFeaturesAction.mockResolvedValue({ ok: true });
    // A sample with areas gives powierzchnia its median scale (two described levels).
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={placeholderComparables([50, 60, 70])}
        area={PLACEHOLDER_AREA}
      />,
    );
    await rateEvery(user);

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
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={placeholderComparables([50, 60, 70])}
        area={PLACEHOLDER_AREA}
      />,
    );
    await rateEvery(user);

    await user.click(screen.getByRole("button", { name: /zatwierdź cechy i dalej/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/nie udało się zapisać cech/i),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("StepFeatures — live ΣUi/WR sidebar (Task 9)", () => {
  const SUBJECT_AREA = 71.63;

  // Two features on three described levels, both "przecietna" (ADR-016: Ui
  // follows the position in the described scale, so all three must be there).
  const THREE_LEVELS = {
    lepsza: "opis lepszej",
    przecietna: "opis przeciętnej",
    gorsza: "opis gorszej",
  };
  const RATED_FEATURES: KcsInput["features"] = [
    {
      key: "standard-wykonczenia",
      name: "standard wykończenia",
      weight: 0.4,
      rating: "przecietna",
      definitions: THREE_LEVELS,
    },
    {
      key: "polozenie-na-pietrze",
      name: "położenie na piętrze",
      weight: 0.6,
      rating: "przecietna",
      definitions: THREE_LEVELS,
    },
  ];

  it("shows the live ΣUi/WR preview and recomputes it when a rating changes", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={RATED_FEATURES}
        comparables={PRICED_COMPARABLES}
        area={SUBJECT_AREA}
      />,
    );

    // Both features "przecietna" at mid — weights sum to 100%, so ΣUi
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
    const group = screen.getByRole("radiogroup", { name: "standard wykończenia" });
    await user.click(within(group).getAllByRole("radio")[2]);

    await waitFor(() => expect(screen.getByTestId("sidebar-sum-ui").textContent).toBe("1,080"));
    expect(screen.getByTestId("sidebar-wr-preview").textContent).toMatch(/zł$/);
    expect(screen.getByTestId("footnav-kcs-mid").textContent).toContain("1,080");
  });

  it("shows '—' in the sidebar and FootNav when comparables are empty (throw-path guard)", () => {
    render(
      <StepFeatures
        valuationId={VID}
        features={RATED_FEATURES}
        comparables={[]}
        area={SUBJECT_AREA}
      />,
    );
    expect(screen.getByTestId("sidebar-sum-ui").textContent).toBe("—");
    expect(screen.getByTestId("sidebar-wr-preview").textContent).toBe("—");
    expect(screen.getByTestId("footnav-kcs-mid").textContent).toBe("—");
  });
});

/**
 * FH.1/FH.2 — progi liczbowe cech mierzalnych i podpowiedź z danych kroku 1
 * (ADR-016 reg. 5, D-46, D-48, makieta `p5-propozycja-krok4`).
 */
describe("StepFeatures — progi liczbowe i podpowiedź (FH.1, FH.2)", () => {
  const bound = (key: string, level: string, edge: "od" | "do") =>
    screen.getByTestId(`feature-bound-${key}-${level}-${edge}`) as HTMLInputElement;

  async function openScale(user: ReturnType<typeof userEvent.setup>, key: string) {
    await user.click(within(row(key)).getByRole("button", { name: "Edytuj skalę" }));
  }

  it("edytor progów pod „Edytuj skalę” przepisuje tekst definicji na karcie poziomu", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    expect(cards("polozenie-na-pietrze").map((c) => c.textContent)).toEqual([
      "gorszaparter",
      "przeciętnapiętra pośrednie",
      "lepsza4 piętro i powyżej",
    ]);

    await openScale(user, "polozenie-na-pietrze");
    expect(bound("polozenie-na-pietrze", "lepsza", "od").value).toBe("4");

    await user.clear(bound("polozenie-na-pietrze", "przecietna", "do"));
    await user.type(bound("polozenie-na-pietrze", "przecietna", "do"), "5");
    await user.clear(bound("polozenie-na-pietrze", "lepsza", "od"));
    await user.type(bound("polozenie-na-pietrze", "lepsza", "od"), "6");

    expect(cards("polozenie-na-pietrze").map((c) => c.textContent)).toEqual([
      "gorszaparter",
      "przeciętnapiętra pośrednie",
      "lepsza6 piętro i powyżej",
    ]);
    expect(
      (screen.getByTestId("feature-def-polozenie-na-pietrze-lepsza") as HTMLInputElement).value,
    ).toBe("6 piętro i powyżej");
  });

  it("wyczyszczenie obu progów kasuje poziom ze skali, a reszta zostaje policzalna", async () => {
    // Zejście z trzech poziomów na dwa to normalna edycja (Kościelna i
    // Meissnera mają przy powierzchni dwa) — nie może kończyć się martwym
    // przyciskiem zapisu ani komunikatem bez powodu.
    const user = userEvent.setup();
    saveFeaturesAction.mockClear();
    saveFeaturesAction.mockResolvedValue({ ok: true });
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={placeholderComparables([40, 47, 60])}
        area={PLACEHOLDER_AREA}
      />,
    );
    await openScale(user, "polozenie-na-pietrze");
    await user.clear(bound("polozenie-na-pietrze", "gorsza", "do"));
    await user.type(bound("polozenie-na-pietrze", "gorsza", "do"), "3");
    await user.clear(bound("polozenie-na-pietrze", "przecietna", "od"));
    await user.clear(bound("polozenie-na-pietrze", "przecietna", "do"));

    expect(cards("polozenie-na-pietrze").map((c) => c.textContent)).toEqual([
      "gorszaparter, 1 piętro, 2 piętro, 3 piętro",
      "lepsza4 piętro i powyżej",
    ]);
    expect(within(row("polozenie-na-pietrze")).queryByRole("alert")).toBeNull();

    await rateEvery(user);
    await user.click(screen.getByRole("button", { name: "Zatwierdź cechy i dalej" }));
    await waitFor(() => expect(saveFeaturesAction).toHaveBeenCalled());
    const zapisana = (
      saveFeaturesAction.mock.calls[0][1] as { features: Array<Record<string, unknown>> }
    ).features.find((f) => f.key === "polozenie-na-pietrze");
    expect(zapisana).toMatchObject({
      definitions: {
        gorsza: "parter, 1 piętro, 2 piętro, 3 piętro",
        przecietna: "",
        lepsza: "4 piętro i powyżej",
      },
      measure: { kind: "floor", bounds: { gorsza: { od: 0, do: 3 }, lepsza: { od: 4 } } },
    });
  });

  it("luka między progami mówi o tym w wierszu, przed zapisem (D-46)", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    await openScale(user, "polozenie-na-pietrze");
    await user.clear(bound("polozenie-na-pietrze", "lepsza", "od"));
    await user.type(bound("polozenie-na-pietrze", "lepsza", "od"), "6");

    expect(within(row("polozenie-na-pietrze")).getByRole("alert").textContent).toBe(
      "Między przedziałami poziomów „przeciętna” i „lepsza” jest luka.",
    );
  });

  it("ręczna edycja tekstu definicji usuwa progi — edytor progów znika (FH.1)", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={[]}
        area={PLACEHOLDER_AREA}
        pietro={6}
      />,
    );
    await openScale(user, "polozenie-na-pietrze");
    expect(screen.queryByTestId("feature-bound-polozenie-na-pietrze-lepsza-od")).toBeTruthy();
    expect(screen.queryByTestId("threshold-hint-polozenie-na-pietrze")).toBeTruthy();

    await user.type(screen.getByTestId("feature-def-polozenie-na-pietrze-gorsza"), " i suterena");

    expect(screen.queryByTestId("feature-bound-polozenie-na-pietrze-lepsza-od")).toBeNull();
    expect(screen.queryByTestId("threshold-hint-polozenie-na-pietrze")).toBeNull();
  });

  it("podpowiedź z piętra przedmiotu i progu, przyjmowana przyciskiem (ADR-016 reg. 5)", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={[]}
        area={PLACEHOLDER_AREA}
        pietro={6}
      />,
    );
    const hint = screen.getByTestId("threshold-hint-polozenie-na-pietrze");
    expect(hint.textContent).toContain(
      "Podpowiedź: piętro przedmiotu 6 (krok 1) · próg „lepsza” od 4 → lepsza",
    );
    // Nic nie zapisuje się samo: ocena czeka na kliknięcie.
    expect(
      cards("polozenie-na-pietrze").some((c) => c.getAttribute("aria-checked") === "true"),
    ).toBe(false);

    await user.click(within(hint).getByRole("button", { name: "Przyjmij" }));

    expect(cards("polozenie-na-pietrze").map((c) => c.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(screen.queryByTestId("threshold-hint-polozenie-na-pietrze")).toBeNull();
  });

  it("podpowiedź powierzchni bierze próg z mediany próby i powierzchnię z kroku 1", async () => {
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={placeholderComparables([40, 47, 60])}
        area={44.23}
      />,
    );
    expect(screen.getByTestId("threshold-hint-powierzchnia-uzytkowa").textContent).toContain(
      "Podpowiedź: powierzchnia przedmiotu 44,23 m² ≈ 44 m² (krok 1) · próg „lepsza” do 46 m² → lepsza",
    );
  });

  it("podpowiedź liczy według progów rzeczoznawcy, nie według presetu (skala z operatu 14.09)", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={[]}
        area={PLACEHOLDER_AREA}
        pietro={5}
      />,
    );
    // Preset (parter / 1–3 / od 4) stawia 5 piętro w „lepsza”.
    expect(screen.getByTestId("threshold-hint-polozenie-na-pietrze").textContent).toContain(
      "próg „lepsza” od 4 → lepsza",
    );

    // Skala Anety z Bohaterów II: budynek ma 11 kondygnacji nadziemnych, więc
    // „lepsza” zaczyna się dopiero na szóstym piętrze.
    await openScale(user, "polozenie-na-pietrze");
    for (const [level, edge, value] of [
      ["gorsza", "do", "1"],
      ["przecietna", "od", "2"],
      ["przecietna", "do", "5"],
      ["lepsza", "od", "6"],
    ] as const) {
      await user.clear(bound("polozenie-na-pietrze", level, edge));
      await user.type(bound("polozenie-na-pietrze", level, edge), value);
    }

    // To samo 5 piętro, inna skala — inna podpowiedź.
    expect(screen.getByTestId("threshold-hint-polozenie-na-pietrze").textContent).toContain(
      "Podpowiedź: piętro przedmiotu 5 (krok 1) · próg „przeciętna” od 2 do 5 → przeciętna",
    );
    expect(cards("polozenie-na-pietrze").map((c) => c.textContent)).toEqual([
      "gorszaparter, 1 piętro",
      "przeciętnapiętra pośrednie",
      "lepsza6 piętro i powyżej",
    ]);
  });

  it("podpowiedź zostaje, gdy ocena różni się od podpowiedzianej, i znika, gdy jest zgodna", async () => {
    const user = userEvent.setup();
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={[]}
        area={PLACEHOLDER_AREA}
        pietro={6}
      />,
    );
    await user.click(cards("polozenie-na-pietrze")[0]); // gorsza — wbrew podpowiedzi
    expect(screen.queryByTestId("threshold-hint-polozenie-na-pietrze")).toBeTruthy();

    await user.click(cards("polozenie-na-pietrze")[2]); // lepsza — zgodnie z podpowiedzią
    expect(screen.queryByTestId("threshold-hint-polozenie-na-pietrze")).toBeNull();
  });

  it("bez piętra przedmiotu i bez progów nie ma podpowiedzi", async () => {
    render(
      <StepFeatures valuationId={VID} features={[]} comparables={[]} area={PLACEHOLDER_AREA} />,
    );
    // Brak `pietro` (krok 1 go nie wypełnił) — cecha mierzalna, ale nie ma co mierzyć.
    expect(screen.queryByTestId("threshold-hint-polozenie-na-pietrze")).toBeNull();
    // Standard wykończenia nie jest cechą mierzalną — nigdy nie dostaje podpowiedzi.
    expect(screen.queryByTestId("threshold-hint-standard-wykonczenia")).toBeNull();
  });

  it("piętro poniżej parteru nie trafia w żaden przedział — brak podpowiedzi", async () => {
    render(
      <StepFeatures
        valuationId={VID}
        features={[]}
        comparables={[]}
        area={PLACEHOLDER_AREA}
        pietro={-1}
      />,
    );
    expect(screen.queryByTestId("threshold-hint-polozenie-na-pietrze")).toBeNull();
  });
});
