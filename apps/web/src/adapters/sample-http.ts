import type { PortSampleProposal, SampleProposal } from "../ports/sample";

/**
 * Prefix of the fallback error message thrown below when the worker's error
 * response has no `detail` (i.e. not a Polish user-facing message). Exported
 * so callers (e.g. `get-sample-proposal.ts`) can distinguish "this is the
 * worker's Polish detail" from "this is our own English fallback" without
 * duplicating the literal — keeps the two in sync if the wording changes.
 */
export const WORKER_RESPONDED_PREFIX = "worker /sample-proposal responded";

/**
 * HTTP adapter for {@link PortSampleProposal}, backed by the Python worker's
 * `/sample-proposal` endpoint (RCN WFS integration).
 */
export function httpSampleProposal(baseUrl: string): PortSampleProposal {
  return {
    async fetchProposal(address: string, area: number): Promise<SampleProposal> {
      const response = await fetch(`${baseUrl}/sample-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, area }),
      });
      if (!response.ok) {
        // On failure the worker returns { detail: "<Polish user-facing message>" }
        // (e.g. RCN fetch failed, or too few transactions nearby) — surface it
        // so a later Server Action can show it to the user instead of a generic
        // status message.
        let detail: string | undefined;
        try {
          const body = (await response.json()) as { detail?: string };
          detail = body.detail;
        } catch {
          // no JSON body — fall back below
        }
        throw new Error(
          detail ?? `${WORKER_RESPONDED_PREFIX} ${response.status} ${response.statusText}`,
        );
      }
      return (await response.json()) as SampleProposal;
    },
  };
}
