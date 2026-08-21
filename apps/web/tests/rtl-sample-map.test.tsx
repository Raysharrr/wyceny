// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SampleMap } from "@/app/valuations/[id]/steps/sample-map";
import { kiegWmsUrl, ortoWmsUrl } from "@/app/valuations/[id]/steps/embed-urls";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import type { Candidate } from "@/domain/sample-selection";

const NBSP = " "; // non-breaking space — pl-PL Intl.NumberFormat's thousands separator

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

/**
 * A v3 selection with 2 proposed, 1 alternate, 1 sampled rejected row, and a
 * rejected census bigger than the sample. `flags` demotes "A1" (finding
 * during TDD, 2026-08-21, same class as `map-dots.test.ts`'s fixture):
 * `effectiveSelection` always tops `proposed` up to `DEFAULTS.proposedN`
 * (12) from `alternates` — with only 2 proposed here (real `selectSample`
 * output caps at 12, so this never fires in production), a plain, non-flagged
 * alternate would get swept into `proposed` even with ZERO manual
 * rejections. The demotion flag keeps "A1" a genuine `alternate` dot.
 */
function makeSelection(overrides: Partial<SampleSelectionSnapshot> = {}): SampleSelectionSnapshot {
  return {
    version: 3,
    proposed: [c("P1", { x: 1100, y: 1000 }), c("P2", { x: 900, y: 1050 })],
    alternates: [c("A1", { x: 1050, y: 1100 })],
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
        pos: { x: 700, y: 1000 },
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

const CENTER = { x: 1000, y: 1000 };
const PX = 640;
// halfM = Math.max(300, radiusUsedM * 1.2) — radiusUsedM 500 → 600.
const HALF_M = 600;

describe("SampleMap", () => {
  it("renders the ORTO WMS image and falls back to KIEG once on error", () => {
    render(
      <SampleMap
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    const img = screen.getByAltText("Ortofotomapa GUGiK z propozycjami") as HTMLImageElement;
    expect(img.src).toBe(ortoWmsUrl(CENTER, HALF_M, PX));

    fireEvent.error(img);
    expect(img.src).toBe(kiegWmsUrl(CENTER, HALF_M, PX));

    // Second error (KIEG also unreachable) must not loop back to ORTO.
    fireEvent.error(img);
    expect(img.src).toBe(kiegWmsUrl(CENTER, HALF_M, PX));
  });

  it("the figure has an intrinsic size (aspect-square) so the SVG overlay never collapses; the SVG is present regardless of the img's load state (wave 3A)", () => {
    const { container } = render(
      <SampleMap
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    const figure = container.querySelector("figure");
    expect(figure?.className).toContain("aspect-square");
    expect(container.querySelector("svg")).not.toBeNull();

    const img = screen.getByAltText("Ortofotomapa GUGiK z propozycjami") as HTMLImageElement;
    fireEvent.error(img);
    // Still there, and the figure's sizing is unaffected by the img's own
    // (now-collapsed-to-nothing, since it failed to load) intrinsic size.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(figure?.className).toContain("aspect-square");
  });

  it("a fast pre-hydration 404 (img already complete with naturalWidth 0 on mount) falls back to KIEG without waiting for onError (wave 3B)", () => {
    const completeSpy = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true);
    const widthSpy = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    try {
      render(
        <SampleMap
          selection={makeSelection()}
          center={CENTER}
          selectedKey={null}
          onSelect={vi.fn()}
        />,
      );
      const img = screen.getByAltText("Ortofotomapa GUGiK z propozycjami") as HTMLImageElement;
      expect(img.src).toBe(kiegWmsUrl(CENTER, HALF_M, PX));
      // One-shot: a re-render (still "complete && naturalWidth 0" under the
      // mock) must not loop the fallback or throw.
      fireEvent.error(img);
      expect(img.src).toBe(kiegWmsUrl(CENTER, HALF_M, PX));
    } finally {
      completeSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });

  it("draws one dot per proposed/alternate candidate; legend counts are the census, not the sampled dots", () => {
    const { container } = render(
      <SampleMap
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("dot-proposed")).toHaveLength(2);
    expect(screen.getAllByTestId("dot-alternate")).toHaveLength(1);
    // Only 1 rejected row is sampled onto the map, but the legend must show
    // the full census: rejectedCounts (3) + manualRejections.length (0) = 3.
    expect(screen.getAllByTestId("dot-rejected")).toHaveLength(1);
    const legend = container.querySelector("figcaption");
    expect(legend?.textContent).toMatch(/w próbie 2/);
    expect(legend?.textContent).toMatch(/alternatywy 1/);
    expect(legend?.textContent).toMatch(/odrzucone 3/);
  });

  it("legend's rejected count also folds in manual rejections; w próbie/alternatywy read the EFFECTIVE lists, not the raw snapshot", () => {
    const sel = makeSelection({
      manualRejections: [
        { transactionId: "P1", lokalId: "LP1", reason: "too_far", at: "2026-08-21T10:00:00Z" },
      ],
    });
    const { container } = render(
      <SampleMap selection={sel} center={CENTER} selectedKey={null} onSelect={vi.fn()} />,
    );
    expect(container.querySelector("figcaption")?.textContent).toMatch(/odrzucone 4/);
    // Raw snapshot: proposed=[P1,P2] (2), alternates=[A1] (1). After the
    // manual rejection of P1, A1 stays demoted (price_outlier) rather than
    // backfilling — effective proposed=[P2] (1), alternates=[A1] (1). Both
    // the legend text and the dot counts must read the EFFECTIVE lists.
    expect(container.querySelector("figcaption")?.textContent).toMatch(/w próbie 1/);
    expect(container.querySelector("figcaption")?.textContent).toMatch(/alternatywy 1/);
    expect(screen.getAllByTestId("dot-proposed")).toHaveLength(1);
    expect(screen.getAllByTestId("dot-alternate")).toHaveLength(1);
    // P1 left the proposal (manually rejected) — it now draws as rejected.
    expect(screen.getAllByTestId("dot-rejected")).toHaveLength(2);
  });

  it("clicking a proposed or alternate dot selects it; a rejected dot is not clickable", () => {
    const onSelect = vi.fn();
    render(
      <SampleMap
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("dot-alternate"));
    expect(onSelect).toHaveBeenCalledWith("A1|LA1");

    onSelect.mockClear();
    fireEvent.click(screen.getAllByTestId("dot-proposed")[0]);
    expect(onSelect).toHaveBeenCalledWith("P1|LP1");

    onSelect.mockClear();
    fireEvent.click(screen.getByTestId("dot-rejected"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a clickable dot is keyboard-reachable (role=button, Enter selects it)", () => {
    const onSelect = vi.fn();
    render(
      <SampleMap
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={onSelect}
      />,
    );
    const dot = screen.getByTestId("dot-alternate");
    expect(dot).toHaveAttribute("role", "button");
    expect(dot).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(dot, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("A1|LA1");
  });

  it("the SVG overlay is an accessible GROUP (role=img would hide the dots from assistive tech), and every clickable dot has its own non-empty name", () => {
    render(
      <SampleMap
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    const group = screen.getByRole("group", { name: "Propozycje na mapie" });
    expect(group).toBeInTheDocument();
    // Every clickable dot is reachable inside the group with its own accessible name.
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(3); // 2 proposed + 1 alternate
    for (const b of buttons) {
      expect(b.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("a clickable dot's aria-label reads date · price · distance · w próbie|alternatywa (A2/B2)", () => {
    render(
      <SampleMap
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    // P1: date 2026-05-01, price 12000, distanceM 100 (fixture default), proposed.
    const proposedDot = screen.getAllByTestId("dot-proposed")[0];
    expect(proposedDot).toHaveAttribute(
      "aria-label",
      `propozycja 2026-05-01 · 12${NBSP}000 zł/m² · 100 m · w próbie`,
    );
    // A1: same date/price/distance, alternate.
    const alternateDot = screen.getByTestId("dot-alternate");
    expect(alternateDot).toHaveAttribute(
      "aria-label",
      `propozycja 2026-05-01 · 12${NBSP}000 zł/m² · 100 m · alternatywa`,
    );
  });

  it("a rejected dot is aria-hidden and not focusable", () => {
    render(
      <SampleMap
        selection={makeSelection()}
        center={CENTER}
        selectedKey={null}
        onSelect={vi.fn()}
      />,
    );
    const rejectedDot = screen.getByTestId("dot-rejected");
    expect(rejectedDot).toHaveAttribute("aria-hidden", "true");
    expect(rejectedDot).not.toHaveAttribute("role");
    expect(rejectedDot).not.toHaveAttribute("tabindex");
  });
});
