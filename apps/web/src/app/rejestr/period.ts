/** Server-safe (no "use client"): the RSC page reads this — a value imported from a client module is a reference there, not the array. */
export const PERIODS = [
  { key: "24m", label: "Ostatnie 24 miesiące" },
  { key: "12m", label: "Ostatnie 12 miesięcy" },
  { key: "all", label: "Cały rejestr" },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

/** "Ostatnie 24 miesiące" → ISO date 24 months back; "all" → undefined. */
export function periodFrom(okres: PeriodKey, now = new Date()): string | undefined {
  const months = okres === "24m" ? 24 : okres === "12m" ? 12 : null;
  if (months === null) return undefined;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}
