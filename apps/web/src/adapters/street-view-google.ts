import type { PanoramaMeta, PortStreetView } from "../ports/street-view";

const META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";
const STATIC_URL = "https://maps.googleapis.com/maps/api/streetview";
const THUMB_SIZE = "160x100";

/**
 * Failure bounds, not service levels — Google answers in well under a
 * second in practice. Kept short so a single stuck call can't eat much of
 * `_street-view-enrich.ts`'s `ENRICH_BUDGET_MS`/`MIN_BUDGET_MS` gate: worst
 * case for one building that's already started when the deadline passes is
 * two Metadata calls (the radius-120 second chance) + one Static call ≈
 * 2×METADATA_TIMEOUT_MS + STATIC_TIMEOUT_MS ≈ 13s, not the 26s a looser
 * bound would allow.
 */
export const METADATA_TIMEOUT_MS = 4000;
export const STATIC_TIMEOUT_MS = 5000;
/**
 * The worst case above, as a number `_build-proposal.ts` can subtract from
 * its own request budget (I1, final wave addendum): a job that starts one
 * tick before `enrichStreetView`'s deadline can still run this long, so the
 * CALLER must stop handing out new jobs `MAX_JOB_MS` before its own
 * `REQUEST_BUDGET_MS` runs out, not just before `ENRICH_BUDGET_MS` does.
 */
export const MAX_JOB_MS = 2 * METADATA_TIMEOUT_MS + STATIC_TIMEOUT_MS;

/**
 * Google Street View Metadata (free, unlimited) + Static (10 000/month free,
 * then 7 $/1000). Server-side only — `apiKey` is GOOGLE_STREET_VIEW_KEY, never
 * NEXT_PUBLIC. `fetchImpl` injectable for tests. Only a building coordinate
 * from a public register ever leaves for Google — no valuation data.
 */
export function googleStreetView(apiKey: string, fetchImpl: typeof fetch = fetch): PortStreetView {
  return {
    async lookup(at, radiusM): Promise<PanoramaMeta | null> {
      const u = new URL(META_URL);
      u.searchParams.set("location", `${at.lat},${at.lng}`);
      u.searchParams.set("radius", String(radiusM));
      u.searchParams.set("source", "outdoor");
      u.searchParams.set("key", apiKey);
      const res = await fetchImpl(u.toString(), {
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Street View metadata HTTP ${res.status}`);
      const body = (await res.json()) as {
        status: string;
        pano_id?: string;
        date?: string;
        location?: { lat: number; lng: number };
        error_message?: string;
      };
      if (body.status === "ZERO_RESULTS" || body.status === "NOT_FOUND") return null;
      if (body.status !== "OK" || !body.pano_id || !body.location) {
        throw new Error(
          `Street View metadata ${body.status}${body.error_message ? `: ${body.error_message}` : ""}`,
        );
      }
      return { panoId: body.pano_id, captureDate: body.date ?? null, camera: body.location };
    },
    async thumbnail(panoId, view): Promise<Buffer> {
      const u = new URL(STATIC_URL);
      u.searchParams.set("size", THUMB_SIZE);
      u.searchParams.set("pano", panoId);
      u.searchParams.set("heading", String(Math.round(view.heading)));
      u.searchParams.set("pitch", String(view.pitch));
      u.searchParams.set("fov", String(view.fov));
      u.searchParams.set("key", apiKey);
      const res = await fetchImpl(u.toString(), {
        signal: AbortSignal.timeout(STATIC_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Street View static HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
