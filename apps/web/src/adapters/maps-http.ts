import type { MapFetchResult, PortMapImages } from "../ports/maps";

const GENERIC_UNAVAILABLE = "Usługa map (Geoportal) jest chwilowo niedostępna.";

/**
 * HTTP adapter for {@link PortMapImages}, backed by the worker's
 * `/map-proposal` (GUGiK WMS GetMap). Total — never throws: every failure
 * (422 out-of-coverage, 5xx, network) collapses to `unavailable`, because
 * the approve flow treats them all the same way (the "confirm no maps"
 * fallback, spec decision 4).
 */
export function httpMapImages(baseUrl: string): PortMapImages {
  return {
    async fetchMaps(address: string): Promise<MapFetchResult> {
      try {
        const response = await fetch(`${baseUrl}/map-proposal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
          // Worst case (worker retries WMS): 2 maps x 4 attempts x 30s ~= 246s,
          // far past the page's `maxDuration = 60` — Vercel would kill the
          // approve action with an opaque error before the "unavailable"
          // fallback UI ever renders (final review, Recommended #3). This
          // timeout fires first and the existing catch below already maps
          // aborts to `unavailable`.
          signal: AbortSignal.timeout(45_000),
        });
        if (!response.ok) {
          let detail: string | undefined;
          try {
            detail = ((await response.json()) as { detail?: string }).detail;
          } catch {
            // no JSON body — fall back below
          }
          return { kind: "unavailable", message: detail ?? GENERIC_UNAVAILABLE };
        }
        const body = (await response.json()) as { ewidencyjna: string; orto: string };
        return {
          kind: "ok",
          maps: {
            ewidencyjna: Buffer.from(body.ewidencyjna, "base64"),
            orto: Buffer.from(body.orto, "base64"),
          },
        };
      } catch {
        return { kind: "unavailable", message: GENERIC_UNAVAILABLE };
      }
    },
  };
}
