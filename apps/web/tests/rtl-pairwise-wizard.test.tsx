// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepFeatures } from "@/app/valuations/[id]/steps/step-features";
import { ppInputs } from "./fixtures/pairwise-inputs";
import { pairwiseBasis } from "@/domain/pairwise-state";
const save = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
vi.mock("@/app/actions/wizard", () => ({ saveFeaturesAction: save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  save.mockClear();
});
it("adds only one empty custom feature and blocks missing or catalog names", async () => {
  const user = userEvent.setup();
  render(<StepFeatures valuationId="v" features={[]} comparables={[]} area={50} />);
  await user.click(screen.getByRole("button", { name: /Inna cecha/ }));
  expect((screen.getByRole("textbox", { name: "Nazwa cechy" }) as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("button", { name: /Inna cecha/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: /Zatwierdź cechy/ }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText("Podaj nazwę cechy.")).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: "Nazwa cechy" }), "standard wykończenia");
  await user.click(screen.getByTestId("feature-defs-summary-inne"));
  for (const level of ["lepsza", "przecietna", "gorsza"])
    await user.type(screen.getByTestId(`feature-def-inne-${level}`), "Definicja testowa");
  const customRow = screen.getByTestId("remove-feature-inne").closest("tr")!;
  await user.click(within(customRow).getByRole("button", { name: "standard wykończenia: lepsza" }));
  await user.click(screen.getByRole("button", { name: /Zatwierdź cechy/ }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText("Nazwy cech muszą być unikalne.")).toBeTruthy();
});
it("hides both preview amounts on invalid weights", async () => {
  const user = userEvent.setup();
  render(
    <StepFeatures valuationId="v" features={[]} comparables={[{ pricePerM2: 10000 }]} area={50} />,
  );
  await user.clear(screen.getAllByRole("spinbutton")[0]);
  expect(screen.getByTestId("sidebar-wr-preview").textContent).toBe("—");
  expect(screen.getByTestId("footnav-kcs-mid").textContent).toBe("—");
});
it("clears the middle rating and definition when changing to two levels", async () => {
  const user = userEvent.setup();
  render(<StepFeatures valuationId="v" features={[]} comparables={[]} area={50} />);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Skala: standard wykończenia" }),
    "two",
  );
  expect(screen.queryByRole("button", { name: "standard wykończenia: przeciętna" })).toBeNull();
  expect(screen.queryByTestId("feature-def-standard-wykonczenia-przecietna")).toBeNull();
  await user.click(screen.getByRole("button", { name: /Zatwierdź cechy/ }));
  expect(save).not.toHaveBeenCalled();
});
it("submits identity-keyed PP cells with the basis of the originally loaded form", async () => {
  const user = userEvent.setup();
  const input = ppInputs();
  const { rerender } = render(<StepFeatures valuationId="v" {...input} snapshot={input} />);
  const changed = { ...input, area: 60 };
  rerender(<StepFeatures valuationId="v" {...changed} snapshot={changed} />);
  await user.click(screen.getByRole("button", { name: /Potwierdź oceny i poprawki/ }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][1]).toMatchObject({
    expectedPairwiseBasis: pairwiseBasis(input),
    comparisons: input.pairwise!.comparisons,
    confirmPairwise: true,
  });
});

it("keeps PP assessments attached to identity when comparison columns are reordered", async () => {
  const { PairwiseAssessment } = await import("@/app/valuations/[id]/steps/pairwise-assessment");
  const user = userEvent.setup();
  const input = ppInputs();
  const ids = input.pairwise!.selectedComparableIds;
  input.pairwise!.comparisons[ids[0]].inne = {
    rating: "gorsza",
    multiplier: 1.25,
    overrideReason: "Exception A",
  };
  const onChange = vi.fn();
  const props = { features: input.features, comparisons: input.pairwise!.comparisons, onChange };
  const { rerender } = render(<PairwiseAssessment {...props} comparables={input.comparables} />);
  rerender(
    <PairwiseAssessment
      {...props}
      comparables={[input.comparables[2], input.comparables[0], input.comparables[1]]}
    />,
  );
  expect(
    (screen.getByRole("spinbutton", { name: "Mnożnik: Widok — porównanie 2" }) as HTMLInputElement)
      .value,
  ).toBe("1.25");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Ocena: Widok — porównanie 2" }),
    "lepsza",
  );
  expect(onChange.mock.calls.at(-1)![0][ids[0]].inne).toMatchObject({
    rating: "lepsza",
    multiplier: 0,
  });
  expect(onChange.mock.calls.at(-1)![0][ids[2]]).toEqual(input.pairwise!.comparisons[ids[2]]);
});

it("clears PP middle cells and definition on scale change, keeps endpoints", async () => {
  const user = userEvent.setup();
  const input = ppInputs();
  input.features[0] = {
    ...input.features[0],
    ratingScale: "three",
    rating: "przecietna",
    definitions: { lepsza: "Open", przecietna: "Partial", gorsza: "Closed" },
  };
  const ids = input.pairwise!.selectedComparableIds;
  input.pairwise!.comparisons[ids[0]].inne = { rating: "przecietna", multiplier: 0 };
  render(<StepFeatures valuationId="v" {...input} snapshot={input} />);
  await user.selectOptions(screen.getByRole("combobox", { name: "Skala: Widok" }), "two");
  expect(
    (screen.getByRole("combobox", { name: "Ocena: Widok — porównanie 1" }) as HTMLSelectElement)
      .value,
  ).toBe("");
  expect(
    (screen.getByRole("combobox", { name: "Ocena: Widok — porównanie 2" }) as HTMLSelectElement)
      .value,
  ).toBe("lepsza");
  expect(screen.getByTestId("sidebar-wr-preview").textContent).toBe("—");
  await user.click(screen.getByRole("button", { name: "Widok: lepsza" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Ocena: Widok — porównanie 1" }),
    "gorsza",
  );
  await user.click(screen.getByRole("button", { name: /Potwierdź oceny i poprawki/ }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][1].features[0].definitions).toEqual({
    lepsza: "Open",
    gorsza: "Closed",
  });
});

it("area suggestions require the selected median and unchanged preset definitions", async () => {
  const user = userEvent.setup();
  const input = ppInputs();
  input.comparables[0].area = 40;
  input.comparables.push(
    ...[0, 1, 2, 3].map((i) => ({
      id: `10000000-0000-4000-8000-abc00000000${i}`,
      source: "manual" as const,
      pricePerM2: 10000,
      area: 200,
    })),
  );
  input.features = [
    { key: "powierzchnia-uzytkowa", name: "powierzchnia użytkowa", weight: 1, rating: "lepsza" },
  ];
  input.pairwise!.comparisons = {};
  render(<StepFeatures valuationId="v" {...input} snapshot={input} />);
  expect(screen.getByText(/powierzchnia 40 m², próg 50 m²/)).toBeTruthy();
  expect(
    (
      screen.getByRole("combobox", {
        name: "Ocena: powierzchnia użytkowa — porównanie 1",
      }) as HTMLSelectElement
    ).value,
  ).toBe("");
  await user.click(screen.getByTestId("feature-defs-summary-powierzchnia-uzytkowa"));
  await user.type(
    screen.getByTestId("feature-def-powierzchnia-uzytkowa-lepsza"),
    " własna definicja",
  );
  expect(screen.queryByText(/powierzchnia 40 m², próg 50 m²/)).toBeNull();
});
