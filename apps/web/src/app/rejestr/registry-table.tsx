import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtNum } from "@/lib/coop-format";
import type { CoopTransaction } from "@/ports/coop-registry";

/** Column "Prawo": never blank and never guessed — `null` reads "nieznane" (HANDOFF Task 2). */
export const RIGHT_BADGE = {
  spoldzielcze_wlasnosciowe: "spółdzielcze wł.",
  wlasnosc_lokalu: "własność",
} as const;

export function RegistryTable({ rows }: { rows: CoopTransaction[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Spółdzielnia</TableHead>
          <TableHead>Adres</TableHead>
          <TableHead>Nr bud./m.</TableHead>
          <TableHead className="text-right">Pow.</TableHead>
          <TableHead className="text-right">Cena</TableHead>
          <TableHead className="text-right">zł/m²</TableHead>
          <TableHead>Data</TableHead>
          <TableHead>Prawo</TableHead>
          <TableHead>Źródło</TableHead>
          <TableHead>Lokalizacja</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
              Brak transakcji spełniających filtry.
            </TableCell>
          </TableRow>
        ) : null}
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{r.cooperative}</TableCell>
            <TableCell>{r.address}</TableCell>
            <TableCell className="font-mono">
              {r.buildingNumber}
              {r.flatNumber ? ` / ${r.flatNumber}` : ""}
            </TableCell>
            <TableCell className="text-right font-mono">{fmtNum(r.area)}</TableCell>
            <TableCell className="text-right font-mono">{fmtNum(r.priceTotal)}</TableCell>
            <TableCell className="text-right font-mono">{fmtNum(r.pricePerM2)}</TableCell>
            <TableCell className="font-mono">{r.date}</TableCell>
            <TableCell>
              {r.rightType ? (
                <Badge variant="secondary">{RIGHT_BADGE[r.rightType]}</Badge>
              ) : (
                <Badge variant="outline">nieznane</Badge>
              )}
            </TableCell>
            <TableCell>
              {r.source === "xls" ? (
                <Badge variant="secondary">xls</Badge>
              ) : (
                <Badge variant="outline">ręcznie</Badge>
              )}
            </TableCell>
            <TableCell>
              {r.pos ? (
                <span className="text-[var(--accent-700)]">✓ ustalona</span>
              ) : (
                <Badge variant="outline" className="border-[#ecd9a6] text-[#b07a16]">
                  do poprawki
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
