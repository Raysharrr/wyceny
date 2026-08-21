// @vitest-environment jsdom
// SPIKE 2026-08-21 (`spike/leaflet-map`): the Leaflet prototype must mount,
// expose the same dots/labels as `sample-map.tsx`, and never throw without a
// network (no tile ever loads in jsdom — that is the point of the test).
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

function makeSelection(overrides: Partial<SampleSelectionSnapshot> = {}): SampleSelectionSnapshot {
  return {
    version: 3,
    proposed: [
      c("P1", { x: 355320.9, y: 505342.7 }),
      // Same building as P1 (identical pos) — must still be its own marker.
      c("P2", { x: 355320.9, y: 505342.7 }),
    ],
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
        pos: { x: 355301.9, y: 505250 },
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
  it("mounts a Leaflet map with one marker per dot, labelled like the SVG map, without network", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={onSelect}
      />,
    );
    expect(container.querySelector(".leaflet-container")).not.toBeNull();
    expect(screen.getAllByTestId("dot-proposed")).toHaveLength(2);
    expect(screen.getAllByTestId("dot-alternate")).toHaveLength(1);
    expect(screen.getAllByTestId("dot-rejected")).toHaveLength(1);

    const proposed = screen.getAllByRole("button", {
      name: `kandydatka 2026-05-01 · ${PRICE_12000} zł/m² · 100 m · propozycja`,
    });
    expect(proposed).toHaveLength(2);
    expect(proposed[0]).toHaveAttribute("tabindex", "0");

    const rejected = screen.getAllByTestId("dot-rejected")[0];
    expect(rejected).toHaveAttribute("aria-hidden", "true");
    expect(rejected).not.toHaveAttribute("tabindex");

    // Legend counts are the census, not the sampled dots.
    expect(screen.getByText(/odrzucone 3/)).toBeInTheDocument();
    expect(screen.getByText(/propozycja 2/)).toBeInTheDocument();
  });

  it("click and Enter/Space on a marker call onSelect with the candidate key (once per key)", () => {
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
    fireEvent.click(alt);
    expect(onSelect).toHaveBeenCalledWith("A1|LA1");
    onSelect.mockClear();
    fireEvent.keyDown(alt, { key: "Enter" });
    fireEvent.keyDown(alt, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("highlights the selected marker and survives a selection change + unmount", () => {
    const sel = makeSelection();
    const { rerender, unmount } = render(
      <SampleMapLeaflet selection={sel} center={CENTER} selectedKey="A1|LA1" onSelect={vi.fn()} />,
    );
    expect(screen.getByTestId("dot-alternate")).toHaveClass("smap-dot--selected");
    rerender(
      <SampleMapLeaflet
        selection={makeSelection({ radiusUsedM: 1000 })}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("dot-alternate")).not.toHaveClass("smap-dot--selected");
    expect(() => unmount()).not.toThrow();
  });
});
