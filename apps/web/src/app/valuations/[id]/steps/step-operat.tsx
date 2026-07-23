import { Card, CardContent } from "@/components/ui/card";
import { approvalGate } from "@/domain/provenance";
import { documentFieldBlockers } from "@/domain/document-model";
import type { Valuation } from "@/ports/valuation";
import { currencyFormatter } from "../cards";
import { WizardNav } from "../stepper";
import { ValuationActions } from "../valuation-actions";

/**
 * Step 7 ("Operat") — the wizard's final step. Only ever reached for an
 * in-progress draft owned by the current user (the branch condition in
 * page.tsx guarantees both), so this needs none of the flat view's
 * isDraft/isOwner/canSign/canCreateNewVersion ternaries: status is always
 * "in_progress" and the viewer is always the owner. No PDF iframe — a draft
 * has no document yet; approve flips status and the record leaves the
 * wizard for the flat view, which renders the operat.
 */
export function StepOperat({ valuation }: { valuation: Valuation }) {
  const gate = valuation.inputs ? approvalGate(valuation.inputs) : null;
  const fieldBlockers = documentFieldBlockers(valuation);
  // Approval requires BOTH the F-4 provenance gate and the document-field
  // check (spec §4) — the button is enabled only when neither has a blocker.
  const allBlockers = [...(gate && !gate.ok ? gate.blockers : []), ...fieldBlockers];
  const gateOk = gate?.ok === true && fieldBlockers.length === 0;
  const hasToVerify = valuation.inputs
    ? valuation.inputs.comparables.some((c) => c.status === "to_verify") ||
      valuation.inputs.provenance?.geocode?.status === "to_verify"
    : false;
  const hasSubjectToVerify = valuation.inputs
    ? valuation.inputs.provenance?.ewidencja?.status === "to_verify" ||
      valuation.inputs.provenance?.mpzp?.status === "to_verify"
    : false;
  const hasKwToVerify = valuation.inputs
    ? valuation.inputs.kw != null && valuation.inputs.provenance?.kw?.status === "to_verify"
    : false;
  const hasFeaturesToVerify = valuation.inputs
    ? valuation.inputs.provenance?.weights?.status === "to_verify" ||
      valuation.inputs.provenance?.featureDefs?.status === "to_verify"
    : false;

  return (
    <>
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
            canSign={false}
            canCreateNewVersion={false}
          />
        </CardContent>
      </Card>

      <WizardNav valuationId={valuation.id} back={6} />
    </>
  );
}
