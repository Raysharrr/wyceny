import { describe, it, expect } from "vitest";
import pairs from "./fixtures/geo-pairs.json";
import { puwg92ToWgs84, bearingDeg, mapFrame, distanceM } from "../src/domain/geo";

const M_PER_DEG_LAT = 111_320;
describe("puwg92ToWgs84 — EPSG:2180 (PUWG 1992) → WGS84", () => {
  it("matches ULDK's own reprojection of the same parcel vertex within 0.5 m", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    for (const p of pairs) {
      const { lat, lng } = puwg92ToWgs84(p.x, p.y);
      const dN = (lat - p.lat) * M_PER_DEG_LAT;
      const dE = (lng - p.lng) * M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180);
      expect(Math.hypot(dN, dE)).toBeLessThan(0.5);
    }
  });
  it("Heweliusza 3 (verified against ULDK GetParcelByXY on 2026-08-21)", () => {
    const { lat, lng } = puwg92ToWgs84(355285.45, 505324.31);
    expect(lat).toBeCloseTo(52.3946835, 5);
    expect(lng).toBeCloseTo(16.8724944, 5);
  });
});
describe("bearingDeg", () => {
  it("north = 0, east = 90, south = 180, west = 270", () => {
    const o = { lat: 52.4, lng: 16.9 };
    expect(bearingDeg(o, { lat: 52.41, lng: 16.9 })).toBeCloseTo(0, 0);
    expect(bearingDeg(o, { lat: 52.4, lng: 16.91 })).toBeCloseTo(90, 0);
    expect(bearingDeg(o, { lat: 52.39, lng: 16.9 })).toBeCloseTo(180, 0);
    expect(bearingDeg(o, { lat: 52.4, lng: 16.89 })).toBeCloseTo(270, 0);
  });
});
describe("mapFrame — linear metre→pixel in EPSG:2180", () => {
  const f = mapFrame({ x: 355285, y: 505324 }, 1200, 480);
  it("bbox in WMS 1.3.0 axis order (minN, minE, maxN, maxE)", () => {
    expect(f.bbox).toEqual([504124, 354085, 506524, 356485]);
    expect(f.mPerPx).toBe(5);
  });
  it("centre maps to the middle; +600 m east = +120 px; +600 m north = −120 px (screen y down)", () => {
    expect(f.toPx({ x: 355285, y: 505324 })).toEqual({ px: 240, py: 240 });
    expect(f.toPx({ x: 355885, y: 505324 })).toEqual({ px: 360, py: 240 });
    expect(f.toPx({ x: 355285, y: 505924 })).toEqual({ px: 240, py: 120 });
  });
});
describe("distanceM — equirectangular metres", () => {
  it("0.001° of latitude ≈ 111 m", () => {
    const a = { lat: 52.4, lng: 16.9 };
    const b = { lat: 52.401, lng: 16.9 };
    expect(distanceM(a, b)).toBeCloseTo(111.32, -1);
  });
  it("same point → 0", () => {
    const p = { lat: 52.4, lng: 16.9 };
    expect(distanceM(p, p)).toBe(0);
  });
});
