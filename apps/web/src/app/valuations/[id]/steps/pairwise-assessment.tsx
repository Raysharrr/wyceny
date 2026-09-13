"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/wizard/section-card";
import { comparableIdentity } from "@/domain/pairwise-state";
import { suggestPairwiseMultiplier } from "@/domain/pairwise";
import { matchesPresetDefinitions, medianAreaM2 } from "@/domain/feature-presets";
import type {
  Comparable,
  Feature,
  FeatureRating,
  PairwiseCell,
  PairwiseSnapshot,
} from "@/domain/valuation-input";

type EditableFeature = Omit<Feature, "rating"> & { rating: FeatureRating | "" };
const labels = { lepsza: "lepsza", przecietna: "przeciętna", gorsza: "gorsza" };

export function PairwiseAssessment({
  comparables,
  features,
  comparisons,
  onChange,
}: {
  comparables: Comparable[];
  features: EditableFeature[];
  comparisons: PairwiseSnapshot["comparisons"];
  onChange: (cells: PairwiseSnapshot["comparisons"]) => void;
}) {
  const median = medianAreaM2(comparables.map((c) => c.area));
  const update = (id: string, key: string, cell: PairwiseCell) =>
    onChange({ ...comparisons, [id]: { ...comparisons[id], [key]: cell } });
  return (
    <SectionCard className="min-w-0 max-w-full" title="Oceny i poprawki porównawcze (PP)">
      <p className="mb-3 text-sm text-muted-foreground">
        Oceń każdy wybrany lokal. Sugestia mnożnika wynika z różnicy ocen i skali. Możesz wpisać
        własną wartość, także ułamkową lub poza ±1, z uzasadnieniem odstępstwa. Na końcu potwierdź
        całą macierz.
      </p>
      {!comparables.length ? (
        <p role="alert">W kroku Próba wybierz 3–5 transakcji.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cecha przedmiotu</TableHead>
              {comparables.map((c, i) => (
                <TableHead key={comparableIdentity(c)!}>
                  Porównanie {i + 1}
                  <br />
                  {c.date ?? "Brak daty"} · {c.area ?? "—"} m²
                  <br />
                  {c.pricePerM2.toLocaleString("pl-PL")} zł/m²
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {features
              .filter((f) => f.weight > 0 && f.key)
              .map((f) => (
                <TableRow key={f.key}>
                  <TableCell className="whitespace-normal">
                    {f.name}
                    <br />
                    {f.rating ? labels[f.rating] : "Wybierz ocenę przedmiotu"} ·{" "}
                    {f.ratingScale === "two" ? "2" : "3"} poziomy
                  </TableCell>
                  {comparables.map((c, i) => {
                    const id = comparableIdentity(c)!;
                    const key = f.key!;
                    const cell = comparisons[id]?.[key] ?? { rating: null, multiplier: null };
                    const levels = (["gorsza", "przecietna", "lepsza"] as const).filter(
                      (r) => f.ratingScale !== "two" || r !== "przecietna",
                    );
                    const suggestion =
                      f.rating && cell.rating && levels.includes(cell.rating)
                        ? suggestPairwiseMultiplier(f.rating, cell.rating, f.ratingScale ?? "three")
                        : null;
                    const areaSuggestion =
                      f.key === "powierzchnia-uzytkowa" &&
                      median !== null &&
                      c.area != null &&
                      matchesPresetDefinitions([{ key, definitions: f.definitions }], median)
                        ? c.area < median
                          ? "lepsza"
                          : "gorsza"
                        : null;
                    const label = `${f.name} — porównanie ${i + 1}`;
                    const rate = (rating: FeatureRating | null) =>
                      update(id, key, {
                        ...cell,
                        rating,
                        multiplier:
                          rating && f.rating
                            ? suggestPairwiseMultiplier(f.rating, rating, f.ratingScale ?? "three")
                            : null,
                        overrideReason: undefined,
                      });
                    return (
                      <TableCell key={id} className="min-w-60 whitespace-normal align-top">
                        <label className="block text-xs">
                          Ocena
                          <select
                            aria-label={`Ocena: ${label}`}
                            className="my-1 block w-full rounded-md border border-input bg-background p-2 text-sm"
                            value={cell.rating ?? ""}
                            onChange={(e) =>
                              rate(e.target.value ? (e.target.value as FeatureRating) : null)
                            }
                          >
                            <option value="">Wybierz ocenę…</option>
                            {levels.map((r) => (
                              <option key={r} value={r}>
                                {labels[r]}
                              </option>
                            ))}
                          </select>
                        </label>
                        {areaSuggestion && !cell.rating ? (
                          <div className="text-xs text-muted-foreground">
                            Sugestia: {labels[areaSuggestion]} — powierzchnia {c.area} m², próg{" "}
                            {median} m² z wybranych porównań.
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => rate(areaSuggestion)}
                            >
                              Przyjmij sugerowaną ocenę
                            </Button>
                          </div>
                        ) : null}
                        <p className="my-2 text-xs text-muted-foreground">
                          Sugestia mnożnika:{" "}
                          {suggestion === null
                            ? "uzupełnij oceny"
                            : suggestion.toLocaleString("pl-PL")}{" "}
                          (różnica rang / {f.ratingScale === "two" ? "1" : "2"})
                        </p>
                        <label className="block text-xs">
                          Przyjęty mnożnik
                          <Input
                            aria-label={`Mnożnik: ${label}`}
                            type="number"
                            step="any"
                            value={cell.multiplier ?? ""}
                            onChange={(e) =>
                              update(id, key, {
                                ...cell,
                                multiplier: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        {suggestion !== null && cell.multiplier !== suggestion ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              update(id, key, {
                                ...cell,
                                multiplier: suggestion,
                                overrideReason: undefined,
                              })
                            }
                          >
                            Przyjmij sugestię mnożnika
                          </Button>
                        ) : null}
                        {(suggestion !== null &&
                          cell.multiplier !== null &&
                          cell.multiplier !== suggestion) ||
                        cell.overrideReason ? (
                          <label className="mt-2 block text-xs">
                            Uzasadnienie odstępstwa
                            <Input
                              aria-label={`Uzasadnienie: ${label}`}
                              maxLength={1000}
                              value={cell.overrideReason ?? ""}
                              onChange={(e) =>
                                update(id, key, { ...cell, overrideReason: e.target.value })
                              }
                            />
                          </label>
                        ) : null}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
