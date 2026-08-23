/**
 * Rozrzut cen jednostkowych (Vmax − Vmin z Tabeli 2 operatu) — miara spójności
 * cenowej próby. Liczby pochodzą z prawdziwych operatów Anety przekazanych
 * 2026-08-23; nie wolno ich zastępować wymyślonymi.
 */
import { describe, it, expect } from "vitest";
import { priceSpread, SPREAD_WARN_THRESHOLD } from "../src/domain/price-spread";

describe("priceSpread", () => {
  it("odtwarza Tabelę 2 operatu Winiary", () => {
    const s = priceSpread([
      10015.41, 9399.08, 9630.2, 10498.22, 10246.53, 9498.21, 9893.05, 9203.54, 9629.63, 10036.17,
      9673.33, 9815.95, 9244.99, 10078.74, 10292.76, 10169.49, 9964.41,
    ])!;
    expect(s.cMin).toBeCloseTo(9203.54, 2);
    expect(s.cMax).toBeCloseTo(10498.22, 2);
    expect(s.cSr).toBeCloseTo(9840.57, 2);
    // Operat drukuje w Tabeli 2 „0,936", ale 9203,54 / 9840,57 = 0,93527 —
    // half-up daje 0,935; to wewnętrzna niespójność DOKUMENTU (znalazł slice-7,
    // 2026-08-23), nie błąd przepisania. Asertujemy wartość matematycznie
    // poprawną; na wps i WR nie wpływa.
    expect(s.vMin).toBeCloseTo(0.9353, 3);
    expect(s.vMax).toBeCloseTo(1.067, 3);
    expect(s.spread).toBeCloseTo(0.1316, 3);
  });

  it("odtwarza Tabelę 2 operatu Heweliusza", () => {
    const s = priceSpread([
      11019.84, 10971.47, 11743.98, 10384.62, 11622.81, 12450.59, 11450.38, 11740.04, 11523.44,
      10547.67, 11976.05, 12845.85, 10272.54, 11684.89, 11197.48,
    ])!;
    expect(s.cSr).toBeCloseTo(11428.78, 2);
    expect(s.vMin).toBeCloseTo(0.899, 3);
    expect(s.vMax).toBeCloseTo(1.124, 3);
    expect(s.spread).toBeCloseTo(0.225, 3);
  });

  it("próba programu sprzed poprawek przekracza próg ostrzeżenia", () => {
    // C min / C max / C śr z tabeli programu dla Heweliusza (staging 20.08).
    // Pełnej listy 12 cen nie mamy, więc rozrzut wychodzi 0,75 zamiast drukowanego
    // 0,757 — do sprawdzenia progu wystarczy z ogromnym zapasem.
    const s = priceSpread([7156.05, 15576.83, 11118.68])!;
    expect(s.spread).toBeGreaterThan(SPREAD_WARN_THRESHOLD);
  });

  it("pusta lista to null, nie wyjątek", () => {
    expect(priceSpread([])).toBeNull();
  });

  it("jedna transakcja daje rozrzut zero", () => {
    expect(priceSpread([10000])!.spread).toBe(0);
  });

  it("ceny zerowe nie dzielą przez zero", () => {
    expect(priceSpread([0, 0])).toBeNull();
  });
});
