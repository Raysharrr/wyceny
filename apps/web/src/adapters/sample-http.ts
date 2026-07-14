import type { PortSampleProposal, SampleProposal } from "../ports/sample";

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
          detail ?? `worker /sample-proposal responded ${response.status} ${response.statusText}`,
        );
      }
      return (await response.json()) as SampleProposal;
    },
  };
}
