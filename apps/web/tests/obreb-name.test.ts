import { describe, it, expect } from "vitest";
import { OBREBY_POZNAN, obrebLabel, obrebName } from "../src/domain/obreb-name";

describe("obrebLabel", () => {
  it("Poznań code with a known name → 'code name' (Łazarz verified against ULDK 2026-08-21)", () => {
    expect(OBREBY_POZNAN["0039"]).toBe("Łazarz");
    expect(obrebLabel({ teryt: "306401_1", obreb: "0039" })).toBe("0039 Łazarz");
  });
  it("Poznań code without a name → bare code (never a guess)", () => {
    expect(obrebLabel({ teryt: "306401_1", obreb: "9999" })).toBe("9999");
  });
  it("outside Poznań → code + gmina TERYT", () => {
    expect(obrebLabel({ teryt: "302104_2", obreb: "0006" })).toBe("0006 · gm. 302104");
  });
  it("no egib → em dash", () => {
    expect(obrebLabel(null)).toBe("—");
  });
  it("the map has the coverage the 7 pools' F-14 candidates actually yield (24 distinct Poznań obręby, all resolved by GEOPOZ — zero misses)", () => {
    expect(Object.keys(OBREBY_POZNAN).length).toBe(24);
    for (const [code, name] of Object.entries(OBREBY_POZNAN)) {
      expect(code).toMatch(/^\d{4}$/);
      expect(name.length).toBeGreaterThan(1);
    }
  });
});

describe("obrebName", () => {
  it("Poznań code with a known name → bare name", () => {
    expect(obrebName({ teryt: "306401_1", obreb: "0039" })).toBe("Łazarz");
  });
  it("outside Poznań → 'gm. <TERYT prefix>'", () => {
    expect(obrebName({ teryt: "302104_2", obreb: "0006" })).toBe("gm. 302104");
  });
  it("Poznań code without a name → null (never a guess)", () => {
    expect(obrebName({ teryt: "306401_1", obreb: "9999" })).toBeNull();
  });
  it("no egib → null", () => {
    expect(obrebName(null)).toBeNull();
  });
});
