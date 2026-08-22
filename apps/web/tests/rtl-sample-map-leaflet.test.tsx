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
const CENTER = { x: 355300.15, y: 505330.31 };

// Four DISTINCT coordinates: 2 proposed, 1 alternate (demoted by a flag so
// effectiveSelection does not promote it), 1 sampled rejected; census 3.
function makeSelection(overrides: Partial<SampleSelectionSnapshot> = {}): SampleSelectionSnapshot {
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

    // Switching the base layer to Ortofoto via the real layers control toggles the background class.
    const ortoInput = screen
      .getByText(/Ortofoto \(GUGiK\)/)
      .closest("label")!
      .querySelector("input")!;
    fireEvent.click(ortoInput);
    expect(container.querySelector(".smap")).toHaveClass("smap--orto");
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

// One building (identical pos) holding P1, P2 and the rejected R1 — the
// Heweliusza 3 case: lokale of one building share the EGiB centroid.
const BUILDING = { x: 355320.9, y: 505342.7 };
function makeBuildingSelection(
  overrides: Partial<SampleSelectionSnapshot> = {},
): SampleSelectionSnapshot {
  const base = makeSelection();
  return {
    ...base,
    proposed: [c("P1", BUILDING), c("P2", BUILDING, { floor: 3 })],
    rejected: [{ ...base.rejected![0], pos: BUILDING }],
    ...overrides,
  };
}

// A second building, distinct from BUILDING, holding P3 and P4.
const BUILDING_2 = { x: 355280, y: 505350 };
function makeTwoBuildingsSelection(): SampleSelectionSnapshot {
  return makeBuildingSelection({
    proposed: [
      c("P1", BUILDING),
      c("P2", BUILDING, { floor: 3 }),
      c("P3", BUILDING_2),
      c("P4", BUILDING_2, { floor: 2 }),
    ],
  });
}

describe("SampleMapLeaflet — building markers + spiderfy", () => {
  it("folds lokale sharing a coordinate into ONE building marker with a count badge", () => {
    render(
      <SampleMapLeaflet
        selection={makeBuildingSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    const building = screen.getByTestId("building-proposed");
    expect(building).toHaveTextContent("3");
    expect(building).toHaveAttribute(
      "aria-label",
      "budynek: 3 propozycje: 2 w próbie · 0 alternatyw · 1 odrzucona",
    );
    expect(building).toHaveAttribute("role", "button");
    expect(building).toHaveAttribute("aria-expanded", "false");
    expect(building).toHaveAttribute("tabindex", "0");
    expect(screen.queryAllByTestId("dot-proposed")).toHaveLength(0);
    expect(screen.queryAllByTestId("dot-rejected")).toHaveLength(0);
    expect(screen.getByTestId("dot-alternate")).toBeInTheDocument();
  });

  it("a building with only rejected lokale is red and inert", () => {
    render(
      <SampleMapLeaflet
        selection={makeBuildingSelection({
          proposed: [c("P1", { x: 355280, y: 505350 })],
          rejected: [
            { ...makeSelection().rejected![0], pos: BUILDING },
            { ...makeSelection().rejected![0], transactionId: "R2", lokalId: "LR2", pos: BUILDING },
          ],
        })}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    const building = screen.getByTestId("building-rejected");
    expect(building).toHaveAttribute("aria-hidden", "true");
    expect(building).not.toHaveAttribute("tabindex");
    expect(building).toHaveAttribute(
      "title",
      "2 propozycje: 0 w próbie · 0 alternatyw · 2 odrzucone",
    );
  });

  it("click spiderfies every lokal onto its own leg; a leg dot selects; click again folds", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SampleMapLeaflet
        selection={makeBuildingSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={onSelect}
      />,
    );
    const building = screen.getByTestId("building-proposed");
    fireEvent.click(building);
    expect(building).toHaveAttribute("aria-expanded", "true");
    expect(building).toHaveClass("smap-bld--open");
    expect(container.querySelectorAll(".smap-leg")).toHaveLength(3);
    const proposed = screen.getAllByTestId("dot-proposed");
    expect(proposed).toHaveLength(2);
    expect(proposed[0]).toHaveClass("smap-dot--spider");
    expect(proposed[0]).toHaveAttribute("role", "button");
    expect(screen.getByTestId("dot-rejected")).toHaveAttribute("aria-hidden", "true");
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(proposed[1]);
    expect(onSelect).toHaveBeenCalledWith("P2|LP2");
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.click(building);
    expect(building).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByTestId("dot-proposed")).toHaveLength(0);
    expect(container.querySelectorAll(".smap-leg")).toHaveLength(0);
  });

  it("Enter/Space toggle the spider; Escape folds it; zoom keeps it open", () => {
    const { container } = render(
      <SampleMapLeaflet
        selection={makeBuildingSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    const building = screen.getByTestId("building-proposed");
    fireEvent.keyDown(building, { key: "Enter" });
    expect(building).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(building, { key: " " });
    expect(building).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(building, { key: "Enter" });
    expect(screen.getAllByTestId("dot-proposed")).toHaveLength(2);

    fireEvent.click(container.querySelector(".leaflet-control-zoom-in")!);
    expect(building).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelectorAll(".smap-leg")).toHaveLength(3);

    fireEvent.keyDown(screen.getByRole("group", { name: "Propozycje na mapie" }), {
      key: "Escape",
    });
    expect(building).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelectorAll(".smap-leg")).toHaveLength(0);
  });

  it("a selected lokal inside a building opens the spider and marks the building, the lokal and its kin", () => {
    const { rerender } = render(
      <SampleMapLeaflet
        selection={makeBuildingSelection()}
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
        selection={makeBuildingSelection({ radiusUsedM: 1000 })}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("building-proposed")).not.toHaveClass("smap-dot--selected");
    expect(screen.queryAllByTestId("dot-proposed")).toHaveLength(0);
  });

  it("moving the selection to a sibling on an open spider drops the stale kin class", () => {
    // Same `sel` object across renders: the markers effect (dep [selection])
    // must NOT re-run, so the spider legs from the first render persist.
    const sel = makeBuildingSelection();
    const { rerender } = render(
      <SampleMapLeaflet selection={sel} center={CENTER} selectedKey="P1|LP1" onSelect={vi.fn()} />,
    );
    const byKey = (key: string) => document.querySelector(`[data-key="${key}"]`);
    expect(byKey("P1|LP1")).toHaveClass("smap-dot--selected");
    expect(byKey("P2|LP2")).toHaveClass("smap-dot--kin");

    rerender(
      <SampleMapLeaflet selection={sel} center={CENTER} selectedKey="P2|LP2" onSelect={vi.fn()} />,
    );
    expect(byKey("P2|LP2")).toHaveClass("smap-dot--selected");
    expect(byKey("P2|LP2")).not.toHaveClass("smap-dot--kin");
    expect(byKey("P1|LP1")).toHaveClass("smap-dot--kin");
    expect(byKey("P1|LP1")).not.toHaveClass("smap-dot--selected");
  });

  it("a click on the map background folds an open spider", () => {
    const { container } = render(
      <SampleMapLeaflet
        selection={makeBuildingSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    const building = screen.getByTestId("building-proposed");
    fireEvent.click(building);
    expect(building).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelectorAll(".smap-leg")).toHaveLength(3);

    const mapEl = container.querySelector(".leaflet-container")!;
    fireEvent.click(mapEl);
    expect(building).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelectorAll(".smap-leg")).toHaveLength(0);
  });

  it("opening another building keeps it open while a lokal of a different building is selected", () => {
    render(
      <SampleMapLeaflet
        selection={makeTwoBuildingsSelection()}
        center={CENTER}
        selectedKey="P1|LP1"
        onSelect={vi.fn()}
      />,
    );
    // BUILDING holds P1 (the selection) — auto-opened on mount.
    const buildingWithSelection = document.querySelector('[data-pos-key="355320.9,505342.7"]')!;
    // BUILDING_2 holds P3/P4 only — unrelated to the current selection.
    const otherBuilding = document.querySelector('[data-pos-key="355280,505350"]')!;
    expect(buildingWithSelection).toHaveAttribute("aria-expanded", "true");
    expect(otherBuilding).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(otherBuilding);
    expect(otherBuilding).toHaveAttribute("aria-expanded", "true");
    expect(buildingWithSelection).toHaveAttribute("aria-expanded", "false");
  });
});
