import { describe, it, expect } from "vitest";
import { selectSample, candidateKey, type Candidate } from "../src/domain/sample-selection";
import {
  applyManualRejections,
  MANUAL_REJECTION_REASONS,
  type ManualRejection,
} from "../src/domain/sample-manual";

let n = 0;
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
const rej = (
  c: Candidate,
  reason: ManualRejection["reason"] = "building_older",
): ManualRejection => ({
  transactionId: c.transactionId,
  lokalId: c.lokalId,
  reason,
  at: "2026-08-21T10:00:00Z",
});
const P = { subjectArea: 50, todayMonth: "2026-08" };

describe("applyManualRejections — overlay on the domain result, never inside it", () => {
  // 20 clean candidates ranked by distance → proposed = 12, alternates = 8.
  const pool = Array.from({ length: 20 }, (_, i) => mk({ distanceM: 10 + i }));
  const sel = selectSample(pool, P);

  it("no rejections → identity", () => {
    const out = applyManualRejections(sel, []);
    expect(out.proposed).toEqual(sel.proposed);
    expect(out.alternates).toEqual(sel.alternates);
    expect(out.removed).toEqual([]);
  });
  it("rejecting a proposed row pulls the first alternate in, keeps ranking order, reports removed", () => {
    const victim = sel.proposed[3];
    const out = applyManualRejections(sel, [rej(victim)]);
    expect(out.proposed).toHaveLength(12);
    expect(out.proposed.map(candidateKey)).not.toContain(candidateKey(victim));
    expect(out.proposed[11]).toEqual(sel.alternates[0]);
    expect(out.alternates).toEqual(sel.alternates.slice(1));
    expect(out.removed).toEqual([victim]);
  });
  it("rejecting an alternate only removes it", () => {
    const victim = sel.alternates[2];
    const out = applyManualRejections(sel, [rej(victim, "too_far")]);
    expect(out.proposed).toEqual(sel.proposed);
    expect(out.alternates.map(candidateKey)).not.toContain(candidateKey(victim));
  });
  it("never promotes a price_outlier / primary_suspect alternate (ADR-015 rules 5 & 7)", () => {
    const flagged = sel.alternates[0];
    const withFlag = {
      ...sel,
      flags: { ...sel.flags, [candidateKey(flagged)]: ["price_outlier" as const] },
    };
    const out = applyManualRejections(withFlag, [rej(sel.proposed[0])]);
    expect(out.proposed.map(candidateKey)).not.toContain(candidateKey(flagged));
    expect(out.proposed[11]).toEqual(sel.alternates[1]);
    expect(out.alternates.map(candidateKey)).toContain(candidateKey(flagged));
  });
  it("respects maxPerBuilding when refilling (rule 6)", () => {
    // 3 proposed rows already share building "B"; the first alternate is a 4th from "B".
    const egibB = {
      teryt: "306401_1",
      obreb: "0021",
      arkusz: "10",
      dzialka: "27",
      budynek: "B",
      lokal: "x",
    };
    const sameB = [1, 2, 3, 4].map((i) =>
      mk({ distanceM: i, egib: { ...egibB, lokal: String(i) } }),
    );
    const others = Array.from({ length: 12 }, (_, i) => mk({ distanceM: 50 + i }));
    const sel2 = selectSample([...sameB, ...others], P);
    expect(sel2.proposed.filter((c) => c.egib?.budynek === "B")).toHaveLength(3);
    const victim = sel2.proposed.find((c) => c.egib?.budynek !== "B")!;
    const out = applyManualRejections(sel2, [rej(victim)]);
    expect(out.proposed.filter((c) => c.egib?.budynek === "B")).toHaveLength(3);
    expect(out.proposed).toHaveLength(12);
  });
  it("inverse of rule 6 — freeing a full building's slot admits its own demoted alternate", () => {
    // Same setup as the previous test: 3 proposed rows share building "B",
    // the 4th "B" candidate sits demoted as the first alternate.
    const egibB = {
      teryt: "306401_1",
      obreb: "0021",
      arkusz: "10",
      dzialka: "27",
      budynek: "B",
      lokal: "x",
    };
    const sameB = [1, 2, 3, 4].map((i) =>
      mk({ distanceM: i, egib: { ...egibB, lokal: String(i) } }),
    );
    const others = Array.from({ length: 12 }, (_, i) => mk({ distanceM: 50 + i }));
    const sel2 = selectSample([...sameB, ...others], P);
    const fromB = (c: Candidate) => c.egib?.budynek === "B";
    expect(sel2.proposed.filter(fromB)).toHaveLength(3);
    const fourthFromB = sel2.alternates.find(fromB)!;
    expect(fourthFromB).toBeDefined();

    // Reject one of the three proposed "B" rows — the building's count drops
    // to 2, freeing the slot the demoted 4th "B" alternate can now fill.
    const victim = sel2.proposed.find(fromB)!;
    const out = applyManualRejections(sel2, [rej(victim)]);
    expect(out.proposed.filter(fromB)).toHaveLength(3);
    expect(out.proposed.map(candidateKey)).toContain(candidateKey(fourthFromB));
    expect(out.proposed).toHaveLength(12);
  });
  it("unknown keys are ignored; duplicates count once", () => {
    const ghost: ManualRejection = {
      transactionId: "nope",
      lokalId: "nope",
      reason: "other",
      at: "2026-08-21T10:00:00Z",
    };
    const out = applyManualRejections(sel, [ghost, rej(sel.proposed[0]), rej(sel.proposed[0])]);
    expect(out.removed).toHaveLength(1);
    expect(out.proposed).toHaveLength(12);
  });
  it("exposes the reason vocabulary used by the UI", () => {
    expect(MANUAL_REJECTION_REASONS).toEqual([
      "building_older",
      "building_newer",
      "different_building_type",
      "different_standard",
      "too_far",
      "other",
    ]);
  });
});
