/**
 * Port for the worker's LLM prose proposal (ADR-014): the six operat sections
 * written from this valuation's own facts, guarded against invented numbers.
 *
 * Pure interface — no I/O. Application code depends on this abstraction,
 * never on a concrete adapter (F-10). The type-only imports from `domain/`
 * are erased at compile time, exactly like `ports/valuation.ts`'s `KcsInput`.
 */

import type { ProseFacts, ProseTransactionPayload } from "../domain/prose";
import type { ProseSection } from "../domain/prose-snapshot";

export interface ProseProposalRequest {
  /** Short-lived HMAC, same mechanism as the KW upload token. */
  token: string;
  sections: ProseSection[];
  facts: ProseFacts;
  /**
   * The sample, OUTSIDE the facts: the worker turns it into a deterministic
   * price trend and never puts it in the prompt (raw prices in the facts
   * would authorise the model to write any of them anywhere).
   */
  transactions: ProseTransactionPayload[];
}

export interface ProseProposal {
  /** Text per section that survived the worker's number guard. */
  sections: Partial<Record<ProseSection, string>>;
  /**
   * Sections the worker could not deliver: the numbers the guard rejected
   * twice, or an EMPTY list when the call itself failed. Both mean the same
   * thing for the appraiser — that section has to be written by hand.
   */
  rejected: Partial<Record<ProseSection, string[]>>;
  model: string;
  /** Token cost of the whole generation, retries and rejected sections included. */
  usage: { inputTokens: number; outputTokens: number };
}

export interface PortProseProposal {
  fetchProposal(request: ProseProposalRequest): Promise<ProseProposal>;
}
