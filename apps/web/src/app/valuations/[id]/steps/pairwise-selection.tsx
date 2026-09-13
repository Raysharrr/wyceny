"use client";
import { SectionCard } from "@/components/wizard/section-card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { comparableIdentity } from "@/domain/pairwise-state";
import type { Comparable } from "@/domain/valuation-input";
export function PairwiseSelection({
  rows,
  selectedIds,
  onChange,
}: {
  rows: Comparable[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const missing = selectedIds.filter((id) => !rows.some((r) => comparableIdentity(r) === id));
  return (
    <SectionCard title="Wybierz porównania (PP)" sub={`Wybrano ${selectedIds.length} z 3–5`}>
      <p className="mb-3 text-sm text-muted-foreground">
        Zaznacz 3–5 lokali z puli. Ranking i przegląd propozycji powyżej pomagają w wyborze; nie
        zatwierdzają porównań. Zmiana promienia lub ponowne pobranie rozszerza pulę i zachowuje Twój
        wybór oraz edytowane wartości. Usuń niepotrzebne wiersze świadomie.
      </p>
      {missing.length ? (
        <p role="alert">
          Usunięto wybraną transakcję.{" "}
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(selectedIds.filter((id) => !missing.includes(id)))}
          >
            Usuń brakujące porównania z wyboru
          </Button>
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Wybór</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Powierzchnia</TableHead>
            <TableHead>Cena zł/m²</TableHead>
            <TableHead>Kolejność</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => {
            const id = comparableIdentity(row);
            const position = id ? selectedIds.indexOf(id) : -1;
            const rowLabel = `Transakcja ${i + 1} w puli: ${row.date || "brak daty"}, ${Number.isFinite(row.pricePerM2) && row.pricePerM2 > 0 ? row.pricePerM2.toLocaleString("pl-PL") + " zł/m²" : "brak ceny"}`;
            return (
              <TableRow key={id ?? `missing-${i}`}>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={rowLabel}
                    checked={position >= 0}
                    disabled={!id || (position < 0 && selectedIds.length >= 5)}
                    onChange={(e) =>
                      id &&
                      onChange(
                        e.target.checked
                          ? [...selectedIds, id]
                          : selectedIds.filter((v) => v !== id),
                      )
                    }
                  />
                </TableCell>
                <TableCell>{row.date || "—"}</TableCell>
                <TableCell>
                  {row.area == null ? "—" : `${row.area.toLocaleString("pl-PL")} m²`}
                </TableCell>
                <TableCell>
                  {Number.isFinite(row.pricePerM2) ? row.pricePerM2.toLocaleString("pl-PL") : "—"}
                </TableCell>
                <TableCell>
                  {position >= 0 ? (
                    <>
                      {position + 1}{" "}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Przesuń wcześniej — ${rowLabel}`}
                        disabled={position === 0}
                        onClick={() => {
                          const ids = [...selectedIds];
                          [ids[position - 1], ids[position]] = [ids[position], ids[position - 1]];
                          onChange(ids);
                        }}
                      >
                        Wcześniej
                      </Button>
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </SectionCard>
  );
}
