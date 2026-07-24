// Polish plural: 1 → one, 2-4 (except 12-14) → few, else → many
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d10 = n % 10,
    d100 = n % 100;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}
