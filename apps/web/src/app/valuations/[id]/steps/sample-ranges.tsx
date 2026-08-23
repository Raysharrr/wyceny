"use client";

import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ManualRange = { min?: number; max?: number };
export type ManualRanges = { areaRange?: ManualRange; unitPriceRange?: ManualRange };

const num = (el: HTMLInputElement | null): number | undefined => {
  const raw = el?.value.trim() ?? "";
  if (raw === "") return undefined;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};
/** Pasmo bez żadnej granicy to dla doboru to samo co brak pasma — nie zapisujemy pustego obiektu. */
const range = (min?: number, max?: number): ManualRange | undefined =>
  min === undefined && max === undefined
    ? undefined
    : { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };

/**
 * Ręczne pasma doboru (Slice 6) — Aneta: „wykonujący musi nad tym panować
 * i dać mu zakresy". Puste pole = brak ograniczenia z tej strony; podanie
 * którejkolwiek granicy powierzchni wyłącza domyślne pasmo ±30% z ADR-015.
 *
 * Pola są NIEkontrolowane i dosynchronizowywane do snapshotu efektem poniżej:
 * snapshot pozostaje jedynym domem pasm (przeżywają zmianę promienia i zapis
 * szkicu), a przeglądarka trzyma stan wpisywania — bez drugiego,
 * rozjeżdżającego się źródła prawdy w `useState`.
 *
 * Zatwierdzenie następuje na wyjściu z pola (albo Enterem), nie na każdym
 * znaku: każde zatwierdzenie przelicza dobór, dokładnie jak zmiana promienia.
 */
export function SampleRanges({
  areaRange,
  unitPriceRange,
  busy,
  disabledReason,
  onCommit,
}: {
  areaRange?: ManualRange;
  unitPriceRange?: ManualRange;
  busy: boolean;
  disabledReason: string | null;
  onCommit(next: ManualRanges): void;
}) {
  const areaMin = useRef<HTMLInputElement>(null);
  const areaMax = useRef<HTMLInputElement>(null);
  const priceMin = useRef<HTMLInputElement>(null);
  const priceMax = useRef<HTMLInputElement>(null);

  const commit = () => {
    const next: ManualRanges = {
      areaRange: range(num(areaMin.current), num(areaMax.current)),
      unitPriceRange: range(num(priceMin.current), num(priceMax.current)),
    };
    const now: ManualRanges = { areaRange, unitPriceRange };
    if (JSON.stringify(next) !== JSON.stringify(now)) onCommit(next);
  };

  const fields = [
    { id: "range-area-min", label: "Powierzchnia od [m²]", ref: areaMin, v: areaRange?.min },
    { id: "range-area-max", label: "Powierzchnia do [m²]", ref: areaMax, v: areaRange?.max },
    { id: "range-price-min", label: "Cena od [zł/m²]", ref: priceMin, v: unitPriceRange?.min },
    { id: "range-price-max", label: "Cena do [zł/m²]", ref: priceMax, v: unitPriceRange?.max },
  ];

  // Dosynchronizowanie do snapshotu, który właśnie wrócił z przeliczenia —
  // POLE Z FOKUSEM ZOSTAJE NIETKNIĘTE. Wcześniej robił to `key` na kontenerze
  // i kasował to, co rzeczoznawca akurat wpisywał: zatwierdzasz „cenę od",
  // przechodzisz do „ceny do", a w połowie wpisywania wraca reselect,
  // przemontowuje grupę i zjada wpisane znaki (złapane na żywo 2026-08-23).
  useEffect(() => {
    const sync = (el: HTMLInputElement | null, v?: number) => {
      if (!el || el === document.activeElement) return;
      const next = v === undefined ? "" : String(v);
      if (el.value !== next) el.value = next;
    };
    sync(areaMin.current, areaRange?.min);
    sync(areaMax.current, areaRange?.max);
    sync(priceMin.current, unitPriceRange?.min);
    sync(priceMax.current, unitPriceRange?.max);
  }, [areaRange, unitPriceRange]);

  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {fields.map((f) => (
        <div key={f.id} className="flex flex-col gap-1">
          <Label htmlFor={f.id} className="text-xs text-muted-foreground">
            {f.label}
          </Label>
          <Input
            id={f.id}
            ref={f.ref}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            defaultValue={f.v ?? ""}
            // NIE blokujemy na czas przeliczania: blokada odbiera polu fokus,
            // przez co dosynchronizowanie wyżej przestaje je omijać i kasuje
            // wpisywane znaki. Blokuje wyłącznie brak zapamiętanej puli.
            disabled={!!disabledReason}
            aria-busy={busy}
            title={disabledReason ?? undefined}
            placeholder="bez ograniczenia"
            onBlur={commit}
            // Krok 3 jest jednym wielkim <form> — bez tego Enter w polu
            // liczbowym wysłałby formularz i przerzucił rzeczoznawcę do
            // kroku 4 zamiast przeliczyć dobór.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}
