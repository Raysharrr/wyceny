"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/wizard/section-card";
import { selectMethodAction } from "@/app/actions/select-method";
import type { ValuationMethod } from "@/domain/valuation-input";

export type MethodSelectionProps = {
  valuationId: string;
  method?: ValuationMethod;
  methodConfirmed?: boolean;
  comparableCount: number;
};

export function MethodSelection({
  valuationId,
  method,
  methodConfirmed,
  comparableCount,
}: MethodSelectionProps) {
  const [choice, setChoice] = useState<ValuationMethod | "">(method ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const confirmed = methodConfirmed && choice === method;
  return (
    <SectionCard title="Metoda wyceny">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          KCS wymaga co najmniej 12 transakcji. Porównywanie parami wymaga wyboru 3–5 transakcji
          oraz potwierdzenia ocen i poprawek.
          {comparableCount >= 12
            ? " Zapisana próba pozwala wybrać KCS."
            : " Przy mniejszej próbie uzupełnij dane KCS lub wybierz porównywanie parami."}
        </p>
        <label className="text-sm font-medium" htmlFor="valuation-method">
          Wybierz metodę wyceny
        </label>
        <select
          id="valuation-method"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={choice}
          disabled={pending}
          onChange={(event) => setChoice(event.target.value as ValuationMethod | "")}
        >
          <option value="">Wybierz metodę…</option>
          <option value="kcs">Korygowanie ceny średniej (KCS)</option>
          <option value="pp">Porównywanie parami (PP)</option>
        </select>
        <p role="status" className="text-sm">
          {confirmed
            ? `Potwierdzona metoda: ${method === "kcs" ? "KCS" : "PP"}.`
            : "Metoda wymaga potwierdzenia."}
        </p>
        {choice && method && choice !== method ? (
          <p className="text-sm text-muted-foreground">
            Zmiana metody unieważni wynik i potwierdzenie poprawek.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button
          className="self-start"
          disabled={!choice || pending || Boolean(confirmed)}
          onClick={() =>
            startTransition(async () => {
              if (!choice) return;
              setError(null);
              const result = await selectMethodAction(valuationId, {
                method: choice,
                confirm: true,
              });
              if ("error" in result) setError(result.error);
              else router.refresh();
            })
          }
        >
          {pending ? "Zapisywanie metody…" : "Potwierdź metodę"}
        </Button>
      </div>
    </SectionCard>
  );
}
