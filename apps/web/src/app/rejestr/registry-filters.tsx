"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

export const PERIODS = [
  { key: "24m", label: "Ostatnie 24 miesiące" },
  { key: "12m", label: "Ostatnie 12 miesięcy" },
  { key: "all", label: "Cały rejestr" },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

const SELECT =
  "h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Filters live in the URL (`?sm=&okres=&q=`) so the RSC page re-reads the register — no client state to keep in sync. */
export function RegistryFilters({
  cooperatives,
  value,
}: {
  cooperatives: string[];
  value: { sm: string; okres: PeriodKey; q: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("strona");
    router.replace(`${pathname}?${next.toString()}`);
  };
  return (
    <form
      className="flex flex-wrap items-end gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        set("q", new FormData(e.currentTarget).get("q")?.toString().trim() ?? "");
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Spółdzielnia
        <select
          name="sm"
          className={SELECT}
          defaultValue={value.sm}
          onChange={(e) => set("sm", e.target.value)}
        >
          <option value="">Wszystkie</option>
          {cooperatives.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Okres
        <select
          name="okres"
          className={SELECT}
          defaultValue={value.okres}
          onChange={(e) => set("okres", e.target.value)}
        >
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
        Szukaj
        <Input name="q" defaultValue={value.q} placeholder="adres, nr budynku, rep. aktu…" />
      </label>
    </form>
  );
}
