import type { AddressSuggestion, PortAddressSuggest } from "../ports/address-suggest";
import { traceHeaders } from "../lib/trace";

/**
 * HTTP adapter for {@link PortAddressSuggest}, backed by the worker's
 * `/address-suggest` (UUG geocoder). Total — never throws: a dead geocoder
 * must not break the address field, so 5xx/network/timeout/malformed all
 * collapse to an empty list (same contract as `maps-http.ts`).
 */
export function httpAddressSuggest(baseUrl: string): PortAddressSuggest {
  return {
    async suggest(query: string): Promise<AddressSuggestion[]> {
      try {
        const response = await fetch(`${baseUrl}/address-suggest`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...traceHeaders() },
          body: JSON.stringify({ query }),
          // The combobox debounces at 300 ms; a suggestion arriving after 5 s
          // is stale anyway — fail fast to "no suggestions" instead of holding
          // the field hostage (worker-side UUG timeout is 5 s too).
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return [];
        const body = (await response.json()) as { suggestions?: AddressSuggestion[] };
        return body.suggestions ?? [];
      } catch {
        return [];
      }
    },
  };
}
