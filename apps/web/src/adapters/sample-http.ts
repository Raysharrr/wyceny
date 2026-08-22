import type { CandidatePool, PortSampleProposal, SamplePoolRequest } from "../ports/sample";
import { candidatePoolSchema } from "../lib/valuation-form-schema";
import { traceHeaders } from "../lib/trace";

/**
 * Prefix of the fallback error message thrown below when the worker's error
 * response has no `detail` (i.e. not a Polish user-facing message). Exported
 * so callers (e.g. `get-sample-proposal.ts`) can distinguish "this is the
 * worker's Polish detail" from "this is our own English fallback" without
 * duplicating the literal — keeps the two in sync if the wording changes.
 */
export const WORKER_RESPONDED_PREFIX = "worker /sample-proposal responded";

// Worker stops starting new WFS pages after 25 s (`fetch_pool` time budget) and one page takes up to 20 s,
// so ~45 s is its worst case — inside this timeout and Vercel's 60 s. Deeper pools come back `truncated`.
const TIMEOUT_MS = 50_000;

/**
 * HTTP adapter for {@link PortSampleProposal}, backed by the Python worker's
 * `/sample-proposal` endpoint (RCN WFS integration, ADR-015 "Dobor proby v3").
 */
export function httpSampleProposal(baseUrl: string): PortSampleProposal {
  return {
    async fetchPool(input: SamplePoolRequest): Promise<CandidatePool> {
      const response = await fetch(`${baseUrl}/sample-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...traceHeaders() },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        // On failure the worker returns { detail: "<Polish user-facing message>" }
        // (e.g. RCN fetch failed, or too few transactions nearby) — surface it
        // so a later Server Action can show it to the user instead of a generic
        // status message.
        const body = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(
          body.detail ?? `${WORKER_RESPONDED_PREFIX} ${response.status} ${response.statusText}`,
        );
      }
      return candidatePoolSchema.parse(await response.json());
    },
  };
}
