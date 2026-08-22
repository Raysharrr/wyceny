import { describe, expect, it } from "vitest";
import {
  bestKind,
  buildDots,
  buildingSummary,
  dotAriaLabel,
  dotTooltip,
  groupByPos,
  posKey,
  rejectedCensus,
  ringStyle,
  spiderOffsets,
  spiderTooltip,
  viewHalfM,
  type Dot,
} from "../src/app/valuations/[id]/steps/map-markers";
import type { SampleSelectionSnapshot } from "../src/domain/sample-snapshot";
import type { Candidate } from "../src/domain/sample-selection";

const PRICE_12000 = new Intl.NumberFormat("pl-PL").format(12000);

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

const BUILDING = { x: 355320.9, y: 505342.7 };

// `flags` demotes A1 so `effectiveSelection` does not top `proposed` up from
// `alternates` (same fixture trick as rtl-sample-map-leaflet.test.tsx).
function makeSelection(overrides: Partial<SampleSelectionSnapshot> = {}): SampleSelectionSnapshot {
  return {
    version: 3,
    proposed: [c("P1", BUILDING), c("P2", BUILDING, { floor: 3 })],
    alternates: [c("A1", { x: 355326, y: 505289.3 }), c("A2", null)],
    flags: { "A1|LA1": ["price_outlier"], "A2|LA2": ["price_outlier"] },
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

const dot = (overrides: Partial<Dot> = {}): Dot => ({
  key: "P1|LP1",
  pos: BUILDING,
  kind: "proposed",
  date: "2026-05-01",
  pricePerM2: 12000,
  distanceM: 100,
  floor: 1,
  ...overrides,
});

describe("buildDots", () => {
  it("draws rejected first and proposed last, keyed by candidateKey, skipping rows without pos", () => {
    const dots = buildDots(makeSelection());
    expect(dots.map((d) => `${d.kind}:${d.key}`)).toEqual([
      "rejected:R1|LR1",
      "alternate:A1|LA1",
      "proposed:P1|LP1",
      "proposed:P2|LP2",
    ]);
    expect(dots.find((d) => d.key === "R1|LR1")?.floor).toBeNull();
    expect(dots.find((d) => d.key === "P2|LP2")?.floor).toBe(3);
  });

  it("a manually rejected proposed row becomes a rejected dot (effectiveSelection.removed)", () => {
    const dots = buildDots(
      makeSelection({
        manualRejections: [
          { transactionId: "P1", lokalId: "LP1", reason: "too_far", at: "2026-08-21T10:00:00Z" },
        ],
      }),
    );
    expect(dots.find((d) => d.key === "P1|LP1")?.kind).toBe("rejected");
  });

  it("a manually included row re-attached outside proposed/alternates (e.g. after a radius change) is a proposed dot (Slice 3c)", () => {
    const base = makeSelection();
    const candidate = {
      ...base.proposed[0],
      transactionId: "INC",
      lokalId: "LINC",
      pos: { x: 1200, y: 900 },
    };
    const dots = buildDots(
      makeSelection({
        manualInclusions: [
          { transactionId: "INC", lokalId: "LINC", at: "2026-08-21T10:00:00Z", candidate },
        ],
      }),
    );
    expect(dots.find((d) => d.key === "INC|LINC")?.kind).toBe("proposed");
    expect(dots[dots.length - 1]?.key).toBe("INC|LINC");
  });
});

describe("groupByPos / bestKind / buildingSummary", () => {
  it("groups by the exact coordinate string in insertion order", () => {
    const groups = groupByPos(buildDots(makeSelection()));
    expect([...groups.keys()]).toEqual([posKey(BUILDING), "355326,505289.3"]);
    expect(groups.get(posKey(BUILDING))?.map((d) => d.key)).toEqual(["R1|LR1", "P1|LP1", "P2|LP2"]);
  });

  it("bestKind prefers proposed, then alternate, then rejected", () => {
    expect(bestKind([dot({ kind: "rejected" }), dot({ kind: "alternate" })])).toBe("alternate");
    expect(bestKind([dot({ kind: "rejected" }), dot({ kind: "proposed" })])).toBe("proposed");
    expect(bestKind([dot({ kind: "rejected" })])).toBe("rejected");
  });

  it("buildingSummary uses Polish plurals", () => {
    expect(buildingSummary([dot(), dot({ kind: "proposed" }), dot({ kind: "rejected" })])).toBe(
      "3 propozycje: 2 w próbie · 0 alternatyw · 1 odrzucona",
    );
    expect(buildingSummary([dot({ kind: "alternate" })])).toBe(
      "1 propozycja: 0 w próbie · 1 alternatywa · 0 odrzuconych",
    );
    const sixteen = [
      ...Array.from({ length: 3 }, () => dot()),
      ...Array.from({ length: 2 }, () => dot({ kind: "alternate" })),
      ...Array.from({ length: 11 }, () => dot({ kind: "rejected" })),
    ];
    expect(buildingSummary(sixteen)).toBe(
      "16 propozycji: 3 w próbie · 2 alternatywy · 11 odrzuconych",
    );
  });
});

describe("labels", () => {
  it("dotTooltip / dotAriaLabel / spiderTooltip", () => {
    expect(dotTooltip(dot())).toBe(`2026-05-01 · ${PRICE_12000} zł/m² · 100 m`);
    expect(dotAriaLabel(dot())).toBe(
      `propozycja 2026-05-01 · ${PRICE_12000} zł/m² · 100 m · w próbie`,
    );
    expect(dotAriaLabel(dot({ kind: "alternate" }))).toBe(
      `propozycja 2026-05-01 · ${PRICE_12000} zł/m² · 100 m · alternatywa`,
    );
    expect(spiderTooltip(dot({ floor: 3 }))).toBe(`2026-05 · ${PRICE_12000} zł/m² · p. 3`);
    expect(spiderTooltip(dot({ floor: null }))).toBe(`2026-05 · ${PRICE_12000} zł/m²`);
  });
});

describe("geometry", () => {
  it("spiderOffsets: r = 26 + 3n px, first leg at 12 o'clock, clockwise", () => {
    const o = spiderOffsets(4);
    expect(o).toHaveLength(4);
    const r = 26 + 3 * 4;
    expect(o[0].dx).toBeCloseTo(0, 9);
    expect(o[0].dy).toBeCloseTo(-r, 9);
    expect(o[1].dx).toBeCloseTo(r, 9);
    expect(o[1].dy).toBeCloseTo(0, 9);
    expect(o[2].dy).toBeCloseTo(r, 9);
    expect(o[3].dx).toBeCloseTo(-r, 9);
  });

  it("ringStyle: active at the used radius, inner below, outer above; viewHalfM scales with a 300 m floor", () => {
    expect(ringStyle(500, 500)).toBe("active");
    expect(ringStyle(500, 1000)).toBe("inner");
    expect(ringStyle(2000, 1000)).toBe("outer");
    expect(viewHalfM(500)).toBe(600);
    expect(viewHalfM(100)).toBe(300);
  });

  it("rejectedCensus = automatic counts + manual rejections", () => {
    expect(rejectedCensus(makeSelection())).toBe(3);
    expect(
      rejectedCensus(
        makeSelection({
          manualRejections: [
            { transactionId: "P1", lokalId: "LP1", reason: "too_far", at: "2026-08-21T10:00:00Z" },
          ],
        }),
      ),
    ).toBe(4);
  });
});
