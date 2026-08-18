import { ClipboardCheck, FileStack } from "lucide-react";
import { BlockerList } from "@/components/wizard/blocker-list";
import { SectionCard } from "@/components/wizard/section-card";
import { approvalGate } from "@/domain/provenance";
import { documentFieldBlockers } from "@/domain/document-model";
import { currentSectionFactsHashes } from "@/domain/prose-hash";
import { proseEnabled } from "@/lib/prose-enabled";
import type { Valuation } from "@/ports/valuation";
import { currencyFormatter } from "../cards";
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
  // Same kill-switch answer the approve action computes (FR-6): the list
  // below must name every blocker that action would refuse on, or the
  // refusal arrives out of nowhere on a button that looked enabled.
  //
  // T8: this step no longer confirms anything. The four bulk buttons that used
  // to sit under this card asked the appraiser to vouch for data the card
  // never displayed; confirming moved to steps 1/3/4 in T7, where it IS
  // displayed, and what is left here is a report with a link per blocker.
  const requireProse = proseEnabled();
  const gate = valuation.inputs
    ? approvalGate(valuation.inputs, {
        requireProse,
        currentSectionHashes: requireProse
          ? currentSectionFactsHashes({ address: valuation.address, inputs: valuation.inputs })
          : undefined,
      })
    : null;
  const fieldBlockers = documentFieldBlockers(valuation);
  // Approval requires BOTH the F-4 provenance gate and the document-field
  // check (spec §4) — the button is enabled only when neither has a blocker.
  const allBlockers = [...(gate && !gate.ok ? gate.blockers : []), ...fieldBlockers];
  const gateOk = gate?.ok === true && fieldBlockers.length === 0;

  return (
    <>
      <div className="flex flex-col gap-4">
        <SectionCard icon={FileStack} title="Podsumowanie operatu">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <p className="text-xs text-muted-foreground">Powierzchnia</p>
              <p className="text-base font-medium text-foreground">
                {valuation.area.toLocaleString("pl-PL")} m²
              </p>
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
          </div>
        </SectionCard>

        <SectionCard icon={ClipboardCheck} title="Zatwierdzenie">
          <div className="flex flex-col gap-3">
            {allBlockers.length > 0 ? (
              <BlockerList blockers={allBlockers} testId="gate-blockers" />
            ) : null}
            <ValuationActions
              id={valuation.id}
              gateOk={gateOk}
              canApprove={valuation.status === "in_progress"}
              canSign={false}
              canCreateNewVersion={false}
              wr={valuation.wr}
            />
          </div>
        </SectionCard>
      </div>
    </>
  );
}
