import { buildProseFacts, selectProseSections } from "@/domain/prose";
import { currentProseFactsHash } from "@/domain/prose-hash";
import { proseEnabled } from "@/lib/prose-enabled";
import type { StepDescriptionsProps } from "./steps/step-descriptions";
import type { Valuation } from "@/ports/valuation";

/**
 * Everything step 6 needs to decide whether to ask for prose (ADR-014, FR-6).
 *
 * Computed on the SERVER: the fingerprint needs `node:crypto` and the step is
 * a Client Component, so it is handed the RESULT of the comparison and never
 * the hash itself.
 *
 * `NEXT_PUBLIC_PROSE=off` short-circuits here as well as in the component. The
 * flag has to mean "step 6 behaves exactly as it did before FR-6" — the client
 * bundle drops the editors at build time, but without this the server would
 * still build the facts and run the KCS engine on every render, so the flag
 * could not be used to roll the feature back.
 */
export function proseStepProps(v: Valuation): Omit<StepDescriptionsProps, "valuationId"> {
  const prose = v.inputs?.prose ?? null;
  if (!proseEnabled() || !v.inputs) {
    return { prose, upToDate: true, generatableSections: [] };
  }
  const input = { address: v.address, inputs: v.inputs };
  return {
    prose,
    // A mismatch means the proposals describe a draft that has since moved on
    // — a non-blocking signal that asks for a regeneration, not a refusal.
    upToDate: prose != null && prose.factsHash === currentProseFactsHash(input),
    generatableSections: selectProseSections(buildProseFacts(input)),
  };
}
