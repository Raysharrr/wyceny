import { describe, it, expect } from "vitest";
import { selectSample, candidateKey } from "../src/domain/sample-selection";
import { toSampleSelectionSnapshot } from "../src/domain/sample-snapshot";
import { loadSnapshot } from "./fixtures/rcn-snapshots/load";
import { deriveSubjectEgib } from "../src/domain/egib-id";

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
