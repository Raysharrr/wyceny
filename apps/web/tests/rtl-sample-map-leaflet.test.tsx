// @vitest-environment jsdom
// The Leaflet map must mount WITHOUT network (no tile ever loads in jsdom),
// expose the same dots/labels/legend as the old WMS+SVG map, and never throw.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SampleMapLeaflet } from "@/app/valuations/[id]/steps/sample-map-leaflet";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import type { Candidate } from "@/domain/sample-selection";

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
export const CENTER = { x: 355300.15, y: 505330.31 };

// Four DISTINCT coordinates: 2 proposed, 1 alternate (demoted by a flag so
// effectiveSelection does not promote it), 1 sampled rejected; census 3.
export function makeSelection(
  overrides: Partial<SampleSelectionSnapshot> = {},
): SampleSelectionSnapshot {
  return {
    version: 3,
    proposed: [c("P1", { x: 355320.9, y: 505342.7 }), c("P2", { x: 355280, y: 505350 })],
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
        pos: { x: 355100, y: 505400 },
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

describe("SampleMapLeaflet — layers, rings, dots", () => {
  it("mounts a Leaflet map without network, with OSM default, Ortofoto and EGiB in the layers control", () => {
    const { container } = render(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector(".leaflet-container")).not.toBeNull();
    expect(screen.getByRole("group", { name: "Propozycje na mapie" })).toBeInTheDocument();
    expect(screen.getByTestId("sample-map")).toBeInTheDocument();
    expect(screen.getByText(/Mapa \(OpenStreetMap\)/)).toBeInTheDocument();
    expect(screen.getByText(/Ortofoto \(GUGiK\)/)).toBeInTheDocument();
    expect(screen.getByText(/Działki i budynki \(EGiB\)/)).toBeInTheDocument();
    expect(container.querySelector(".leaflet-control-attribution")?.textContent).toMatch(
      /OpenStreetMap/,
    );
    expect(screen.getByLabelText("przedmiot wyceny")).toBeInTheDocument();
  });

  it("draws all four rings, the used radius active, bigger ones outer; a radius change restyles them", () => {
    const { container, rerender } = render(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelectorAll(".smap-ring")).toHaveLength(4);
    expect(container.querySelectorAll(".smap-ring--active")).toHaveLength(1);
    expect(container.querySelectorAll(".smap-ring--outer")).toHaveLength(3);
    expect(screen.getByText("500 m")).toBeInTheDocument();
    expect(screen.getByText("3000 m")).toBeInTheDocument();

    rerender(
      <SampleMapLeaflet
        selection={makeSelection({ radiusUsedM: 1000 })}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelectorAll(".smap-ring")).toHaveLength(4);
    expect(container.querySelectorAll(".smap-ring--inner")).toHaveLength(1);
    expect(container.querySelectorAll(".smap-ring--outer")).toHaveLength(2);
    const active = container.querySelector(".smap-ring--active");
    expect(active).not.toBeNull();
    expect(screen.getByText("1000 m")).toBeInTheDocument();
  });

  it("draws a dot per lokal with the table's vocabulary; rejected dots are hidden from assistive tech", () => {
    render(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    const proposed = screen.getAllByTestId("dot-proposed");
    expect(proposed).toHaveLength(2);
    expect(proposed[0]).toHaveAttribute("role", "button");
    expect(proposed[0]).toHaveAttribute("tabindex", "0");
    expect(proposed[0]).toHaveAttribute(
      "aria-label",
      `propozycja 2026-05-01 · ${PRICE_12000} zł/m² · 100 m · w próbie`,
    );
    expect(screen.getByTestId("dot-alternate")).toHaveAttribute(
      "aria-label",
      `propozycja 2026-05-01 · ${PRICE_12000} zł/m² · 100 m · alternatywa`,
    );
    const rejected = screen.getByTestId("dot-rejected");
    expect(rejected).toHaveAttribute("aria-hidden", "true");
    expect(rejected).not.toHaveAttribute("tabindex");
    expect(rejected).not.toHaveAttribute("role");
    // Legend = census, not drawn markers.
    expect(screen.getByText(/w próbie 2/)).toBeInTheDocument();
    expect(screen.getByText(/alternatywy 1/)).toBeInTheDocument();
    expect(screen.getByText(/odrzucone 3/)).toBeInTheDocument();
  });

  it("click, Enter and Space each select exactly once", () => {
    const onSelect = vi.fn();
    render(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={onSelect}
      />,
    );
    const alt = screen.getByTestId("dot-alternate");
    fireEvent.click(alt);
    fireEvent.keyDown(alt, { key: "Enter" });
    fireEvent.keyDown(alt, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenLastCalledWith("A1|LA1");
    fireEvent.click(screen.getByTestId("dot-rejected"));
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it("marks the selected dot, follows selectedKey changes and unmounts cleanly", () => {
    const { rerender, unmount } = render(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey="P2|LP2"
        onSelect={vi.fn()}
      />,
    );
    const byKey = (key: string) => document.querySelector(`[data-key="${key}"]`);
    expect(byKey("P2|LP2")).toHaveClass("smap-dot--selected");
    expect(byKey("P1|LP1")).not.toHaveClass("smap-dot--selected");
    rerender(
      <SampleMapLeaflet
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    expect(byKey("P2|LP2")).not.toHaveClass("smap-dot--selected");
    expect(() => unmount()).not.toThrow();
  });
});
