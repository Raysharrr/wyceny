import type { PeriodKey } from "./registry-filters";

/** "Ostatnie 24 miesiące" → ISO date 24 months back; "all" → undefined. */
export function periodFrom(okres: PeriodKey, now = new Date()): string | undefined {
  const months = okres === "24m" ? 24 : okres === "12m" ? 12 : null;
  if (months === null) return undefined;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}
