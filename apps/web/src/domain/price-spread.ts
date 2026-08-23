/**
 * Rozrzut cen jednostkowych w próbie — Vmax − Vmin z Tabeli 2 operatu.
 *
 * Miara jakości próby zmierzona na operatach Anety: 0,132 (Winiary) i 0,225
 * (Heweliusza). Program przed poprawkami doboru dawał 0,75+. W metodzie
 * korygowania ceny średniej Vmin/Vmax wyznaczają zakres poprawek, więc szerokie
 * pasmo pozwala im szarpać wynikiem dwukrotnie mocniej. Czysta funkcja, bez I/O.
 */
export type PriceSpread = {
  cMin: number;
  cMax: number;
  cSr: number;
  vMin: number;
  vMax: number;
  spread: number;
};

/** Powyżej tej wartości pasek kroku 3 ostrzega. Nie blokuje niczego — F-4 zostaje bramą. */
export const SPREAD_WARN_THRESHOLD = 0.4;

export function priceSpread(unitPrices: readonly number[]): PriceSpread | null {
  if (unitPrices.length === 0) return null;
  const cMin = Math.min(...unitPrices);
  const cMax = Math.max(...unitPrices);
  const cSr = unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length;
  if (cSr === 0) return null;
  const vMin = cMin / cSr;
  const vMax = cMax / cSr;
  return { cMin, cMax, cSr, vMin, vMax, spread: vMax - vMin };
}
