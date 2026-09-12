import { z } from "zod";
import type { GeocodeHit, PortGeocoder } from "../ports/geocoder";
import { traceHeaders } from "../lib/trace";

/** Mirrors the worker's GEOCODE_BATCH_MAX. */
const CHUNK = 50;
/** 50 UUG lookups ≈ 10 s; a run of Nominatim fallbacks (1 s politeness each) is the worst case. */
const TIMEOUT_MS = 55_000;

const wireSchema = z.object({
  results: z.array(
    z.object({ x: z.number(), y: z.number(), source: z.enum(["uug", "nominatim"]) }).nullable(),
  ),
});

/** HTTP adapter for {@link PortGeocoder} — chunks of 50 to the worker's `POST /geocode-batch`, sequential. */
export function httpGeocoder(baseUrl: string): PortGeocoder {
  return {
    async geocodeMany(addresses, token): Promise<(GeocodeHit | null)[]> {
      const out: (GeocodeHit | null)[] = [];
      for (let i = 0; i < addresses.length; i += CHUNK) {
        const response = await fetch(`${baseUrl}/geocode-batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...traceHeaders() },
          body: JSON.stringify({ token, addresses: addresses.slice(i, i + CHUNK) }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { detail?: string };
          throw new Error(body.detail ?? `worker /geocode-batch responded ${response.status}`);
        }
        out.push(...wireSchema.parse(await response.json()).results);
      }
      return out;
    },
  };
}
