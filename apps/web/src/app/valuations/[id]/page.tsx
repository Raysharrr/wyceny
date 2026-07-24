import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { getSession } from "@/auth/session";
import { approvalGate } from "@/domain/provenance";
import { documentFieldBlockers } from "@/domain/document-model";
import { maxReachedStep, resolveStep } from "@/domain/wizard";
import { step1DefaultsFromInputs } from "@/lib/subject-form";
import { valuationRepository } from "../_deps";
import { SubjectForm } from "../new/subject-form";
import { FlatView } from "./flat-view";
import { StepCalculation } from "./steps/step-calculation";
import { StepDescriptions } from "./steps/step-descriptions";
import { StepFeatures } from "./steps/step-features";
import { StepInspection } from "./steps/step-inspection";
import { StepOperat } from "./steps/step-operat";
import { StepSample } from "./steps/step-sample";

// The approve Server Action invoked from this page generates the operat
// (DOCX render + LibreOffice PDF conversion in the worker), which can exceed
// the default serverless function timeout. Page-level route config covers the
// Server Actions defined for / invoked from this route (Next 16.2.9).
export const maxDuration = 60;

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

  // `get` already enforces F-8 ownership isolation (appraiser → own rows
  // only; admin → any), so isOwner is always true for an appraiser here —
  // it only ever excludes an admin viewing another appraiser's valuation,
  // which is the case this gates the owner-only action bar for.
  const isOwner = valuation.ownerId === session.user.id;

  // Wizard shell (Slice 11a, Task 7/12) — only for the owner's own
  // in-progress draft. Everything else (approved/signed, an admin viewing
  // another appraiser's draft) falls through to the flat view below.
  if (valuation.status === "in_progress" && isOwner) {
    const max = maxReachedStep(valuation);
    const step = resolveStep((await searchParams).step, max);
    return (
      <WizardShell currentStep={step} maxReachedStep={max} valuationId={valuation.id}>
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
            comparables={valuation.inputs?.comparables ?? []}
            area={valuation.area}
          />
        ) : step === 5 ? (
          <StepCalculation valuation={valuation} />
        ) : step === 6 ? (
          <StepDescriptions valuationId={valuation.id} />
        ) : (
          <StepOperat valuation={valuation} />
        )}
      </WizardShell>
    );
  }

  const isDraft = valuation.status === "in_progress";
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
    <FlatView
      valuation={valuation}
      isOwner={isOwner}
      isDraft={isDraft}
      canSign={canSign}
      successor={successor}
      allBlockers={allBlockers}
      gateOk={gateOk}
      hasToVerify={hasToVerify}
      hasSubjectToVerify={hasSubjectToVerify}
      hasKwToVerify={hasKwToVerify}
      hasFeaturesToVerify={hasFeaturesToVerify}
      hasAnyAction={hasAnyAction}
      canCreateNewVersion={canCreateNewVersion}
    />
  );
}
