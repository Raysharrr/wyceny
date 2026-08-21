import { describe, it, expect } from "vitest";
import { storeysHintByBuilding, framingFor } from "../src/domain/street-view-framing";
import type { Candidate } from "../src/domain/sample-selection";

let n = 0;
function mk(budynek: string, over: Partial<Candidate> = {}): Candidate {
  n += 1;
  return {
    transactionId: `T${n}`,
    date: "2026-05-10",
    area: 50,
    pricePerM2: 12000,
    priceTotal: 600000,
    egib: {
      teryt: "306401_1",
      obreb: "0039",
      arkusz: "22",
      dzialka: "13/82",
      budynek,
      lokal: String(n),
    },
    lokalId: `306401_1.0039.AR_22.13/82.${budynek}_BUD.${n}_LOK`,
    distanceM: 10,
    floor: 1,
    rooms: 2,
    market: "wtorny",
    share: "1/1",
    transType: "wolnyRynek",
    function: "mieszkalna",
    seller: "osobaFizyczna",
    pos: { x: 355285, y: 505324 },
    ...over,
  };
}

describe("storeysHintByBuilding", () => {
  it("two candidates of the same building with floor 2 and 7 → 7 (max)", () => {
    const cands = [mk("1", { floor: 2 }), mk("1", { floor: 7 })];
    const m = storeysHintByBuilding(cands);
    expect(m.get("0039.22.13/82.1")).toBe(7);
  });
  it("a building whose only candidate has floor: null → null", () => {
    const cands = [mk("2", { floor: null })];
    const m = storeysHintByBuilding(cands);
    expect(m.get("0039.22.13/82.2")).toBeNull();
  });
  it("candidates with egib: null are skipped (no buildingKey)", () => {
    const cands = [mk("3", { egib: null, floor: 9 })];
    const m = storeysHintByBuilding(cands);
    expect(m.size).toBe(0);
  });
});

describe("framingFor", () => {
  it("no storeys hint, camera 30 m away → pitch 10, fov 80", () => {
    expect(framingFor({ storeysHint: null, cameraDistanceM: 30 })).toEqual({ pitch: 10, fov: 80 });
  });
  it("7 storeys, camera 15 m away (< 20) → pitch 24, fov 90", () => {
    expect(framingFor({ storeysHint: 7, cameraDistanceM: 15 })).toEqual({ pitch: 24, fov: 90 });
  });
  it("20 storeys (clamped), camera 50 m away → pitch 35, fov 80", () => {
    expect(framingFor({ storeysHint: 20, cameraDistanceM: 50 })).toEqual({ pitch: 35, fov: 80 });
  });
  it("0 storeys, unknown camera distance → pitch 10, fov 80", () => {
    expect(framingFor({ storeysHint: 0, cameraDistanceM: null })).toEqual({ pitch: 10, fov: 80 });
  });
});
