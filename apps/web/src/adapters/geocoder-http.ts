import { z } from "zod";
import type { GeocodeHit, PortGeocoder } from "../ports/geocoder";
import { traceHeaders } from "../lib/trace";

/**
 * Mirrors the worker's GEOCODE_BATCH_MAX. Sized with TIMEOUT_MS: a chunk that
 * goes entirely through the Nominatim fallback costs ≈ 2.5 s per address
 * (UUG miss + Nominatim + 1 s pause), 20 × 2.5 s = 50 s < 55 s.
 */
const CHUNK = 20;
const TIMEOUT_MS = 55_000;

const wireSchema = z.object({
  results: z.array(
    z.object({ x: z.number(), y: z.number(), source: z.enum(["uug", "nominatim"]) }).nullable(),
  ),
});

/**
 * HTTP adapter for {@link PortGeocoder} — chunks of 20 to the worker's
 * `POST /geocode-batch`, sequential. A chunk that fails (timeout, 5xx,
 * unreachable worker) degrades to `null` for its addresses instead of
 * throwing: those rows still enter the register as "do poprawki" (HANDOFF §1),
 * the import as a whole never dies on the geocoder (review 1 §4). The
 * failure is reported through `onChunkError` so the caller can log a class.
 */
export function httpGeocoder(
  baseUrl: string,
  onChunkError: (errType: string) => void = () => {},
): PortGeocoder {
  return {
    async geocodeMany(addresses, token): Promise<(GeocodeHit | null)[]> {
      const out: (GeocodeHit | null)[] = [];
      for (let i = 0; i < addresses.length; i += CHUNK) {
        const chunk = addresses.slice(i, i + CHUNK);
        try {
          const response = await fetch(`${baseUrl}/geocode-batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...traceHeaders() },
            body: JSON.stringify({ token, addresses: chunk }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!response.ok) throw new Error(`worker /geocode-batch responded ${response.status}`);
          out.push(...wireSchema.parse(await response.json()).results);
        } catch (err) {
          onChunkError(err instanceof Error ? err.name : "unknown");
          out.push(...chunk.map(() => null));
        }
      }
      return out;
    },
  };
}
