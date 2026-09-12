/** Polish number formatting for the register screens (S2b): "37,91", "299 999,82". */
const PL = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtNum = (n: number): string => PL.format(n);
/** "2026-05-14T…" → "14.05.2026" (the "Ostatni import" tile). */
export const fmtDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};
