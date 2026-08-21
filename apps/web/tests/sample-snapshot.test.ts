import { describe, it, expect } from "vitest";
import { selectSample, candidateKey, type Candidate } from "../src/domain/sample-selection";
import { toSampleSelectionSnapshot } from "../src/domain/sample-snapshot";
import { loadSnapshot } from "./fixtures/rcn-snapshots/load";
import { deriveSubjectEgib } from "../src/domain/egib-id";

let n = 0;
/** Mirrors sample-selection.test.ts's `mk()` — each candidate its own building by default. */
function mk(over: Partial<Candidate> = {}): Candidate {
  n += 1;
  const egib = {
    teryt: "306401_1",
    obreb: "0021",
    arkusz: "10",
    dzialka: "27",
    budynek: String(n),
    lokal: String(n),
  };
  return {
    transactionId: `T${n}`,
    date: "2026-05-10",
    area: 50,
    pricePerM2: 12000,
    priceTotal: 600000,
    egib,
    lokalId: `306401_1.0021.AR_10.27.2_BUD.${n}_LOK`,
    distanceM: 100,
    floor: 2,
    rooms: 2,
    market: "wtorny",
    share: "1/1",
    transType: "wolnyRynek",
    function: "mieszkalna",
    seller: "osobaFizyczna",
    pos: { x: 0, y: 0 },
    ...over,
  };
}

describe("toSampleSelectionSnapshot", () => {
  const { subject, candidates } = loadSnapshot("heweliusza");
  const params = {
    subjectArea: 50,
    todayMonth: "2026-08",
    subjectEgib: deriveSubjectEgib(subject.buildingId, subject.parcelId),
  };
  const sel = selectSample(candidates, params);
  const snap = toSampleSelectionSnapshot(sel, params);

  it("keeps proposed/alternates/counts/radius, drops ranking and the rejected list", () => {
    expect(snap.version).toBe(3);
    expect(snap.proposed).toEqual(sel.proposed);
    expect(snap.alternates).toEqual(sel.alternates);
    expect(snap.counts).toEqual(sel.counts);
    expect(snap.radiusUsedM).toBe(sel.radiusUsedM);
    expect("ranking" in snap).toBe(false);
    expect("rejected" in snap).toBe(false);
  });
  it("flags only for proposed ∪ alternates; rejectedCounts sums to the rejected list", () => {
    const keep = new Set([...sel.proposed, ...sel.alternates].map(candidateKey));
    expect(Object.keys(snap.flags).every((k) => keep.has(k))).toBe(true);
    expect(Object.values(snap.rejectedCounts).reduce((a, b) => a + (b ?? 0), 0)).toBe(
      sel.rejected.length,
    );
  });
  it("stays small enough for a jsonb column (< 120 kB for a 3 km pool)", () => {
    expect(JSON.stringify(snap).length).toBeLessThan(120_000);
  });
  it("params record what the appraiser would need to re-run the choice", () => {
    expect(snap.params).toEqual({
      subjectArea: 50,
      todayMonth: "2026-08",
      subjectEgib: params.subjectEgib,
    });
  });
});

describe("toSampleSelectionSnapshot — flags trimming is load-bearing (synthetic, afterBand > 52)", () => {
  const P = { subjectArea: 50, todayMonth: "2026-08" };
  // 55 "normal" candidates, close in (distanceM 10..64) — these fill proposed
  // (top 12) and most of alternates (next 40).
  const normal = Array.from({ length: 55 }, (_, i) => mk({ distanceM: 10 + i }));
  // 15 price outliers, still within the same 500 m radius step (400..414)
  // but ranked worse than every normal candidate (larger distanceM ⇒ lower
  // score) — so they land past both proposed AND the 40-wide alternates cap,
  // in the part of the band-passing pool the snapshot has to drop.
  const outliers = Array.from({ length: 15 }, (_, i) =>
    mk({ distanceM: 400 + i, pricePerM2: 100_000, priceTotal: 5_000_000 }),
  );
  const candidates = [...normal, ...outliers];
  const sel = selectSample(candidates, P);
  const snap = toSampleSelectionSnapshot(sel, P);

  it("bands 70 candidates (> 52 kept) and flags exactly the 15 price outliers", () => {
    expect(sel.counts.afterBand).toBe(70);
    expect(sel.proposed.length + sel.alternates.length).toBeLessThanOrEqual(52);
    expect(Object.keys(sel.flags)).toHaveLength(15);
  });

  it("trims every flagged-but-dropped outlier out of the snapshot", () => {
    const keep = new Set([...sel.proposed, ...sel.alternates].map(candidateKey));
    expect(Object.keys(snap.flags).length).toBeLessThan(Object.keys(sel.flags).length);
    expect(Object.keys(snap.flags).every((k) => keep.has(k))).toBe(true);
    // None of the 15 outliers made it into proposed/alternates, so the
    // snapshot's flags map is empty even though the domain flagged 15 rows.
    expect(Object.keys(snap.flags)).toHaveLength(0);
  });
});
