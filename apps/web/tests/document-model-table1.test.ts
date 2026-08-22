import { describe, it, expect } from "vitest";
import { buildDocumentModel } from "../src/domain/document-model";
import { syntheticDocumentInput } from "./fixtures/document-model-fixture";
import type { Candidate } from "../src/domain/sample-selection";

const NBSP = " "; // non-breaking space (escape — a pasted literal is invisible to review)

const cand = (id: string, teryt: string, obreb: string, distanceM: number): Candidate => ({
  transactionId: id,
  date: "2026-05-10",
  area: 50,
  pricePerM2: 12000,
  priceTotal: 600000,
  egib: { teryt, obreb, arkusz: "22", dzialka: "13/82", budynek: "1", lokal: "1" },
  lokalId: `${teryt}.${obreb}.x`,
  distanceM,
  floor: 1,
  rooms: 2,
  market: "wtorny",
  share: "1/1",
  transType: "wolnyRynek",
  function: "mieszkalna",
  seller: null,
  pos: null,
});

describe("Tabela 1 — Obręb | Odległość (Slice 3)", () => {
  it("RCN rows print obręb label + rounded distance; manual rows print dashes; never the subject city", () => {
    const input = syntheticDocumentInput();
    input.address = "ul. Heweliusza 3, Poznań";
    input.inputs.comparables = [
      { date: "2026-05-10", area: 50, pricePerM2: 12000, source: "rcn", transactionId: "T1" },
      { date: "2026-04-01", area: 52, pricePerM2: 11000, source: "rcn", transactionId: "T2" },
      { date: "2026-03-01", area: 48, pricePerM2: 13000, source: "manual" },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [cand("T1", "306401_1", "0039", 123.4)],
      alternates: [cand("T2", "302104_2", "0006", 2875)],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 3000,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 1 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const m = buildDocumentModel(input);
    expect(m.transakcje.map((r) => [r.obreb, r.odleglosc])).toEqual([
      ["0039 Łazarz", "123"],
      ["0006 · gm. 302104", `2${NBSP}875`],
      ["—", "—"],
    ]);
    expect(JSON.stringify(m.transakcje)).not.toContain("Poznań");
    expect(JSON.stringify(m.transakcje)).not.toContain("T1");
    expect("miasto" in m.transakcje[0]).toBe(false);
  });

  it("two lokale of ONE notarial act (same transactionId) print their OWN distance/obręb, never one lokal's data twice (final wave runtime fix, Heweliusza 3/43)", () => {
    const input = syntheticDocumentInput();
    input.address = "ul. Heweliusza 3, Poznań";
    const lokalA = cand("ACT1", "306401_1", "0039", 100);
    const lokalB = cand("ACT1", "302104_2", "0006", 200);
    input.inputs.comparables = [
      {
        date: "2026-05-10",
        area: 50.63,
        pricePerM2: 7505.43,
        source: "rcn",
        transactionId: "ACT1",
        lokalId: lokalA.lokalId,
      },
      {
        date: "2026-05-10",
        area: 38.19,
        pricePerM2: 7541.24,
        source: "rcn",
        transactionId: "ACT1",
        lokalId: lokalB.lokalId,
      },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [lokalA, lokalB],
      alternates: [],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 3000,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 2 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const m = buildDocumentModel(input);
    expect(m.transakcje.map((r) => [r.obreb, r.odleglosc])).toEqual([
      ["0039 Łazarz", "100"],
      ["0006 · gm. 302104", "200"],
    ]);
  });

  it("a manual inclusion re-attached after a radius change prints its own obręb/distance, not dashes (final wave, I1)", () => {
    const input = syntheticDocumentInput();
    input.address = "ul. Heweliusza 3, Poznań";
    // The candidate lives ONLY in `manualInclusions` — it fell out of both
    // `proposed` and `alternates` when the radius shrank, but the
    // appraiser's explicit addition survives via the carried `candidate`
    // payload (`applyManualOverlay` re-attaches it; see `sample-manual.ts`).
    const reattached = cand("M1", "306401_1", "0039", 456.7);
    input.inputs.comparables = [
      {
        date: "2026-05-10",
        area: 50,
        pricePerM2: 12000,
        source: "rcn",
        transactionId: "M1",
        lokalId: reattached.lokalId,
      },
    ] as typeof input.inputs.comparables;
    input.inputs.sampleSelection = {
      version: 3,
      proposed: [],
      alternates: [],
      manualInclusions: [
        {
          transactionId: "M1",
          lokalId: reattached.lokalId,
          at: "2026-08-21T10:00:00Z",
          candidate: reattached,
        },
      ],
      flags: {},
      rejectedCounts: {},
      radiusUsedM: 500,
      radiusWalk: [],
      counts: { pool: 0, inRadius: 0, afterHygiene: 0, afterBand: 0, proposed: 0 },
      params: { subjectArea: 50, todayMonth: "2026-08" },
    };
    const m = buildDocumentModel(input);
    expect(m.transakcje.map((r) => [r.obreb, r.odleglosc])).toEqual([["0039 Łazarz", "457"]]);
  });
});
