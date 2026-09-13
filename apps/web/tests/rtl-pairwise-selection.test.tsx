// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PairwiseSelection } from "@/app/valuations/[id]/steps/pairwise-selection";

afterEach(cleanup);

it("prints the comparison area with a Polish decimal comma", () => {
  render(
    <PairwiseSelection
      rows={[{ id: "a", source: "manual", area: 45.5, pricePerM2: 9500 }]}
      selectedIds={[]}
      onChange={() => {}}
    />,
  );
  expect(screen.getByText("45,5 m²")).toBeTruthy();
});
