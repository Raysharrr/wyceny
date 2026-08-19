import type { PortProseProposal, ProseProposal, ProseProposalRequest } from "../ports/prose";
import type { ProseSection } from "../domain/prose-snapshot";
import { traceHeaders } from "../lib/trace";

/**
 * Prefix of the fallback error thrown below when the worker's error response
 * carries no usable Polish `detail`. Kept for the tests that pin the fallback
 * wording — it is NO LONGER how the caller classifies a failure, see
 * {@link ProseWorkerDetailError}.
 */
export const PROSE_WORKER_RESPONDED_PREFIX = "worker /prose-proposal responded";

/**
 * The worker's own Polish `detail` — the only failure whose text may be put
 * in front of the appraiser verbatim.
 *
 * It used to be told apart by what the message did NOT start with, which made
 * "show it" the default: a dropped connection showed "fetch failed", and a
 * proxy answering with HTML showed the parser quoting that HTML, internal
 * hostname included (T5 review). Naming it with a TYPE inverts that default —
 * anything not thrown here is our own plumbing talking, and the caller
 * replaces it with a Polish message of its own.
 */
export class ProseWorkerDetailError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ProseWorkerDetailError";
  }
}

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
        headers: { "Content-Type": "application/json", ...traceHeaders() },
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
        if (typeof detail === "string" && detail.trim().length > 0) {
          throw new ProseWorkerDetailError(detail);
        }
        throw new Error(
          `${PROSE_WORKER_RESPONDED_PREFIX} ${response.status} ${response.statusText}`,
        );
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
