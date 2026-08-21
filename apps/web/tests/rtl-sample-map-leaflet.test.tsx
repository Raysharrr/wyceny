// @vitest-environment jsdom
// SPIKE 2026-08-21 (`spike/leaflet-map`): the Leaflet prototype must mount,
// expose the same dots/labels as `sample-map.tsx`, fold lokale sharing one
// coordinate into a building marker that spiderfies, and never throw without
// a network (no tile ever loads in jsdom — that is the point of the test).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SampleMapLeaflet } from "@/app/valuations/[id]/steps/sample-map-leaflet";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import type { Candidate } from "@/domain/sample-selection";

// Whatever pl-PL Intl emits as the thousands separator in this runtime (NBSP
// or narrow NBSP) — the component formats with the same `Intl.NumberFormat`.
const PRICE_12000 = new Intl.NumberFormat("pl-PL").format(12000);

afterEach(cleanup);

const c = (
  id: string,
  pos: { x: number; y: number } | null,
  overrides: Partial<Candidate> = {},
): Candidate => ({
  transactionId: id,
  date: "2026-05-01",
  area: 50,
  pricePerM2: 12000,
  priceTotal: 600000,
  egib: null,
  lokalId: `L${id}`,
  distanceM: 100,
  floor: 1,
  rooms: 2,
  market: "wtorny",
  share: "1/1",
  transType: "wolnyRynek",
  function: "mieszkalna",
  seller: null,
  pos,
  ...overrides,
});

// Heweliusza 3, Poznań — real EPSG:2180 {x: easting, y: northing}.
const CENTER = { x: 355300.15, y: 505330.31 };
// One building (identical pos) holding P1, P2 and the rejected R1.
const BUILDING = { x: 355320.9, y: 505342.7 };

function makeSelection(overrides: Partial<SampleSelectionSnapshot> = {}): SampleSelectionSnapshot {
  return {
    version: 3,
    proposed: [c("P1", BUILDING), c("P2", BUILDING, { floor: 3 })],
    alternates: [c("A1", { x: 355326, y: 505289.3 })],
    flags: { "A1|LA1": ["price_outlier"] },
    rejectedCounts: { no_price: 3 },
    rejected: [
      {
        transactionId: "R1",
        lokalId: "LR1",
        reason: "no_price",
        allReasons: ["no_price"],
        date: "2026-01-01",
        area: 40,
        pricePerM2: 0,
        distanceM: 300,
        pos: BUILDING,
      },
    ],
    manualRejections: [],
    radiusUsedM: 500,
    radiusWalk: [],
    counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 2 },
    params: { subjectArea: 50, todayMonth: "2026-08" },
    ...overrides,
  };
}

describe("SampleMapLeaflet (spike)", () => {
  it("mounts a Leaflet map without network: a lone lokal is a dot, lokale sharing a coordinate are ONE building marker", () => {
    const { container } = render(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector(".leaflet-container")).not.toBeNull();

    const building = screen.getByTestId("building-proposed");
    expect(building).toHaveTextContent("3");
    expect(building).toHaveAttribute(
      "aria-label",
      "budynek: 3 propozycje: 2 w próbie · 0 alternatyw · 1 odrzucona",
    );
    expect(building).toHaveAttribute("aria-expanded", "false");
    expect(building).toHaveAttribute("tabindex", "0");
    // Folded: no per-lokal dots for the building yet, just the lone alternate.
    expect(screen.queryAllByTestId("dot-proposed")).toHaveLength(0);
    expect(screen.queryAllByTestId("dot-rejected")).toHaveLength(0);
    const alt = screen.getByTestId("dot-alternate");
    expect(alt).toHaveAttribute(
      "aria-label",
      `kandydatka 2026-05-01 · ${PRICE_12000} zł/m² · 100 m · alternatywa`,
    );

    // Legend counts are the census, not the drawn markers.
    expect(screen.getByText(/odrzucone 3/)).toBeInTheDocument();
    expect(screen.getByText(/propozycja 2/)).toBeInTheDocument();
  });

  it("click on the building spiderfies every lokal onto its own leg; a leg dot selects; click again folds", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={onSelect}
      />,
    );
    const building = screen.getByTestId("building-proposed");
    fireEvent.click(building);
    expect(building).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelectorAll(".smap-leg")).toHaveLength(3);
    const proposed = screen.getAllByTestId("dot-proposed");
    expect(proposed).toHaveLength(2);
    expect(proposed[0]).toHaveAttribute("role", "button");
    expect(proposed[0]).toHaveAttribute("tabindex", "0");
    const rejected = screen.getByTestId("dot-rejected");
    expect(rejected).toHaveAttribute("aria-hidden", "true");
    expect(rejected).not.toHaveAttribute("tabindex");
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(proposed[1]);
    expect(onSelect).toHaveBeenCalledWith("P2|LP2");

    fireEvent.click(building);
    expect(building).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByTestId("dot-proposed")).toHaveLength(0);
    expect(container.querySelectorAll(".smap-leg")).toHaveLength(0);
  });

  it("Enter/Space on a lone dot select once per key; Enter on the building toggles the spider", () => {
    const onSelect = vi.fn();
    render(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={onSelect}
      />,
    );
    const alt = screen.getByRole("button", { name: /alternatywa$/ });
    fireEvent.keyDown(alt, { key: "Enter" });
    fireEvent.keyDown(alt, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("A1|LA1");

    const building = screen.getByTestId("building-proposed");
    fireEvent.keyDown(building, { key: "Enter" });
    expect(building).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("dot-proposed")).toHaveLength(2);
  });

  it("a selected lokal inside a building opens the spider and marks the building, the lokal and its kin", () => {
    const { rerender, unmount } = render(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey="P2|LP2"
        onSelect={vi.fn()}
      />,
    );
    const building = screen.getByTestId("building-proposed");
    expect(building).toHaveClass("smap-dot--selected");
    expect(building).toHaveAttribute("aria-expanded", "true");
    const [p1, p2] = screen.getAllByTestId("dot-proposed");
    expect(p2).toHaveClass("smap-dot--selected");
    expect(p1).toHaveClass("smap-dot--kin");
    expect(p1).not.toHaveClass("smap-dot--selected");

    rerender(
      <SampleMapLeaflet
        selection={makeSelection({ radiusUsedM: 1000 })}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    // A new snapshot rebuilds the markers folded; nothing stays highlighted.
    expect(screen.getByTestId("building-proposed")).not.toHaveClass("smap-dot--selected");
    expect(screen.queryAllByTestId("dot-proposed")).toHaveLength(0);
    expect(() => unmount()).not.toThrow();
  });
});
