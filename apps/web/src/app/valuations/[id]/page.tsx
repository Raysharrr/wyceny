import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSession } from "@/auth/session";
import { approvalGate } from "@/domain/provenance";
import { documentFieldBlockers } from "@/domain/document-model";
import { maxReachedStep, resolveStep } from "@/domain/wizard";
import { valuationRepository } from "../_deps";
import { SubjectForm, step1DefaultsFromInputs } from "../new/subject-form";
import {
  ComparablesProvenance,
  currencyFormatter,
  FeaturesCard,
  KcsBreakdown,
  KwCard,
  SubjectCard,
} from "./cards";
import { InspectionSection } from "./inspection-section";
import { Stepper, WizardNav } from "./stepper";
import { StepDescriptions } from "./steps/step-descriptions";
import { StepFeatures } from "./steps/step-features";
import { StepInspection } from "./steps/step-inspection";
import { StepOperat } from "./steps/step-operat";
import { StepSample } from "./steps/step-sample";
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

/**
 * Shared temporary arm for wizard steps 2-5, not yet built (Tasks 8-11
 * replace each with the real step). Purely a "under construction" card +
 * wizard footer nav — no per-step logic.
 */
function StepPlaceholder({
  title,
  valuationId,
  back,
  next,
}: {
  title: string;
  valuationId: string;
  back?: number;
  next?: number;
}) {
  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">W budowie.</p>
        </CardContent>
      </Card>
      <WizardNav valuationId={valuationId} back={back} next={next} />
    </>
  );
}

/**
 * View page (Task 9) — RSC. `PortValuation.get` enforces ownership isolation
 * (T7): a non-owner appraiser gets `null` back, not the row — shown here as
 * a Polish "not found / no access" state rather than surfacing which case it
 * was (avoids leaking existence of other users' valuations).
 */
export default async function ValuationViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
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

  // Wizard shell (Slice 11a, Task 7) — only for the owner's own in-progress
  // draft, behind the flag. Everything else (approved/signed, an admin
  // viewing another appraiser's draft, or the flag off) falls through to the
  // flat view below, unchanged.
  const wizardOn = process.env.NEXT_PUBLIC_WIZARD === "on";
  if (wizardOn && valuation.status === "in_progress" && valuation.ownerId === session.user.id) {
    const max = maxReachedStep(valuation);
    const step = resolveStep((await searchParams).step, max);
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Link href="/valuations" className="hover:text-primary">
              Wyceny
            </Link>{" "}
            / Operat
          </p>
          <h1 className="text-2xl font-semibold text-foreground">{valuation.address}</h1>
        </div>
        <Stepper current={step} maxReached={max} valuationId={valuation.id} />
        {step === 1 ? (
          <SubjectForm valuationId={valuation.id} defaults={step1DefaultsFromInputs(valuation)} />
        ) : step === 2 ? (
          <StepInspection
            valuationId={valuation.id}
            inspection={valuation.inputs?.inspection ?? null}
            inspectionDate={valuation.inspectionDate}
          />
        ) : step === 3 ? (
          <StepSample
            valuationId={valuation.id}
            address={valuation.address}
            area={valuation.area}
            comparables={valuation.inputs?.comparables ?? []}
            sampleMeta={valuation.inputs?.sampleMeta ?? null}
          />
        ) : step === 4 ? (
          <StepFeatures
            valuationId={valuation.id}
            features={valuation.inputs?.features ?? []}
            comparableAreas={(valuation.inputs?.comparables ?? []).map((c) => c.area)}
          />
        ) : step === 5 ? (
          <StepPlaceholder title="Kalkulacja" valuationId={valuation.id} back={4} next={6} />
        ) : step === 6 ? (
          <StepDescriptions valuationId={valuation.id} />
        ) : (
          <StepOperat valuation={valuation} />
        )}
      </div>
    );
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

      {valuation.wr != null && valuation.inputs ? <KcsBreakdown inputs={valuation.inputs} /> : null}

      {valuation.wr != null && valuation.inputs ? (
        <ComparablesProvenance inputs={valuation.inputs} />
      ) : null}

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
