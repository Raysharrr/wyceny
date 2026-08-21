import { describe, it, expect } from "vitest";
import { mapDots } from "../src/app/valuations/[id]/steps/map-dots";
import type { SampleSelectionSnapshot } from "../src/domain/sample-snapshot";
import type { Candidate } from "../src/domain/sample-selection";

const c = (id: string, pos: { x: number; y: number } | null): Candidate => ({
  transactionId: id,
  date: "2026-05-01",
  area: 50,
  pricePerM2: 12000,
  priceTotal: 600000,
  egib: null,
  lokalId: `L${id}`,
  distanceM: 0,
  floor: 1,
  rooms: 2,
  market: "wtorny",
  share: "1/1",
  transType: "wolnyRynek",
  function: "mieszkalna",
  seller: null,
  pos,
});
// `flags` gives "A" a `price_outlier` demotion (finding during TDD, 2026-08-21):
// `effectiveSelection`/`applyManualRejections` backfills `proposed` from
// `alternates` up to `DEFAULTS.proposedN` (12) whenever a slot opens — so
// rejecting the lone `proposed` row ("P") would otherwise promote "A" out
// of `alternates` (correct domain behaviour, mirrors `use-sample-review.ts`'s
// `reject()`), which is not what this fixture means to exercise. The
// demotion flag keeps "A" out of the backfill so it stays an `alternate` dot.
const snap: SampleSelectionSnapshot = {
  version: 3,
  proposed: [c("P", { x: 1100, y: 1000 })],
  alternates: [c("A", { x: 1000, y: 1100 }), c("N", null)],
  flags: { "A|LA": ["price_outlier"] },
  rejectedCounts: {},
  rejected: [
    {
      transactionId: "R",
      lokalId: "LR",
      reason: "no_price",
      allReasons: ["no_price"],
      date: "2026-01-01",
      area: 40,
      pricePerM2: 0,
      distanceM: 100,
      pos: { x: 900, y: 1000 },
    },
  ],
  manualRejections: [
    { transactionId: "P", lokalId: "LP", reason: "too_far", at: "2026-08-21T10:00:00Z" },
  ],
  radiusUsedM: 500,
  radiusWalk: [],
  counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 1 },
  params: { subjectArea: 50, todayMonth: "2026-08" },
};

describe("mapDots", () => {
  const out = mapDots(snap, { x: 1000, y: 1000 }, 600, 600); // 2 m/px
  it("subject in the centre; +100 m east = +50 px", () => {
    expect(out.subject).toEqual({ px: 300, py: 300 });
    const a = out.dots.find((d) => d.key === "A|LA")!;
    expect(a).toMatchObject({ kind: "alternate", px: 300, py: 250 });
  });
  it("manually rejected proposed row is drawn as rejected; rows without pos are skipped", () => {
    expect(out.dots.find((d) => d.key === "P|LP")?.kind).toBe("rejected");
    expect(out.dots.find((d) => d.key.startsWith("N|"))).toBeUndefined();
    expect(out.dots.find((d) => d.key === "R|LR")).toMatchObject({
      kind: "rejected",
      px: 250,
      py: 300,
    });
  });
  it("rings for every default step that fits the frame; the used radius is active", () => {
    expect(out.rings.map((r) => [r.radiusM, r.rPx, r.active])).toEqual([[500, 250, true]]);
    const wide = mapDots(snap, { x: 1000, y: 1000 }, 2400, 600);
    expect(wide.rings.map((r) => r.radiusM)).toEqual([500, 1000, 2000]);
  });
});

describe("mapDots — overlap spreading (final wave minor ii)", () => {
  it("three dots at the exact same position get three distinct (px,py), each within 8 px of the original", () => {
    const pos = { x: 1100, y: 1000 };
    // Baseline: one dot alone at `pos`, untouched by the spread (the whole
    // point — a position held by exactly one dot must not move).
    const solo: SampleSelectionSnapshot = {
      ...snap,
      proposed: [c("SOLO", pos)],
      alternates: [],
      rejected: [],
      manualRejections: [],
      flags: {},
    };
    const original = mapDots(solo, { x: 1000, y: 1000 }, 600, 600).dots.find(
      (d) => d.key === "SOLO|LSOLO",
    )!;
    expect(original).toBeDefined();

    // Three candidates sharing the SAME `pos` (one building — e.g. three
    // lokale of one notarial act) previously stacked 1:1, leaving only the
    // top one clickable.
    const trio: SampleSelectionSnapshot = {
      ...snap,
      proposed: [c("P1", pos), c("P2", pos)],
      alternates: [c("A1", pos)],
      rejected: [],
      manualRejections: [],
      flags: {},
    };
    const out = mapDots(trio, { x: 1000, y: 1000 }, 600, 600);
    const dots = ["P1|LP1", "P2|LP2", "A1|LA1"].map((k) => out.dots.find((d) => d.key === k)!);
    expect(dots.every(Boolean)).toBe(true);

    const positions = new Set(dots.map((d) => `${d.px},${d.py}`));
    expect(positions.size).toBe(3);

    for (const d of dots) {
      expect(Math.hypot(d.px - original.px, d.py - original.py)).toBeLessThanOrEqual(8);
    }
  });

  it("a lone dot at a position is left exactly where it was (no spurious offset)", () => {
    // The default `snap` fixture's dots (A, P-as-rejected, R) all sit at
    // distinct positions — unaffected by spreadOverlaps.
    const out = mapDots(snap, { x: 1000, y: 1000 }, 600, 600);
    expect(out.dots.find((d) => d.key === "A|LA")).toMatchObject({ px: 300, py: 250 });
    expect(out.dots.find((d) => d.key === "R|LR")).toMatchObject({ px: 250, py: 300 });
  });
});
