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

  it("sorts automatic groups by the CENSUS (rejectedCounts), not by the capped sample size (T7 #6)", () => {
    // Both reasons are capped at 50 sampled rows, but primary_market's TRUE
    // census (174) dwarfs out_of_area_band's (60) — the census must decide
    // the order, not the tied row counts.
    const fiftyOf = (reason: RejectedRow["reason"], prefix: string) =>
      Array.from({ length: 50 }, (_, i): RejectedRow => ({
        ...row(reason, i),
        transactionId: `${prefix}${i}`,
        lokalId: `${prefix}L${i}`,
      }));
    const g = groupRejected(
      snap({
        rejectedCounts: { out_of_area_band: 60, primary_market: 174 },
        rejected: [...fiftyOf("out_of_area_band", "B"), ...fiftyOf("primary_market", "M")],
      }),
    );
    expect(g.map((x) => x.label)).toEqual(["rynek pierwotny", "poza pasmem metrażu"]);
    expect(g.map((x) => x.rows.length)).toEqual([50, 50]);
  });

  it("skips a manual rejection whose candidate matches nothing in proposed/alternates — no 0,00 zł/m² ghost row (T8 #1)", () => {
    const g = groupRejected(
      snap({
        manualRejections: [
          {
            transactionId: "GHOST",
            lokalId: "GHOST-L",
            reason: "too_far",
            at: "2026-08-21T10:00:00Z",
          },
        ],
      }),
    );
    expect(g).toEqual([]);
  });

  it("keeps a manual rejection with a real matching candidate next to a skipped ghost of the same reason", () => {
    const g = groupRejected(
      snap({
        manualRejections: [
          { transactionId: "P1", lokalId: "PL1", reason: "too_far", at: "2026-08-21T10:00:00Z" },
          {
            transactionId: "GHOST",
            lokalId: "GHOST-L",
            reason: "too_far",
            at: "2026-08-21T10:01:00Z",
          },
        ],
      }),
    );
    expect(g).toHaveLength(1);
    expect(g[0].rows).toHaveLength(1);
    expect(g[0].rows[0].key).toBe("P1|PL1");
  });

  it("renders a rejected re-attached manual inclusion — its candidate lives ONLY in manualInclusions, not proposed/alternates (final wave, I2)", () => {
    const reattached = cand(9);
    const g = groupRejected(
      snap({
        manualInclusions: [
          {
            transactionId: reattached.transactionId,
            lokalId: reattached.lokalId,
            at: "2026-08-21T09:00:00Z",
            candidate: reattached,
          },
        ],
        manualRejections: [
          {
            transactionId: reattached.transactionId,
            lokalId: reattached.lokalId,
            reason: "too_far",
            at: "2026-08-21T10:00:00Z",
          },
        ],
      }),
    );
    expect(g).toHaveLength(1);
    expect(g[0].rows).toHaveLength(1);
    expect(g[0].rows[0]).toMatchObject({
      key: `${reattached.transactionId}|${reattached.lokalId}`,
      manual: true,
      pricePerM2: reattached.pricePerM2,
      distanceM: reattached.distanceM,
    });
  });
});
