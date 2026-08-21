import { describe, it, expect } from "vitest";
import {
  selectSample,
  dedupe,
  candidateKey,
  floorMonth,
  isWholeShare,
  hygieneReasons,
  DEFAULTS,
  type Candidate,
} from "../src/domain/sample-selection";

let n = 0;
function mk(over: Partial<Candidate> = {}): Candidate {
  n += 1;
  // Each candidate is its own building by default (budynek = n); tests that need a shared building set egib explicitly.
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
const P = { subjectArea: 50, todayMonth: "2026-08" };

describe("helpers", () => {
  it("floorMonth/isWholeShare", () => {
    expect(floorMonth("2026-03", 24)).toBe("2024-03");
    expect(floorMonth("2026-01", 1)).toBe("2025-12");
    expect(isWholeShare("1/1")).toBe(true);
    expect(isWholeShare("3/3")).toBe(true);
    expect(isWholeShare("1/2")).toBe(false);
    expect(isWholeShare("")).toBe(false);
  });
  it("hygieneReasons lists every reason in evaluation order", () => {
    const c = mk({
      pricePerM2: 0,
      function: "uslugowa",
      transType: "przetarg",
      share: "1/2",
      date: "2020-01-01",
      market: "pierwotny",
    });
    expect(hygieneReasons(c, "2024-08", "2026-08")).toEqual([
      "no_price",
      "not_residential",
      "not_free_market",
      "share_not_whole",
      "out_of_window",
      "primary_market",
    ]);
  });
  it("candidateKey pairs transactionId with lokalId", () => {
    expect(candidateKey({ transactionId: "A", lokalId: "L" })).toBe("A|L");
  });
});

describe("selectSample — ADR-015 defaults", () => {
  it("gates the radius walk on afterBand ≥ minPoolAfterBand and reports the walk", () => {
    // 29 in-band within 500 m, 1 more at 900 m → 500 m fails the gate (29 < 30), 1000 m passes.
    const pool = [...Array(29)].map(() => mk({ distanceM: 200 })).concat(mk({ distanceM: 900 }));
    const s = selectSample(pool, P);
    expect(s.radiusUsedM).toBe(1000);
    expect(s.radiusWalk.map((w) => w.radiusM)).toEqual([500, 1000]);
    expect(s.counts).toEqual({
      pool: 30,
      inRadius: 30,
      afterHygiene: 30,
      afterBand: 30,
      proposed: 12,
    });
  });
  it("band-only pool below the gate still stops at the last step (3000)", () => {
    const s = selectSample([mk({ distanceM: 2500 })], P);
    expect(s.radiusUsedM).toBe(3000);
    expect(s.proposed).toHaveLength(1);
  });
  it("radiusOverrideM replaces the walk", () => {
    const s = selectSample([mk({ distanceM: 700 })], { ...P, radiusOverrideM: 500 });
    expect(s.radiusUsedM).toBe(500);
    expect(s.proposed).toHaveLength(0);
    expect(s.counts.inRadius).toBe(0);
    expect(s.counts.pool).toBe(1);
  });
  it("rejects with coded reasons, only inside the radius; out-of-radius is a count, not a rejection", () => {
    const s = selectSample([mk({ share: "1/2" }), mk({ area: 90 }), mk({ distanceM: 5000 })], P);
    expect(s.rejected.map((r) => r.reason).sort()).toEqual(["out_of_area_band", "share_not_whole"]);
    expect(s.counts).toMatchObject({ pool: 3, inRadius: 2, afterHygiene: 1, afterBand: 0 });
  });
  it("ranks same building > same parcel > same obręb > distance, tie → newer date", () => {
    const subjectEgib = { obreb: "0021", arkusz: "10", dzialka: "27", budynek: "2" };
    const far = mk({ distanceM: 3000, egib: { ...mk().egib!, obreb: "0099" } });
    const obreb = mk({ distanceM: 400, egib: { ...mk().egib!, dzialka: "1" } });
    const parcel = mk({ distanceM: 400, egib: { ...mk().egib!, budynek: "9" } });
    const bldOld = mk({ distanceM: 10, date: "2025-01-01", egib: { ...mk().egib!, budynek: "2" } });
    const bldNew = mk({ distanceM: 10, date: "2026-01-01", egib: { ...mk().egib!, budynek: "2" } });
    const s = selectSample([far, obreb, parcel, bldOld, bldNew], {
      ...P,
      subjectEgib,
      radiusOverrideM: 3000,
    });
    expect(s.proposed.map((c) => c.transactionId)).toEqual(
      [bldNew, bldOld, parcel, obreb, far].map((c) => c.transactionId),
    );
  });
  it("ranking has a total order: ties on score+date+transactionId break on lokalId asc", () => {
    // Same transactionId, date, distance and egib — only lokalId differs, so
    // score and every earlier tie-break are equal; the final tie-break
    // (lokalId asc) must still produce a deterministic, order-independent result.
    const egib = {
      teryt: "306401_1",
      obreb: "0021",
      arkusz: "10",
      dzialka: "27",
      budynek: "5",
      lokal: "5",
    };
    const b = mk({ transactionId: "TIE", lokalId: "L-B", date: "2026-05-10", distanceM: 50, egib });
    const a = mk({ transactionId: "TIE", lokalId: "L-A", date: "2026-05-10", distanceM: 50, egib });
    const filler = [...Array(5)].map(() => mk({ distanceM: 800 }));
    const pool = [a, b, ...filler];
    const keyOrder = (s: ReturnType<typeof selectSample>) =>
      s.ranking.map((r) => candidateKey(r.candidate));
    const s1 = selectSample(pool, P);
    const s2 = selectSample([...pool].reverse(), P);
    expect(keyOrder(s1)).toEqual(keyOrder(s2));
    const tieRank = keyOrder(s1).filter((k) => k.startsWith("TIE|"));
    expect(tieRank).toEqual([candidateKey(a), candidateKey(b)]); // "L-A" < "L-B"
  });
  it("flags price_outlier (IQR 1.5×, n ≥ 8) and keeps it out of proposed but in alternates", () => {
    const pool = [...Array(11)]
      .map(() => mk({ pricePerM2: 12000 }))
      .concat(mk({ pricePerM2: 40000 }));
    const s = selectSample(pool, P);
    const outlier = pool[11];
    expect(s.flags[candidateKey(outlier)]).toContain("price_outlier");
    expect(s.proposed).not.toContain(outlier);
    expect(s.alternates).toContain(outlier);
    expect(s.proposed).toHaveLength(11);
  });
  it("IQR non-degenerate: only the candidate beyond hi gets price_outlier, a near-boundary one does not", () => {
    const prices = [10000, 10500, 11000, 11500, 12000, 12500, 13000, 13500, 16500, 18000];
    const pool = prices.map((p) => mk({ pricePerM2: p }));
    // Same positional-quartile definition as iqrBounds: sorted[floor(n/4)], sorted[floor(3n/4)].
    const sorted = [...prices].sort((x, y) => x - y);
    const total = sorted.length;
    const q1 = sorted[Math.floor(total / 4)];
    const q3 = sorted[Math.floor((3 * total) / 4)];
    const hi = q3 + 1.5 * (q3 - q1);
    expect(hi).toBe(17250); // sanity: pins the arithmetic this test relies on
    const nearMiss = pool.find((c) => c.pricePerM2 === 16500)!; // between q3+1.0·IQR (16000) and hi
    const outlier = pool.find((c) => c.pricePerM2 === 18000)!; // beyond hi
    const s = selectSample(pool, P);
    expect(s.flags[candidateKey(outlier)]).toContain("price_outlier");
    expect(s.flags[candidateKey(nearMiss)] ?? []).not.toContain("price_outlier");
  });
  it("below iqrMinN (n < 8): no price_outlier flags regardless of spread", () => {
    const prices = [10000, 10500, 11000, 11500, 12000, 12500, 999999];
    const pool = prices.map((p) => mk({ pricePerM2: p }));
    const s = selectSample(pool, P);
    for (const c of pool) {
      expect(s.flags[candidateKey(c)] ?? []).not.toContain("price_outlier");
    }
  });
  it("primary_suspect requires market === null (wtorny + legal seller is not flagged)", () => {
    const c = mk({ market: "wtorny", seller: "osobaPrawna" });
    const s = selectSample([c], P);
    expect(s.flags[candidateKey(c)] ?? []).not.toContain("primary_suspect");
    expect(s.proposed).toContain(c);
  });
  it("flags primary_suspect (market null ∧ seller osobaPrawna) and demotes; market null alone → market_unknown only", () => {
    const suspect = mk({ market: null, seller: "osobaPrawna" });
    const unknown = mk({ market: null, seller: "osobaFizyczna" });
    const s = selectSample([suspect, unknown], P);
    expect(s.flags[candidateKey(suspect)]).toEqual(["market_unknown", "primary_suspect"]);
    expect(s.flags[candidateKey(unknown)]).toEqual(["market_unknown"]);
    expect(s.proposed).toEqual([unknown]);
    expect(s.alternates).toEqual([suspect]);
  });
  it("rejects pierwotny outright (reason primary_market)", () => {
    const s = selectSample([mk({ market: "pierwotny" })], P);
    expect(s.rejected[0].reason).toBe("primary_market");
  });
  it("caps proposed at 3 per building; overflow goes to alternates in ranking order", () => {
    const shared = {
      teryt: "306401_1",
      obreb: "0021",
      arkusz: "10",
      dzialka: "27",
      budynek: "2",
      lokal: "x",
    };
    const pool = [...Array(5)].map(() => mk({ egib: shared })); // all same building key
    const s = selectSample(pool, P);
    expect(s.proposed).toHaveLength(3);
    expect(s.alternates).toHaveLength(2);
  });
  it("candidates without parsable egib count as their own building (no cap collision), even when four share a transactionId", () => {
    // 4 of the 5 candidates share one transactionId (different lokalId via
    // `n`) — the old `"?" + transactionId` fallback would have collapsed
    // them into ONE building key, capping proposed at 3 (maxPerBuilding).
    // buildingKey falling back to the full candidateKey (transactionId|lokalId)
    // keeps every one of them its own building, so all 5 are still proposed.
    const shared = mk({ egib: null });
    const siblings = [...Array(3)].map(() =>
      mk({ egib: null, transactionId: shared.transactionId }),
    ); // same act, different lokal
    const other = mk({ egib: null });
    const pool = [shared, ...siblings, other];
    expect(selectSample(pool, P).proposed).toHaveLength(5);
  });
  it("flags are keyed by transactionId|lokalId — two lokale of one act do not bleed", () => {
    const a = mk({ transactionId: "ACT", pricePerM2: 12000 });
    const b = mk({ transactionId: "ACT", pricePerM2: 40000 });
    const filler = [...Array(10)].map(() => mk({ pricePerM2: 12000 }));
    const s = selectSample([a, b, ...filler], P);
    expect(s.flags[candidateKey(a)]).toBeUndefined();
    expect(s.flags[candidateKey(b)]).toContain("price_outlier");
  });
  it("is deterministic and does not mutate input", () => {
    const pool = [...Array(40)].map((_, i) =>
      mk({ distanceM: (i * 37) % 900, pricePerM2: 11000 + ((i * 131) % 900) }),
    );
    const snapshot = JSON.stringify(pool);
    const a = selectSample(pool, P);
    const b = selectSample([...pool].reverse(), P);
    expect(a.proposed.map((c) => c.transactionId)).toEqual(b.proposed.map((c) => c.transactionId));
    expect(JSON.stringify(pool)).toBe(snapshot);
  });
  it("DEFAULTS pin ADR-015", () => {
    expect(DEFAULTS).toMatchObject({
      windowMonths: 24,
      areaBandPct: 0.3,
      radiusStepsM: [500, 1000, 2000, 3000],
      minPoolAfterBand: 30,
      proposedN: 12,
      alternatesN: 40,
      maxPerBuilding: 3,
      iqrMinN: 8,
      iqrFactor: 1.5,
    });
  });
});

describe("dedupe", () => {
  it("keeps the highest versionId per (transactionId, lokalId) pair", () => {
    const r = dedupe([
      { transactionId: "A", lokalId: "L1", versionId: "2015-01-01T00:00:00", v: 1 },
      { transactionId: "A", lokalId: "L1", versionId: "2016-01-01T00:00:00", v: 2 },
      { transactionId: "A", lokalId: "L2", versionId: "2015-01-01T00:00:00", v: 3 },
    ]);
    expect(r.dropped).toBe(1);
    expect(r.kept.map((x) => x.v).sort()).toEqual([2, 3]);
  });
});
