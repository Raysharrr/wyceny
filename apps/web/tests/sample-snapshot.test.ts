import { describe, it, expect } from "vitest";
import { selectSample, candidateKey, type Candidate } from "../src/domain/sample-selection";
import {
  toSampleSelectionSnapshot,
  effectiveSelection,
  reviewStats,
} from "../src/domain/sample-snapshot";
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

  it("keeps proposed/alternates/counts/radius, drops ranking, keeps a COMPACT rejected list", () => {
    expect(snap.version).toBe(3);
    expect(snap.proposed).toEqual(sel.proposed);
    expect(snap.alternates).toEqual(sel.alternates);
    expect(snap.counts).toEqual(sel.counts);
    expect(snap.radiusUsedM).toBe(sel.radiusUsedM);
    expect("ranking" in snap).toBe(false);
    expect(snap.rejected!.length).toBeLessThanOrEqual(sel.rejected.length);
    const first = snap.rejected![0];
    expect(Object.keys(first).sort()).toEqual([
      "allReasons",
      "area",
      "date",
      "distanceM",
      "lokalId",
      "pos",
      "pricePerM2",
      "reason",
      "transactionId",
    ]);
    expect(first.reason).toBe(sel.rejected[0].reason);
    expect(snap.manualRejections).toEqual([]);
    expect(snap.manualInclusions).toEqual([]);
    expect(snap.reviewed).toEqual([]);
  });
  it("flags only for proposed ∪ alternates; rejectedCounts sums to the rejected list", () => {
    const keep = new Set([...sel.proposed, ...sel.alternates].map(candidateKey));
    expect(Object.keys(snap.flags).every((k) => keep.has(k))).toBe(true);
    expect(Object.values(snap.rejectedCounts).reduce((a, b) => a + (b ?? 0), 0)).toBe(
      sel.rejected.length,
    );
  });
  it("stays small enough for a jsonb column on heavy pools (< 250 kB, capped rejected rows)", () => {
    for (const [slug, p] of [
      ["koscielna", { subjectArea: 71.63, todayMonth: "2026-03" }],
      ["starolecka", { subjectArea: 50, todayMonth: "2026-08" }],
    ] as const) {
      const heavy = loadSnapshot(slug);
      const heavySel = selectSample(heavy.candidates, p);
      const heavySnap = toSampleSelectionSnapshot(heavySel, p);
      expect(JSON.stringify(heavySnap).length).toBeLessThan(250_000);
    }
  });
  it("caps rejected at 50 nearest rows per reason; rejectedCounts stays the full census", () => {
    // koscielna is the heavy fixture guaranteed to push at least one reason
    // past the 50-row cap — heweliusza's `sel`/`snap` above are too small to
    // exercise the interesting (> 50) branch.
    const heavy = loadSnapshot("koscielna");
    const p = { subjectArea: 71.63, todayMonth: "2026-03" };
    const heavySel = selectSample(heavy.candidates, p);
    const heavySnap = toSampleSelectionSnapshot(heavySel, p);

    const byReason = new Map<string, typeof heavySel.rejected>();
    for (const r of heavySel.rejected) {
      const bucket = byReason.get(r.reason);
      if (bucket) bucket.push(r);
      else byReason.set(r.reason, [r]);
    }
    expect(byReason.size).toBeGreaterThan(0);
    expect([...byReason.values()].some((bucket) => bucket.length > 50)).toBe(true);
    expect(heavySnap.rejected!.length).toBeLessThanOrEqual(7 * 50);
    for (const [reason, bucket] of byReason) {
      const kept = heavySnap.rejected!.filter((r) => r.reason === reason);
      expect(kept.length).toBeLessThanOrEqual(50);
      if (bucket.length > 50) {
        // Mirrors `compareForCap` (sample-snapshot.ts) exactly, including
        // the date tie-break — a naive distance-only sort would rely on
        // Array.prototype.sort's stability (original fixture order) to
        // break ties, which can silently diverge from production the next
        // time the `koscielna` fixture is regenerated (final wave, B8).
        const nearest50 = [...bucket]
          .sort((a, b) => {
            if (a.candidate.distanceM !== b.candidate.distanceM) {
              return a.candidate.distanceM - b.candidate.distanceM;
            }
            if (a.candidate.date !== b.candidate.date) {
              return a.candidate.date > b.candidate.date ? -1 : 1;
            }
            return 0;
          })
          .slice(0, 50)
          .map((r) => `${r.candidate.transactionId}|${r.candidate.lokalId}`);
        expect(new Set(kept.map((r) => `${r.transactionId}|${r.lokalId}`))).toEqual(
          new Set(nearest50),
        );
      } else {
        expect(kept).toHaveLength(bucket.length);
      }
    }
    expect(Object.values(heavySnap.rejectedCounts).reduce((a, b) => a + (b ?? 0), 0)).toBe(
      heavySel.rejected.length,
    );
  });
  it("params record what the appraiser would need to re-run the choice", () => {
    expect(snap.params).toEqual({
      subjectArea: 50,
      todayMonth: "2026-08",
      subjectEgib: params.subjectEgib,
    });
  });
  it("effectiveSelection applies manualRejections as an overlay", () => {
    const victim = snap.proposed[0];
    const withRejection = {
      ...snap,
      manualRejections: [
        {
          transactionId: victim.transactionId,
          lokalId: victim.lokalId,
          reason: "building_older" as const,
          at: "2026-08-21T10:00:00Z",
        },
      ],
    };
    const eff = effectiveSelection(withRejection);
    expect(eff.proposed.map(candidateKey)).not.toContain(candidateKey(victim));
    expect(eff.removed).toEqual([victim]);
    expect(effectiveSelection(snap).proposed).toEqual(snap.proposed);
  });
  it("effectiveSelection applies manualInclusions as an overlay on top of rejections (Slice 3c)", () => {
    const added = snap.alternates[0];
    const withInclusion = {
      ...snap,
      manualInclusions: [
        {
          transactionId: added.transactionId,
          lokalId: added.lokalId,
          at: "2026-08-21T10:00:00Z",
          candidate: added,
        },
      ],
    };
    const eff = effectiveSelection(withInclusion);
    expect(eff.proposed).toHaveLength(snap.proposed.length + 1);
    expect(eff.proposed[eff.proposed.length - 1]).toEqual(added);
    expect(eff.alternates.map(candidateKey)).not.toContain(candidateKey(added));
    expect(eff.included).toEqual([added]);
  });
  it("reviewStats counts only reviewed keys that still exist in the effective (proposed+alternates+removed) lists", () => {
    const victim = snap.proposed[0];
    const surviving = snap.proposed[1];
    const withReview = {
      ...snap,
      manualRejections: [
        {
          transactionId: victim.transactionId,
          lokalId: victim.lokalId,
          reason: "building_older" as const,
          at: "2026-08-21T10:00:00Z",
        },
      ],
      reviewed: [
        {
          transactionId: surviving.transactionId,
          lokalId: surviving.lokalId,
          at: "2026-08-21T10:00:00Z",
        },
        { transactionId: "stale", lokalId: "nope", at: "2026-08-21T10:00:00Z" },
      ],
    };
    const stats = reviewStats(withReview);
    const eff = effectiveSelection(withReview);
    expect(stats.total).toBe(eff.proposed.length + eff.alternates.length + eff.removed.length);
    expect(stats.reviewed).toBe(1);
    expect(stats.reviewedKeys).toEqual(new Set([candidateKey(surviving)]));
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
