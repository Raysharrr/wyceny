/** Polish number formatting for the register screens (S2b): "37,91", "299 999,82". */
const PL = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtNum = (n: number): string => PL.format(n);
/** "2026-05-14T…" → "14.05.2026" (the "Ostatni import" tile). */
export const fmtDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};

/** Polish plural: plural(5, "wiersz", "wiersze", "wierszy") → "wierszy". */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (n === 1) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** `SM „Osiedle Młodych”` — the register stores the name as typed ("SM Osiedle Młodych"), so a leading "SM" is not doubled. Shared by step 3 of the wizard and step 3 of the valuation (S5, Task 4f — E2E S2b O-4). */
export function cooperativeLabel(name: string): string {
  return `SM „${name.replace(/^SM\s+/i, "").trim()}”`;
}
