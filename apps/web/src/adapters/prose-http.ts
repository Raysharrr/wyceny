import type { PortProseProposal, ProseProposal, ProseProposalRequest } from "../ports/prose";
import type { ProseSection } from "../domain/prose-snapshot";

/**
 * Prefix of the fallback error thrown below when the worker's error response
 * carries no usable Polish `detail`. Exported so the Server Action can tell
 * "this is the worker's own message, show it" from "this is our English
 * status line, replace it" — same contract as `sample-http.ts`.
 */
export const PROSE_WORKER_RESPONDED_PREFIX = "worker /prose-proposal responded";

type ProseResponseBody = {
  sekcje: Partial<Record<ProseSection, string>>;
  odrzucone: Partial<Record<ProseSection, string[]>>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

/**
 * HTTP adapter for {@link PortProseProposal}, backed by the worker's
 * `POST /prose-proposal`. The wire is Polish (`sekcje`/`fakty`/`transakcje`)
 * and this is the only place that knows it.
 */
export function httpProseProposal(baseUrl: string): PortProseProposal {
  return {
    async fetchProposal(request: ProseProposalRequest): Promise<ProseProposal> {
      const response = await fetch(`${baseUrl}/prose-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: request.token,
          sekcje: request.sections,
          fakty: request.facts,
          transakcje: request.transactions,
        }),
      });
      if (!response.ok) {
        let detail: unknown;
        try {
          detail = ((await response.json()) as { detail?: unknown }).detail;
        } catch {
          // no JSON body — fall back to the status line below
        }
        // The worker answers 400/401/502 with `detail` as a Polish sentence,
        // but a 422 (pydantic schema violation) makes it a LIST of objects —
        // `String(detail)` would put "[object Object]" in front of the
        // appraiser. Only a non-empty string is the worker talking to a human.
        const message =
          typeof detail === "string" && detail.trim().length > 0
            ? detail
            : `${PROSE_WORKER_RESPONDED_PREFIX} ${response.status} ${response.statusText}`;
        throw new Error(message);
      }
      const body = (await response.json()) as ProseResponseBody;
      return {
        sections: body.sekcje,
        rejected: body.odrzucone,
        model: body.model,
        usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens },
      };
    },
  };
}
