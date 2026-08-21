import { describe, it, expect } from "vitest";
import { selectSample, candidateKey, type Candidate } from "../src/domain/sample-selection";
import {
  applyManualOverlay,
  applyManualRejections,
  type ManualInclusion,
  type ManualRejection,
} from "../src/domain/sample-manual";

let n = 0;
/** Mirrors sample-manual.test.ts's `mk()` — each candidate its own building by default. */
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
const inc = (c: Candidate): ManualInclusion => ({
  transactionId: c.transactionId,
  lokalId: c.lokalId,
  at: "2026-08-21T10:00:00Z",
  candidate: c,
});
const rej = (c: Candidate, reason: ManualRejection["reason"] = "too_far"): ManualRejection => ({
  transactionId: c.transactionId,
  lokalId: c.lokalId,
  reason,
  at: "2026-08-21T10:00:00Z",
});
const P = { subjectArea: 50, todayMonth: "2026-08" };

describe("applyManualOverlay — inclusions on top of rejections", () => {
  const pool = Array.from({ length: 20 }, (_, i) => mk({ distanceM: 10 + i }));
  const sel = selectSample(pool, P); // proposed 12, alternates 8

  it("no overlay → identical to applyManualRejections (base behaviour untouched)", () => {
    const a = applyManualOverlay(sel, { rejections: [], inclusions: [] });
    const b = applyManualRejections(sel, []);
    expect(a.proposed).toEqual(b.proposed);
    expect(a.alternates).toEqual(b.alternates);
    expect(a.included).toEqual([]);
  });

  it("including an alternate puts it into proposed beyond 12, in ranking order, and removes it from alternates", () => {
    const add = sel.alternates[3];
    const out = applyManualOverlay(sel, { rejections: [], inclusions: [inc(add)] });
    expect(out.proposed).toHaveLength(13);
    expect(out.proposed[12]).toEqual(add);
    expect(out.alternates.map(candidateKey)).not.toContain(candidateKey(add));
    expect(out.included).toEqual([add]);
  });

  it("inclusion bypasses demoting flags and maxPerBuilding (explicit choice wins)", () => {
    const flagged = sel.alternates[0];
    const withFlag = {
      ...sel,
      flags: { ...sel.flags, [candidateKey(flagged)]: ["price_outlier" as const] },
    };
    const out = applyManualOverlay(withFlag, { rejections: [], inclusions: [inc(flagged)] });
    expect(out.proposed.map(candidateKey)).toContain(candidateKey(flagged));
  });

  it("rejection beats inclusion for the same key; rejecting a base row still refills from ranking (12 + additions)", () => {
    const add = sel.alternates[2];
    const out = applyManualOverlay(sel, {
      rejections: [rej(sel.proposed[0]), rej(add)],
      inclusions: [inc(add)],
    });
    expect(out.proposed.map(candidateKey)).not.toContain(candidateKey(add));
    expect(out.proposed).toHaveLength(12); // 11 base + 1 refill (first eligible alternate)
    expect(out.removed.map(candidateKey)).toEqual(
      expect.arrayContaining([candidateKey(sel.proposed[0]), candidateKey(add)]),
    );
  });

  it("an included alternate is not counted by the refill cap: reject one base row → 12 ranked + 1 added = 13", () => {
    const add = sel.alternates[5];
    const out = applyManualOverlay(sel, {
      rejections: [rej(sel.proposed[1])],
      inclusions: [inc(add)],
    });
    expect(out.proposed).toHaveLength(13);
  });

  it("an inclusion whose candidate is no longer in the lists (e.g. smaller radius) is re-attached from the stored candidate, at the end", () => {
    const far = mk({ distanceM: 5000 });
    const out = applyManualOverlay(sel, {
      rejections: [],
      inclusions: [{ ...inc(far), candidate: far }],
    });
    expect(out.proposed[out.proposed.length - 1]).toEqual(far);
    expect(out.included).toEqual([far]);
  });

  it("duplicate inclusion keys count once; an inclusion already in proposed is a no-op (not duplicated, not in included)", () => {
    const add = sel.alternates[1];
    const alreadyProposed = sel.proposed[0];
    const out = applyManualOverlay(sel, {
      rejections: [],
      inclusions: [inc(add), inc(add), inc(alreadyProposed)],
    });
    expect(out.proposed).toHaveLength(13);
    expect(out.included).toEqual([add]);
    expect(
      out.proposed.filter((c) => candidateKey(c) === candidateKey(alreadyProposed)),
    ).toHaveLength(1);
  });

  it("a rejected re-attached inclusion (candidate absent from proposed/alternates) lands in removed, not silently dropped", () => {
    const far = mk({ distanceM: 7000 });
    const out = applyManualOverlay(sel, {
      rejections: [rej(far)],
      inclusions: [{ ...inc(far), candidate: far }],
    });
    expect(out.removed.filter((c) => candidateKey(c) === candidateKey(far))).toHaveLength(1);
    expect(out.proposed.map(candidateKey)).not.toContain(candidateKey(far));
    expect(out.alternates.map(candidateKey)).not.toContain(candidateKey(far));
    expect(out.included).toEqual([]);
  });

  it("a key already in removed (rejected base row) is not duplicated by a losing inclusion for the same key", () => {
    const victim = sel.proposed[0];
    const out = applyManualOverlay(sel, {
      rejections: [rej(victim)],
      inclusions: [inc(victim)],
    });
    expect(out.removed.filter((c) => candidateKey(c) === candidateKey(victim))).toHaveLength(1);
  });

  it("inclusion bypasses maxPerBuilding: a 4th candidate from a building already at the domain's cap (3 in proposed) is still included", () => {
    const sharedEgib = { teryt: "306401_1", obreb: "0021", arkusz: "10", dzialka: "27" };
    const building = Array.from({ length: 4 }, (_, i) =>
      mk({ distanceM: 10 + i, egib: { ...sharedEgib, budynek: "shared", lokal: String(i) } }),
    );
    const others = Array.from({ length: 16 }, (_, i) => mk({ distanceM: 100 + i }));
    const localSel = selectSample([...building, ...others], P);
    const fourth = building[3];
    // Sanity: selectSample's own maxPerBuilding cap (3) demotes the 4th same-building row to alternates.
    expect(localSel.proposed.map(candidateKey)).not.toContain(candidateKey(fourth));
    expect(localSel.alternates.map(candidateKey)).toContain(candidateKey(fourth));

    const out = applyManualOverlay(localSel, { rejections: [], inclusions: [inc(fourth)] });
    expect(out.proposed.map(candidateKey)).toContain(candidateKey(fourth));
  });
});
