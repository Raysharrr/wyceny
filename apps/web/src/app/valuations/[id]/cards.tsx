import { computeValuation } from "@/domain/valuation-calculation";
import { comparableIdentity, valuationComparables } from "@/domain/pairwise-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Building2, Calculator, FileText, Scale, SlidersHorizontal, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { plural } from "@/components/wizard/plural";
import { SectionCard } from "@/components/wizard/section-card";
import {
  isRegistrySourced,
  REGISTRY_LABEL,
  type ComparableSource,
  type KcsInput,
} from "@/domain/kcs";
import type { KwDzialSnapshot } from "@/domain/kw-snapshot";
import { formatNumber } from "@/domain/document-model";

export const currencyFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

const plnPerM2 = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

const RATING_LABEL: Record<string, string> = {
  gorsza: "gorsza",
  przecietna: "przeciętna",
  lepsza: "lepsza",
};

// Document-source labels for the area provenance line (F-4): when the area was
// seeded from an uploaded deed/excerpt it is `to_verify` until confirmKw, so
// the confirm surface must NOT claim it as a rzeczoznawca-confirmed value.
const AREA_SOURCE_LABEL: Record<"akt" | "odpis_kw", string> = {
  akt: "akt",
  odpis_kw: "odpis KW",
};

function provenanceStatusText(status?: string): string {
  return status === "confirmed" ? "potwierdzone" : "do weryfikacji";
}

export function KcsBreakdown({ inputs }: { inputs: KcsInput }) {
  const r = computeValuation(inputs);
  if (r.method === "pp") return <PairwiseBreakdown inputs={inputs} result={r} />;
  return (
    <>
      {/* T2 — ceny jednostkowe */}
      <SectionCard icon={Scale} title="Ceny jednostkowe próby" sub="Tabela 2 operatu">
        <dl className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-xs text-muted-foreground">Cmin</dt>
            <dd className="num">{plnPerM2.format(r.cmin)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cmax</dt>
            <dd className="num">{plnPerM2.format(r.cmax)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cśr</dt>
            <dd className="num">{plnPerM2.format(r.csr)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Vmin</dt>
            <dd className="num">
              {r.vmin.toLocaleString("pl-PL", {
                minimumFractionDigits: 3,
                maximumFractionDigits: 3,
              })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Vmax</dt>
            <dd className="num">
              {r.vmax.toLocaleString("pl-PL", {
                minimumFractionDigits: 3,
                maximumFractionDigits: 3,
              })}
            </dd>
          </div>
        </dl>
      </SectionCard>
      {/* T3 — współczynniki korygujące */}
      <SectionCard icon={SlidersHorizontal} title="Współczynniki korygujące" sub="Tabela 3 operatu">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">Cecha</th>
              <th className="py-1 font-medium">Waga</th>
              <th className="py-1 font-medium">Ocena</th>
              <th className="py-1 text-right font-medium">Ui</th>
            </tr>
          </thead>
          <tbody>
            {r.ui.map((u) => (
              <tr key={u.name} className="border-t border-border">
                <td className="py-1">{u.name}</td>
                <td className="py-1 num">
                  {(u.weight * 100).toLocaleString("pl-PL", { maximumFractionDigits: 2 })}%
                </td>
                <td className="py-1">{RATING_LABEL[u.rating]}</td>
                <td className="py-1 text-right num">
                  {u.value.toLocaleString("pl-PL", {
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 4,
                  })}
                </td>
              </tr>
            ))}
            <tr className="border-t border-border font-medium">
              <td className="py-1" colSpan={3}>
                Suma współczynników (ΣUi)
              </td>
              <td className="py-1 text-right num">
                {r.sumUi.toLocaleString("pl-PL", {
                  minimumFractionDigits: 3,
                  maximumFractionDigits: 3,
                })}
              </td>
            </tr>
          </tbody>
        </table>
      </SectionCard>
      {/* T4 — wartość rynkowa */}
      <SectionCard icon={Calculator} title="Wartość rynkowa" sub="Tabela 4 operatu">
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground">
            WR = Cśr × ΣUi × P = {plnPerM2.format(r.unitValue)}/m² ×{" "}
            {inputs.area.toLocaleString("pl-PL")} m²
          </p>
          <p className="font-medium text-foreground">
            <span className="num">{plnPerM2.format(r.wrUnrounded)}</span> → po zaokrągleniu{" "}
            <span className="num text-primary">{plnPerM2.format(r.wr)}</span>
          </p>
        </div>
      </SectionCard>
    </>
  );
}

function ProvenanceBadge({ source, status }: { source?: ComparableSource; status?: string }) {
  const row = { source };
  if (isRegistrySourced(row)) {
    const name = REGISTRY_LABEL[row.source];
    if (status === "to_verify") {
      return (
        <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-500">
          {name} — do weryfikacji
        </Badge>
      );
    }
    if (status === "confirmed") {
      return <Badge variant="secondary">{name} — potwierdzone</Badge>;
    }
    // Legacy rows: register source but no status — never claim verification that never happened.
    return <Badge variant="outline">{name}</Badge>;
  }
  if (status) {
    return <Badge variant="secondary">Rzeczoznawca</Badge>;
  }
  return null; // legacy snapshot without provenance — render as before
}

function GroupProvenanceBadge({ label, status }: { label: string; status?: string }) {
  if (status === "to_verify") {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-500">
        {label} — do weryfikacji
      </Badge>
    );
  }
  if (status === "confirmed") {
    return <Badge variant="secondary">{label} — potwierdzone</Badge>;
  }
  return null;
}

/**
 * Auto-fetched EGiB/MPZP subject snapshot (Task 6) — rendered only when a
 * subject snapshot exists (manual-only submissions never fetched one).
 */
export function SubjectCard({ inputs }: { inputs: KcsInput }) {
  const subject = inputs.subject;
  if (!subject) return null;
  const provenance = inputs.provenance;

  const kondygnacje =
    subject.kondygnacjeNadziemne != null || subject.kondygnacjePodziemne != null
      ? `${subject.kondygnacjeNadziemne ?? "—"} / ${subject.kondygnacjePodziemne ?? "—"}`
      : "—";

  return (
    <SectionCard
      icon={Building2}
      title="Dane przedmiotu"
      right={
        <div className="flex flex-wrap gap-2">
          <GroupProvenanceBadge label="EGiB" status={provenance?.ewidencja?.status} />
          <GroupProvenanceBadge label="MPZP" status={provenance?.mpzp?.status} />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Obręb</dt>
            <dd>{subject.obreb ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Arkusz</dt>
            <dd>{subject.arkusz ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Nr działki</dt>
            <dd>{subject.nrDzialki ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Pow. ewidencyjna [ha]</dt>
            <dd>{subject.powEwidHa ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Użytek</dt>
            <dd>{subject.uzytek ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Rodzaj budynku</dt>
            <dd>{subject.budynekRodzaj ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Kondygnacje (nad/podziemne)</dt>
            <dd>{kondygnacje}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Rok budowy</dt>
            <dd>{subject.rokBudowy ?? "b.d."}</dd>
          </div>
        </dl>
        {subject.mpzpAbsent ? (
          <div className="flex flex-col gap-0.5 text-sm">
            <p className="font-medium text-foreground">Brak obowiązującego MPZP</p>
            {subject.przeznaczenieStudium ? (
              <p className="text-muted-foreground">
                Przeznaczenie wg studium/WZ: {subject.przeznaczenieStudium}
              </p>
            ) : null}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Symbol MPZP</dt>
              <dd>{subject.mpzpSymbol ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Nazwa MPZP</dt>
              <dd>{subject.mpzpNazwa ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Uchwała</dt>
              <dd>{subject.mpzpUchwala ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Data uchwały</dt>
              <dd>{subject.mpzpData ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Publikator</dt>
              <dd>{subject.mpzpPubl ?? "—"}</dd>
            </div>
          </dl>
        )}
      </div>
    </SectionCard>
  );
}

function KwDzialField({ label, dzial }: { label: string; dzial: KwDzialSnapshot | null }) {
  const tresc = dzial?.tresc ?? [];
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      {tresc.length > 0 ? (
        <ul className="list-disc pl-5 text-sm">
          {tresc.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">brak wpisów</p>
      )}
    </div>
  );
}

/**
 * Auto-extracted KW snapshot (Slice 6, Task 8) — rendered only when a KW
 * extract exists (manual `kwNumber`-only submissions never attached one).
 * Mirrors `SubjectCard`'s structure.
 */
export function KwCard({ inputs }: { inputs: KcsInput }) {
  const kw = inputs.kw;
  if (!kw) return null;
  const provenance = inputs.provenance;

  return (
    <SectionCard
      icon={FileText}
      title="Stan prawny (KW)"
      right={<GroupProvenanceBadge label="Stan prawny (KW)" status={provenance?.kw?.status} />}
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Nr KW lokalu</dt>
            <dd>
              {kw.deweloperski ? "lokal bez własnej KW — księga macierzysta" : (kw.kwLokalu ?? "—")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Nr KW gruntu (księga macierzysta)</dt>
            <dd>{kw.kwGruntu ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Udział w nieruchomości wspólnej</dt>
            <dd>{kw.udzial ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Pow. użytkowa (wg dokumentu)</dt>
            <dd>{kw.powUzytkowaKw != null ? `${formatNumber(kw.powUzytkowaKw, 2)} m²` : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Sąd / wydział</dt>
            <dd>
              {kw.sad ?? "—"} / {kw.wydzial ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Data dokumentu</dt>
            <dd>{kw.dataDokumentu ?? "—"}</dd>
          </div>
        </dl>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KwDzialField label="Dział III — prawa, roszczenia i ograniczenia" dzial={kw.dzial3} />
          <KwDzialField label="Dział IV — hipoteki" dzial={kw.dzial4} />
        </div>
      </div>
    </SectionCard>
  );
}

const LEVEL_LABEL: Record<"lepsza" | "przecietna" | "gorsza", string> = {
  lepsza: "lepsza",
  przecietna: "przeciętna",
  gorsza: "gorsza",
};

/** Feature bag + rating-scale definitions (Slice 7). Mirrors SubjectCard's structure. */
export function FeaturesCard({ inputs }: { inputs: KcsInput }) {
  const features = inputs.features ?? [];
  if (features.length === 0) return null;
  const provenance = inputs.provenance;
  const rows = features
    .map((f) => ({
      name: f.name,
      defs: (["lepsza", "przecietna", "gorsza"] as const)
        .filter((level) => f.definitions?.[level]?.trim())
        .map((level) => `${LEVEL_LABEL[level]} – ${f.definitions![level]!.trim()}`),
    }))
    .filter((r) => r.defs.length > 0);
  return (
    <SectionCard
      icon={SlidersHorizontal}
      title="Cechy i wagi"
      right={
        <div className="flex flex-wrap gap-2">
          <GroupProvenanceBadge label="Wagi cech" status={provenance?.weights?.status} />
          {provenance?.featureDefs ? (
            <GroupProvenanceBadge
              label="Definicje skali ocen"
              status={provenance.featureDefs.status}
            />
          ) : null}
        </div>
      }
    >
      {rows.length > 0 ? (
        <dl className="flex flex-col gap-2 text-sm">
          {rows.map((r) => (
            <div key={r.name}>
              <dt className="text-xs text-muted-foreground">{r.name}</dt>
              {r.defs.map((d) => (
                <dd key={d}>{d}</dd>
              ))}
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">Brak definicji skali ocen.</p>
      )}
    </SectionCard>
  );
}

export function ComparablesProvenance({ inputs }: { inputs: KcsInput }) {
  // Area is doc-sourced (and thus to_verify until confirmKw) only when its
  // provenance source is a document type — render it separately with its real
  // source + status instead of folding it into the blanket "rzeczoznawca
  // (potwierdzone)" claim, which would be false while it is still to_verify.
  const area = inputs.provenance?.area;
  const areaProvenanceText =
    area && (area.source === "akt" || area.source === "odpis_kw")
      ? `powierzchnia: ${AREA_SOURCE_LABEL[area.source]} — ${provenanceStatusText(area.status)}`
      : null;
  const comparables = valuationComparables(inputs);
  const count = comparables.length;
  return (
    <SectionCard
      icon={Table2}
      title="Wybrane transakcje"
      sub={`Tabela 1 operatu · ${count} ${plural(count, "transakcja", "transakcje", "transakcji")}`}
    >
      <div className="flex flex-col gap-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-normal">#</th>
              <th className="py-1 font-normal">Cena zł/m²</th>
              <th className="py-1 font-normal">Pochodzenie</th>
            </tr>
          </thead>
          <tbody>
            {comparables.map((c, i) => (
              <tr key={comparableIdentity(c) ?? i} className="border-t border-border">
                <td className="py-1">{i + 1}</td>
                <td className="py-1 num">{plnPerM2.format(c.pricePerM2)}</td>
                <td className="py-1">
                  <ProvenanceBadge source={c.source} status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {inputs.provenance ? (
          <p className="text-xs text-muted-foreground">
            {areaProvenanceText
              ? `Adres: rzeczoznawca (potwierdzone) · ${areaProvenanceText}`
              : "Adres, powierzchnia: rzeczoznawca (potwierdzone)"}
            {` · wagi: ${
              inputs.provenance.weights.source === "preset"
                ? `preset — ${provenanceStatusText(inputs.provenance.weights.status)}`
                : "rzeczoznawca (potwierdzone)"
            }`}
            {" · oceny: rzeczoznawca (potwierdzone)"}
            {inputs.provenance.geocode
              ? ` · geokodowanie: ${provenanceStatusText(inputs.provenance.geocode.status)}`
              : ""}
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}

function PairwiseBreakdown({
  inputs,
  result: r,
}: {
  inputs: KcsInput;
  result: Extract<ReturnType<typeof computeValuation>, { method: "pp" }>;
}) {
  return (
    <>
      <SectionCard icon={Scale} title="Poprawki porównawcze (PP)" sub="Ceny i poprawki w zł/m²">
        <p className="mb-3 text-sm">
          Cmin {plnPerM2.format(r.cmin)} · Cmax {plnPerM2.format(r.cmax)} · ΔC{" "}
          {plnPerM2.format(r.priceSpread)}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cecha</TableHead>
              <TableHead>Waga</TableHead>
              <TableHead>Zakres</TableHead>
              {r.pairs.map((p, i) => (
                <TableHead key={p.comparableId}>
                  Porównanie {i + 1}
                  <br />
                  mnożnik → poprawka
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.pairs[0]?.corrections.map((correction) => (
              <TableRow key={correction.featureKey}>
                <TableCell>
                  {inputs.features.find((f) => f.key === correction.featureKey)?.name}
                </TableCell>
                <TableCell>
                  {(correction.weight * 100).toLocaleString("pl-PL", { maximumFractionDigits: 2 })}%
                </TableCell>
                <TableCell>{plnPerM2.format(correction.range)}</TableCell>
                {r.pairs.map((p) => {
                  const cell = p.corrections.find((c) => c.featureKey === correction.featureKey)!;
                  return (
                    <TableCell key={p.comparableId}>
                      {cell.multiplier.toLocaleString("pl-PL")} → {plnPerM2.format(cell.amount)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={3}>Suma poprawek</TableCell>
              {r.pairs.map((p) => (
                <TableCell key={p.comparableId}>{plnPerM2.format(p.totalCorrection)}</TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell colSpan={3}>Cena przed korektą</TableCell>
              {r.pairs.map((p) => (
                <TableCell key={p.comparableId}>{plnPerM2.format(p.pricePerM2)}</TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell colSpan={3}>Cena po korekcie</TableCell>
              {r.pairs.map((p) => (
                <TableCell key={p.comparableId}>{plnPerM2.format(p.correctedPrice)}</TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </SectionCard>
      <SectionCard icon={Calculator} title="Wartość rynkowa (PP)">
        <p className="text-sm">
          Średnia cen po korektach {plnPerM2.format(r.unitValue)}/m² ×{" "}
          {inputs.area.toLocaleString("pl-PL")} m²
        </p>
        <p className="num">
          {plnPerM2.format(r.wrUnrounded)} → po zaokrągleniu <b>{plnPerM2.format(r.wr)}</b>
        </p>
      </SectionCard>
    </>
  );
}
