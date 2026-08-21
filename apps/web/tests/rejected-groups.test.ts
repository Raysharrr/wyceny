import { describe, it, expect } from "vitest";
import { groupRejected } from "../src/app/valuations/[id]/steps/rejected-groups";
import type { SampleSelectionSnapshot, RejectedRow } from "../src/domain/sample-snapshot";
import type { Candidate } from "../src/domain/sample-selection";

const row = (reason: RejectedRow["reason"], i: number): RejectedRow => ({
  transactionId: `R${i}`,
  lokalId: `L${i}`,
  reason,
  allReasons: [reason],
  date: "2026-01-01",
  area: 40,
  pricePerM2: 9000,
  distanceM: 100,
  pos: null,
});
const cand = (i: number): Candidate => ({
  transactionId: `P${i}`,
  date: "2026-05-01",
  area: 50,
  pricePerM2: 12000,
  priceTotal: 600000,
  egib: null,
  lokalId: `PL${i}`,
  distanceM: 50,
  floor: 1,
  rooms: 2,
  market: "wtorny",
  share: "1/1",
  transType: "wolnyRynek",
  function: "mieszkalna",
  seller: null,
  pos: null,
});
const snap = (over: Partial<SampleSelectionSnapshot>): SampleSelectionSnapshot => ({
  version: 3,
  proposed: [cand(1), cand(2)],
  alternates: [],
  flags: {},
  rejectedCounts: {},
  radiusUsedM: 500,
  radiusWalk: [],
  counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 2 },
  params: { subjectArea: 50, todayMonth: "2026-08" },
  ...over,
});

describe("groupRejected", () => {
  it("groups hygiene/band rows by reason, largest first, then manual rejections by reason with notes", () => {
    const g = groupRejected(
      snap({
        rejected: [
          row("out_of_area_band", 1),
          row("out_of_area_band", 2),
          row("primary_market", 3),
        ],
        manualRejections: [
          {
            transactionId: "P1",
            lokalId: "PL1",
            reason: "building_older",
            note: "1905",
            at: "2026-08-21T10:00:00Z",
          },
        ],
      }),
    );
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([
      ["poza pasmem metrażu", 2],
      ["rynek pierwotny", 1],
      ["budynek starszy", 1],
    ]);
    expect(g[2].rows[0]).toMatchObject({
      key: "P1|PL1",
      manual: true,
      note: "1905",
      pricePerM2: 12000,
    });
  });
  it("snapshot without `rejected` (pre-Slice 3) → only manual groups (counts stay in rejectedCounts for the header)", () => {
    expect(groupRejected(snap({ rejectedCounts: { no_price: 4 } }))).toEqual([]);
  });
});
