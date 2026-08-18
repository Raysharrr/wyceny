import { buildProseFacts, selectProseSections, staleProseSections } from "@/domain/prose";
import { currentSectionFactsHash } from "@/domain/prose-hash";
import { proseEnabled } from "@/lib/prose-enabled";
import { proseCostGrosze } from "@/lib/prose-pricing";
import type { StepDescriptionsProps } from "./steps/step-descriptions";
import type { PortValuation, SessionUser, Valuation } from "@/ports/valuation";

type StepProps = Omit<StepDescriptionsProps, "valuationId">;

/** Nothing generated, nothing spent — also the answer when the flag is off. */
const NO_USAGE: StepProps["usage"] = { generations: 0, tokens: 0, grosze: 0 };

/**
 * Everything step 6 needs to decide whether to ask for prose (ADR-014, FR-6),
 * and what the asking has cost so far.
 *
 * Computed on the SERVER: the fingerprint needs `node:crypto` and the step is
 * a Client Component, so it is handed the RESULT of the comparison and never
 * the hash itself. The same holds for money — the browser receives grosze
 * already counted, never the price list (`lib/prose-pricing.ts`).
 *
 * The repo arrives as an argument rather than through `_deps`, mirroring the
 * injected hash function: this module stays a mapping from a row (plus one
 * read) to props, and its test hands it a stub instead of a database.
 *
 * `NEXT_PUBLIC_PROSE=off` short-circuits here as well as in the component. The
 * flag has to mean "step 6 behaves exactly as it did before FR-6" — the client
 * bundle drops the editors at build time, but without this the server would
 * still build the facts, run the KCS engine and aggregate the audit trail on
 * every render, so the flag could not be used to roll the feature back. Both
 * early returns therefore come BEFORE the `proseUsage` await.
 */
export async function proseStepProps(
  v: Valuation,
  user: SessionUser,
  repo: Pick<PortValuation, "proseUsage">,
): Promise<StepProps> {
  const prose = v.inputs?.prose ?? null;
  if (!proseEnabled() || !v.inputs) {
    return { prose, upToDate: true, staleSections: [], generatableSections: [], usage: NO_USAGE };
  }
  const input = { address: v.address, inputs: v.inputs };
  const generatableSections = selectProseSections(buildProseFacts(input));
  // T2 replaced the one whole-valuation fingerprint with one per section
  // (`factsHashes`) — a section is stale when its PERSISTED text no longer
  // matches the facts behind it. A mismatch is a non-blocking signal asking
  // for a (T3: per-section) regeneration, not a refusal.
  const staleSections = staleProseSections(prose, input, currentSectionFactsHash);
  const usage = await repo.proseUsage(v.id, user);

  return {
    prose,
    // Two states, not one. Stale is a section whose text no longer describes
    // the draft; MISSING is a generatable section with no text at all — and
    // `upToDate` has to count both (T5). A no-opts `proposeProse` regenerates
    // the missing-or-stale set, and the F-4 gate blocks approval on every one
    // of the six sections that carries no text, so a screen claiming "up to
    // date" while a section is absent would disagree with the action AND with
    // the gate. Restricted to `generatableSections`: a section today's facts
    // cannot back is the appraiser's to write by hand, and calling the
    // generator for it would only skip it.
    upToDate:
      prose != null &&
      staleSections.length === 0 &&
      generatableSections.every((s) => prose.sections[s]),
    staleSections,
    generatableSections,
    usage: {
      generations: usage.generations,
      // The measurement and the estimate, kept apart: tokens were counted,
      // the amount is derived from a price list that ages (see the module).
      tokens: usage.inputTokens + usage.outputTokens,
      grosze: proseCostGrosze(usage),
    },
  };
}
