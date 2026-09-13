import type { FeatureRating } from "./valuation-input";
const NBSP = "\u00a0";
/** Shared labels for document and prose facts. */
export const LEVEL_LABEL: Record<FeatureRating, string> = {
  lepsza: "lepsza",
  przecietna: "przeciętna",
  gorsza: "gorsza",
};
/** Polish monetary display with non-breaking thousands separators. */
export function formatPln(value: number): string {
  return formatNumber(value, 2);
}

export function formatNumber(value: number, dp: number): string {
  const [int, frac] = value.toFixed(dp).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return frac ? `${grouped},${frac}` : grouped;
}

/** Percent display: retain fractions up to two decimal places. */
export function formatPercent(weight: number): string {
  return formatNumber(weight * 100, 2)
    .replace(/,00$/, "")
    .replace(/(,\d)0$/, "$1");
}

/** Professional-secrecy masking: valid transaction dates expose month only. */
export function transactionMonth(date: string | undefined): string {
  return date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "—";
}
