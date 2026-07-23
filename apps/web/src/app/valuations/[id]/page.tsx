import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSession } from "@/auth/session";
import { computeKcs, type KcsInput } from "@/domain/kcs";
import type { KwDzialSnapshot } from "@/domain/kw-snapshot";
import { approvalGate } from "@/domain/provenance";
import { documentFieldBlockers, formatNumber } from "@/domain/document-model";
import { valuationRepository } from "../_deps";
import { InspectionSection } from "./inspection-section";
import { ValuationActions } from "./valuation-actions";

// The approve Server Action invoked from this page generates the operat
// (DOCX render + LibreOffice PDF conversion in the worker), which can exceed
// the default serverless function timeout. Page-level route config covers the
// Server Actions defined for / invoked from this route (Next 16.2.9).
export const maxDuration = 60;

const STATUS_LABEL: Record<string, string> = {
  in_progress: "Szkic",
  approved: "Zatwierdzony",
  signed: "Podpisany",
};

const currencyFormatter = new Intl.NumberFormat("pl-PL", {
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

// RFC 4122-shaped (any version/variant) — the `id` route param is
// user-controlled and Postgres' `uuid` column rejects anything else with a
// raw "invalid input syntax for type uuid" error. Validate before it ever
// reaches the repo query, so a malformed id renders the same friendly
// not-found state as a well-formed-but-unknown/inaccessible one.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-xl font-semibold text-foreground">Nie znaleziono wyceny</h1>
      <p className="text-sm text-muted-foreground">
        Wycena nie istnieje albo nie masz do niej dostępu.
      </p>
      <Button asChild variant="outline">
        <Link href="/valuations">Wróć do listy wycen</Link>
      </Button>
    </div>
  );
}

function KcsBreakdown({ inputs }: { inputs: KcsInput }) {
  const r = computeKcs(inputs);
  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        {/* T2 — ceny jednostkowe */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Ceny jednostkowe próby (T2)</h2>
          <dl className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-xs text-muted-foreground">Cmin</dt>
              <dd>{plnPerM2.format(r.cmin)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cmax</dt>
              <dd>{plnPerM2.format(r.cmax)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cśr</dt>
              <dd>{plnPerM2.format(r.csr)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Vmin</dt>
              <dd>{r.vmin.toFixed(3)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Vmax</dt>
              <dd>{r.vmax.toFixed(3)}</dd>
            </div>
          </dl>
        </section>
        {/* T3 — współczynniki korygujące */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Współczynniki korygujące (T3)</h2>
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
                  <td className="py-1">{Math.round(u.weight * 100)}%</td>
                  <td className="py-1">{RATING_LABEL[u.rating]}</td>
                  <td className="py-1 text-right tabular-nums">{u.value.toFixed(4)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-medium">
                <td className="py-1" colSpan={3}>
                  Suma współczynników (ΣUi)
                </td>
                <td className="py-1 text-right tabular-nums">{r.sumUi.toFixed(3)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        {/* T4 — wartość rynkowa */}
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="text-sm font-semibold text-foreground">Wartość rynkowa (T4)</h2>
          <p className="text-muted-foreground">
            WR = Cśr × ΣUi × P = {plnPerM2.format(r.unitValue)}/m² × {inputs.area} m²
          </p>
          <p className="font-medium text-foreground">
            {plnPerM2.format(r.wrUnrounded)} → po zaokrągleniu{" "}
            <span className="text-primary">{plnPerM2.format(r.wr)}</span>
          </p>
        </section>
      </CardContent>
    </Card>
  );
}

function ProvenanceBadge({ source, status }: { source?: string; status?: string }) {
  if (source === "rcn" && status === "to_verify") {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-500">
        RCN — do weryfikacji
      </Badge>
    );
  }
  if (source === "rcn" && status === "confirmed") {
    return <Badge variant="secondary">RCN — potwierdzone</Badge>;
  }
  if (source === "rcn") {
    // Legacy rows: source=rcn but no status — never claim verification that never happened.
    return <Badge variant="outline">RCN</Badge>;
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
function SubjectCard({ inputs }: { inputs: KcsInput }) {
  const subject = inputs.subject;
  if (!subject) return null;
  const provenance = inputs.provenance;

  const kondygnacje =
    subject.kondygnacjeNadziemne != null || subject.kondygnacjePodziemne != null
      ? `${subject.kondygnacjeNadziemne ?? "—"} / ${subject.kondygnacjePodziemne ?? "—"}`
      : "—";

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Dane przedmiotu</h2>
          <div className="flex flex-wrap gap-2">
            <GroupProvenanceBadge label="EGiB" status={provenance?.ewidencja?.status} />
            <GroupProvenanceBadge label="MPZP" status={provenance?.mpzp?.status} />
          </div>
        </div>
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
      </CardContent>
    </Card>
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
function KwCard({ inputs }: { inputs: KcsInput }) {
  const kw = inputs.kw;
  if (!kw) return null;
  const provenance = inputs.provenance;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Stan prawny (KW)</h2>
          <GroupProvenanceBadge label="Stan prawny (KW)" status={provenance?.kw?.status} />
        </div>
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
      </CardContent>
    </Card>
  );
}

const LEVEL_LABEL: Record<"lepsza" | "przecietna" | "gorsza", string> = {
  lepsza: "lepsza",
  przecietna: "przeciętna",
  gorsza: "gorsza",
};

/** Feature bag + rating-scale definitions (Slice 7). Mirrors SubjectCard's structure. */
function FeaturesCard({ inputs }: { inputs: KcsInput }) {
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
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Cechy i wagi</h2>
          <div className="flex flex-wrap gap-2">
            <GroupProvenanceBadge label="Wagi cech" status={provenance?.weights?.status} />
            {provenance?.featureDefs ? (
              <GroupProvenanceBadge
                label="Definicje skali ocen"
                status={provenance.featureDefs.status}
              />
            ) : null}
          </div>
        </div>
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
      </CardContent>
    </Card>
  );
}

function ComparablesProvenance({ inputs }: { inputs: KcsInput }) {
  // Area is doc-sourced (and thus to_verify until confirmKw) only when its
  // provenance source is a document type — render it separately with its real
  // source + status instead of folding it into the blanket "rzeczoznawca
  // (potwierdzone)" claim, which would be false while it is still to_verify.
  const area = inputs.provenance?.area;
  const areaProvenanceText =
    area && (area.source === "akt" || area.source === "odpis_kw")
      ? `powierzchnia: ${AREA_SOURCE_LABEL[area.source]} — ${provenanceStatusText(area.status)}`
      : null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <h2 className="text-sm font-medium text-foreground">
          Próba ({inputs.comparables.length} transakcji)
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-normal">#</th>
              <th className="py-1 font-normal">Cena zł/m²</th>
              <th className="py-1 font-normal">Pochodzenie</th>
            </tr>
          </thead>
          <tbody>
            {inputs.comparables.map((c, i) => (
              <tr key={c.transactionId ?? i} className="border-t border-border">
                <td className="py-1">{i + 1}</td>
                <td className="py-1 tabular-nums">{plnPerM2.format(c.pricePerM2)}</td>
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
      </CardContent>
    </Card>
  );
}

/**
 * View page (Task 9) — RSC. `PortValuation.get` enforces ownership isolation
 * (T7): a non-owner appraiser gets `null` back, not the row — shown here as
 * a Polish "not found / no access" state rather than surfacing which case it
 * was (avoids leaking existence of other users' valuations).
 */
export default async function ValuationViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  if (!UUID_RE.test(id)) {
    return <NotFound />;
  }

  const valuation = await valuationRepository.get(id, session.user);

  if (!valuation) {
    return <NotFound />;
  }

  const isDraft = valuation.status === "in_progress";
  // `get` already enforces F-8 ownership isolation (appraiser → own rows
  // only; admin → any), so isOwner is always true for an appraiser here —
  // it only ever excludes an admin viewing another appraiser's valuation,
  // which is the case this gates the owner-only action bar for.
  const isOwner = valuation.ownerId === session.user.id;
  const canSign =
    valuation.status === "approved" && Boolean(valuation.inputs) && Boolean(valuation.docxUrl);
  // Successor lookup (Task 9): no dedicated port method (YAGNI) — a signed
  // valuation is superseded by at most one draft, found by scanning the
  // owner's own list for a row that points back at this one.
  const successor =
    valuation.status === "signed"
      ? (await valuationRepository.listForUser(session.user)).find(
          (v) => v.supersedesId === valuation.id,
        )
      : undefined;
  // A superseded signed valuation already has its replacement (banner below)
  // — offering the button here would let the owner spawn a second, duplicate
  // draft.
  const canCreateNewVersion = valuation.status === "signed" && isOwner && !successor;
  const gate = isDraft && valuation.inputs ? approvalGate(valuation.inputs) : null;
  const fieldBlockers = isDraft ? documentFieldBlockers(valuation) : [];
  // Approval requires BOTH the F-4 provenance gate and the document-field
  // check (spec §4) — the button is enabled only when neither has a blocker.
  const allBlockers = [...(gate && !gate.ok ? gate.blockers : []), ...fieldBlockers];
  const gateOk = gate?.ok === true && fieldBlockers.length === 0;
  const hasToVerify =
    isDraft && valuation.inputs
      ? valuation.inputs.comparables.some((c) => c.status === "to_verify") ||
        valuation.inputs.provenance?.geocode?.status === "to_verify"
      : false;
  const hasSubjectToVerify =
    isDraft && valuation.inputs
      ? valuation.inputs.provenance?.ewidencja?.status === "to_verify" ||
        valuation.inputs.provenance?.mpzp?.status === "to_verify"
      : false;
  const hasKwToVerify =
    isDraft && valuation.inputs
      ? valuation.inputs.kw != null && valuation.inputs.provenance?.kw?.status === "to_verify"
      : false;
  const hasFeaturesToVerify =
    isDraft && valuation.inputs
      ? valuation.inputs.provenance?.weights?.status === "to_verify" ||
        valuation.inputs.provenance?.featureDefs?.status === "to_verify"
      : false;
  // A legacy `approved` row (no inputs) or a superseded `signed` row leaves
  // every can*/has* flag false — without this check the action-bar Card
  // would render empty for the owner.
  const hasAnyAction =
    hasToVerify ||
    hasSubjectToVerify ||
    hasKwToVerify ||
    hasFeaturesToVerify ||
    valuation.status === "in_progress" || // canApprove
    canSign ||
    canCreateNewVersion;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Link href="/valuations" className="hover:text-primary">
            Wyceny
          </Link>{" "}
          / Operat
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{valuation.address}</h1>
          <Badge
            data-testid="valuation-status"
            variant={valuation.status === "in_progress" ? "secondary" : "default"}
          >
            {STATUS_LABEL[valuation.status] ?? valuation.status}
          </Badge>
        </div>
        {valuation.supersedesId ? (
          <p data-testid="supersedes-banner" className="text-sm text-muted-foreground">
            Zastępuje{" "}
            <Link
              href={`/valuations/${valuation.supersedesId}`}
              className="underline hover:text-primary"
            >
              poprzedni operat
            </Link>
            .
          </p>
        ) : null}
        {successor ? (
          <p data-testid="superseded-by-banner" className="text-sm text-muted-foreground">
            Zastąpiony przez{" "}
            <Link href={`/valuations/${successor.id}`} className="underline hover:text-primary">
              nowszą wersję
            </Link>
            .
          </p>
        ) : null}
      </div>

      <Card>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Powierzchnia</p>
            <p className="text-base font-medium text-foreground">{valuation.area} m²</p>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Wartość rynkowa (WR)</p>
            <p className="text-base font-medium text-foreground" data-testid="wr-value">
              {valuation.wr == null ? "—" : currencyFormatter.format(valuation.wr)}
            </p>
          </div>
          <div className="flex flex-col gap-0.5 sm:col-span-2">
            <p className="text-xs text-muted-foreground">Kwota słownie</p>
            <p className="text-base font-medium text-primary">{valuation.amountInWords ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      {valuation.inputs ? <KcsBreakdown inputs={valuation.inputs} /> : null}

      {valuation.inputs ? <ComparablesProvenance inputs={valuation.inputs} /> : null}

      {valuation.inputs ? <FeaturesCard inputs={valuation.inputs} /> : null}

      {valuation.inputs?.subject ? <SubjectCard inputs={valuation.inputs} /> : null}

      {valuation.inputs?.kw ? <KwCard inputs={valuation.inputs} /> : null}

      {isDraft && isOwner ? (
        <InspectionSection
          valuationId={valuation.id}
          inspection={valuation.inputs?.inspection ?? null}
        />
      ) : null}

      {isOwner && hasAnyAction ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            {allBlockers.length > 0 ? (
              <div data-testid="gate-blockers" className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  Zatwierdzenie zablokowane — do wyjaśnienia:
                </p>
                <ul className="list-disc pl-5 text-sm text-amber-600 dark:text-amber-500">
                  {allBlockers.map((b) => (
                    <li key={b.path}>{b.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ValuationActions
              id={valuation.id}
              hasToVerify={hasToVerify}
              hasSubjectToVerify={hasSubjectToVerify}
              hasKwToVerify={hasKwToVerify}
              hasFeaturesToVerify={hasFeaturesToVerify}
              gateOk={gateOk}
              canApprove={valuation.status === "in_progress"}
              canSign={canSign}
              canCreateNewVersion={canCreateNewVersion}
            />
          </CardContent>
        </Card>
      ) : null}

      {valuation.status === "approved" && valuation.approvedAt ? (
        <p className="text-sm text-muted-foreground">
          Zatwierdzono:{" "}
          {new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short" }).format(
            valuation.approvedAt,
          )}
        </p>
      ) : null}

      {valuation.status === "signed" && valuation.signedAt ? (
        <p className="text-sm text-muted-foreground">
          Podpisano:{" "}
          {new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short" }).format(
            valuation.signedAt,
          )}
        </p>
      ) : null}

      {valuation.docUrl?.endsWith(".pdf") ? (
        <div className="flex flex-col gap-2">
          <iframe
            title="Operat szacunkowy (PDF)"
            src={valuation.docUrl}
            className="h-[80vh] w-full rounded-md border"
          />
          {valuation.docxUrl ? (
            <Button asChild variant="outline" className="w-fit">
              <a href={valuation.docxUrl}>Pobierz DOCX</a>
            </Button>
          ) : null}
        </div>
      ) : valuation.docUrl ? (
        <Button asChild variant="outline" className="w-fit">
          <a href={valuation.docUrl} target="_blank" rel="noreferrer">
            Otwórz dokument operatu
          </a>
        </Button>
      ) : null}
    </div>
  );
}
