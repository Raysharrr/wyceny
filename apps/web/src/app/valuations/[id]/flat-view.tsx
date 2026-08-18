import Link from "next/link";
import { AlertTriangle, Banknote, ClipboardCheck, FileCheck2, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/wizard/section-card";
import { PURPOSE_LABEL } from "@/domain/document-model";
import type { Blocker } from "@/domain/provenance";
import type { Valuation } from "@/ports/valuation";
import {
  ComparablesProvenance,
  currencyFormatter,
  FeaturesCard,
  KcsBreakdown,
  KwCard,
  SubjectCard,
} from "./cards";
import { InspectionSection } from "./inspection-section";
import { ValuationActions } from "./valuation-actions";

const STATUS_LABEL: Record<string, string> = {
  in_progress: "Szkic",
  approved: "Zatwierdzony",
  signed: "Podpisany",
};

const dateTimeFormatter = new Intl.DateTimeFormat("pl-PL", {
  dateStyle: "long",
  timeStyle: "short",
});

/**
 * Document-first flat view (Task 13) — approved/signed valuations get the
 * PDF viewer as the main object with a sticky result/actions sidebar next to
 * it; a draft viewed by a non-owner (admin) gets the pre-existing data cards
 * instead of the PDF, since it doesn't have one yet. Presentational only —
 * page.tsx does the data fetch and every isDraft/isOwner/gate computation;
 * this component just lays it out (extracted per Task 13 brief once the
 * two-column/sticky-sidebar JSX made page.tsx's flat-view branch unreadable
 * inline).
 */
export function FlatView({
  valuation,
  isOwner,
  isDraft,
  canSign,
  successor,
  allBlockers,
  gateOk,
  hasAnyAction,
  canCreateNewVersion,
}: {
  valuation: Valuation;
  isOwner: boolean;
  isDraft: boolean;
  canSign: boolean;
  successor: Valuation | undefined;
  allBlockers: Blocker[];
  gateOk: boolean;
  hasAnyAction: boolean;
  canCreateNewVersion: boolean;
}) {
  const isPdf = valuation.docUrl?.endsWith(".pdf") ?? false;
  const hasDoc = valuation.docUrl != null;
  const showActions = isOwner && hasAnyAction;

  // The six "existing data" cards the flat view has always rendered —
  // shared between the PDF variant's bottom grid and the no-PDF variant's
  // left column (brief: repositioning only, no new information).
  const dataCards = (
    <>
      {valuation.wr != null && valuation.inputs ? <KcsBreakdown inputs={valuation.inputs} /> : null}
      {valuation.wr != null && valuation.inputs ? (
        <ComparablesProvenance inputs={valuation.inputs} />
      ) : null}
      {valuation.inputs ? <FeaturesCard inputs={valuation.inputs} /> : null}
      {valuation.inputs?.subject ? <SubjectCard inputs={valuation.inputs} /> : null}
      {valuation.inputs?.kw ? <KwCard inputs={valuation.inputs} /> : null}
      {/* Dead today — isDraft && isOwner can never both hold once page.tsx's
       * wizard early-return has been passed (an owner's own draft never
       * reaches this component). Carried over unchanged rather than
       * "fixed": Task 13 is a pure reposition, not a behavior change. */}
      {isDraft && isOwner ? (
        <InspectionSection
          valuationId={valuation.id}
          inspection={valuation.inputs?.inspection ?? null}
        />
      ) : null}
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-4 px-6 py-10">
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
          <span className="flex-1" />
          {isPdf ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href={valuation.docUrl!}>Pobierz PDF</a>
              </Button>
              {valuation.docxUrl ? (
                <Button asChild variant="outline">
                  <a href={valuation.docxUrl}>Pobierz DOCX</a>
                </Button>
              ) : null}
            </div>
          ) : null}
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
        {valuation.status === "approved" && valuation.approvedAt ? (
          <p className="text-sm text-muted-foreground">
            Zatwierdzono: {dateTimeFormatter.format(valuation.approvedAt)}
          </p>
        ) : null}
        {valuation.status === "signed" && valuation.signedAt ? (
          <p className="text-sm text-muted-foreground">
            Podpisano: {dateTimeFormatter.format(valuation.signedAt)}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          {isPdf ? (
            <SectionCard icon={FileCheck2} title="Operat szacunkowy">
              <iframe
                title="Operat szacunkowy (PDF)"
                src={valuation.docUrl!}
                className="h-[75vh] w-full rounded-md border"
              />
            </SectionCard>
          ) : valuation.docUrl ? (
            <SectionCard icon={FileCheck2} title="Operat szacunkowy">
              <Button asChild variant="outline" className="w-fit">
                <a href={valuation.docUrl} target="_blank" rel="noreferrer">
                  Otwórz dokument operatu
                </a>
              </Button>
            </SectionCard>
          ) : (
            <div className="flex flex-col gap-4">{dataCards}</div>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-[76px] lg:self-start">
          {hasDoc ? (
            <>
              <SectionCard icon={Banknote} title="Wynik">
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Powierzchnia</p>
                    <p className="num text-base font-medium text-foreground">
                      {valuation.area.toLocaleString("pl-PL")} m²
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Wartość rynkowa (WR)</p>
                    <p
                      className="num text-2xl font-semibold text-foreground"
                      data-testid="wr-value"
                    >
                      {valuation.wr == null ? "—" : currencyFormatter.format(valuation.wr)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Kwota słownie</p>
                    <p className="text-sm font-medium text-primary">
                      {valuation.amountInWords ?? "—"}
                    </p>
                  </div>
                </div>
              </SectionCard>
              <SectionCard icon={MapPin} title="Przedmiot">
                <dl className="flex flex-col gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Adres</dt>
                    <dd>{valuation.address}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Cel wyceny</dt>
                    <dd>{valuation.purpose ? PURPOSE_LABEL[valuation.purpose] : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Nr KW</dt>
                    <dd>{valuation.kwNumber ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Klient</dt>
                    <dd>{valuation.client ?? "—"}</dd>
                  </div>
                </dl>
              </SectionCard>
            </>
          ) : null}

          {/* Plain labels, NOT the step-linked `BlockerList` step 7 renders:
           * this list is only ever seen on a draft by a non-owner admin, and
           * page.tsx routes them to this view for every `?step=` — a link back
           * into the wizard would be a link they cannot follow. */}
          {allBlockers.length > 0 ? (
            <SectionCard icon={AlertTriangle} title="Status">
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
            </SectionCard>
          ) : null}

          {showActions ? (
            <SectionCard icon={ClipboardCheck} title="Akcje">
              <ValuationActions
                id={valuation.id}
                gateOk={gateOk}
                canApprove={valuation.status === "in_progress"}
                canSign={canSign}
                canCreateNewVersion={canCreateNewVersion}
              />
            </SectionCard>
          ) : null}
        </div>
      </div>

      {hasDoc && valuation.inputs ? (
        <div className="grid gap-4 md:grid-cols-2">{dataCards}</div>
      ) : null}
    </div>
  );
}
