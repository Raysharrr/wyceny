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
import { OperatPreview } from "./operat-preview";
import { PreviewMapsProvider } from "./preview-maps-state";

/**
 * Step 7 ("Operat") — the wizard's final step. Only ever reached for an
 * in-progress draft owned by the current user (the branch condition in
 * page.tsx guarantees both), so this needs none of the flat view's
 * isDraft/isOwner/canSign/canCreateNewVersion ternaries: status is always
 * "in_progress" and the viewer is always the owner.
 *
 * T10: the draft now HAS a document to show — a preview rendered from the
 * same pipeline the issue uses, differing from it only by the date on the
 * title page (and, from T11, by the placeholders standing in for missing
 * sections). That is the whole slice in one line: the appraiser was being
 * asked to take responsibility for a document nobody had shown them.
 * `OperatPreview` is a Client Component and takes only what it needs — this
 * module reaches `domain/prose-hash`, which imports `node:crypto`.
 *
 * An ISSUED operat is still not rendered here: `page.tsx` sends anything that
 * is no longer a draft to the flat view, which embeds `docUrl`.
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
    // T12: the reader and the issue button are separate components with these
    // cards between them, and they have to agree on ONE thing — whether the
    // document on screen has its §8.1 maps. The provider is what carries it;
    // without it the issue would read the no-reader default and fetch maps
    // for a document the appraiser chose to read without them.
    <PreviewMapsProvider>
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
          </div>
          {/* No "Kwota słownie" row here. This step only ever renders a DRAFT
           * — an issued operat routes to the flat view — and the words are
           * produced together with the document, so the row was a dash on
           * every single visit. The reader below spells the amount out in
           * full, inside the document, which is this step's whole point. The
           * flat view keeps the field: there it is filled, from the string
           * the render was given. */}
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

        {/* Last on purpose: in the "braki" state the list above is what the
            button below it answers ("mimo braków"), and an 85vh reader belongs
            under the short cards rather than between them. The shell's pb-32
            keeps the fixed FootNav off its final rows. */}
        <OperatPreview valuationId={valuation.id} hasBlockers={allBlockers.length > 0} />
      </div>
    </PreviewMapsProvider>
  );
}
