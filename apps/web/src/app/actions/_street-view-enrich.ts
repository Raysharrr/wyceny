import { buildingKey, type Candidate } from "@/domain/sample-selection";
import { bearingDeg, distanceM, puwg92ToWgs84 } from "@/domain/geo";
import { framingFor } from "@/domain/street-view-framing";
import type { StreetViewEntry, StreetViewSnapshot } from "@/domain/street-view-snapshot";
import { StorageNotFoundError, type PortStorage } from "@/ports/storage";
import type { PanoramaMeta, PortStreetView } from "@/ports/street-view";

export const STREET_VIEW_TTL_DAYS = 365;
/** Wall-clock budget for one enrichment call (Important #1) — the RCN sample must always return; buildings not started in time are counted `skipped`, never left to blow the caller's own timeout. Default when the caller passes no `deps.budgetMs`. */
export const ENRICH_BUDGET_MS = 12_000;
/**
 * The whole Server Action's budget (`getSampleProposal`), not just
 * enrichment's slice of it — matches `maxDuration = 60` in
 * `app/valuations/[id]/page.tsx` minus headroom, and sits above
 * `adapters/sample-http.ts`'s own `TIMEOUT_MS = 50_000` worst case for the
 * worker fetch that runs before enrichment starts. `getSampleProposal`
 * derives the actual `budgetMs` it passes to `enrichStreetView` from how
 * much of this is left after the worker call, capped at `ENRICH_BUDGET_MS`
 * so a fast worker response never grants enrichment more than its own
 * fixed slice.
 */
export const REQUEST_BUDGET_MS = 55_000;
/** Below this, don't even start the worker pool — the round trip to check `deps.now()` and shift the first job costs more than it could accomplish. Every building is counted `skipped`; frozen `existing` entries are still returned (an object lookup, not I/O, so they cost nothing). */
export const MIN_BUDGET_MS = 3_000;
const LOOKUP_RADIUS_M = 50;
/**
 * Spike C (2026-08-21): a flat camera close to a tall building sees only the
 * ground floor, and `source=outdoor` sometimes returns an interior/other
 * panorama. When the first lookup finds nothing, or its panorama sits
 * further than `SECOND_LOOKUP_TRIGGER_M` from the building, one more
 * Metadata call at `SECOND_LOOKUP_RADIUS_M` is tried; whichever camera ends
 * up closer wins. Free (Metadata is unlimited) and bounded to one extra call
 * per building, so `requested` is unaffected.
 */
const SECOND_LOOKUP_RADIUS_M = 120;
const SECOND_LOOKUP_TRIGGER_M = 60;
const CONCURRENCY = 6;
/**
 * Storage keys are slash-free by construction (Important #3): `buildingKey`
 * can itself contain `/` (a `dzialka` like "13/82"), and a `/` inside a
 * single Next.js `[key]` route segment would depend on `%2F` surviving
 * decode. `~` never appears in a `buildingKey` component, so the mapping is
 * unambiguous. Same convention as inspection photo keys (`ogledziny-…`).
 * `isThumbnailKey` is the key CONTRACT for `/api/docs/[key]/route.ts`'s
 * Street View branch — kept next to `thumbnailKey` so the two can't drift.
 */
export const thumbnailKey = (b: string) => `streetview-${b.replaceAll("/", "~")}.jpg`;
export const metaKey = (b: string) => `streetview-${b.replaceAll("/", "~")}.json`;
export const isThumbnailKey = (key: string) => /^streetview-[0-9A-Za-z._~-]+\.jpg$/.test(key);

/**
 * `storeysHint` deliberately NOT persisted here — it comes from the CURRENT
 * pool's floors (a later valuation could see more sold flats and a taller
 * hint), so it is always recomputed fresh and lives only on the returned
 * entry. `pitch`/`fov` are informational (what framing produced the cached
 * thumbnail); a sidecar written before this field existed simply lacks them
 * — still a valid cache hit (Important #2's self-healing only fires on a
 * PARSE failure, not a missing optional field).
 */
type CachedMeta = Omit<StreetViewEntry, "lat" | "lng" | "storeysHint"> & {
  fetchedAt: string;
  pitch?: number;
  fov?: number;
};

/**
 * Self-healing (Important #2): a sidecar that fails to fetch (missing key)
 * or fails to PARSE (corrupt/malformed JSON — a partial write, a manual
 * edit, a future format change) is treated as a cache miss either way, not
 * as a fatal error — the next call just re-fetches from Google and
 * overwrites it with a fresh, valid sidecar. Only a storage error that is
 * NOT "not found" (a real transient failure) still propagates, so it gets
 * counted `failed` by the caller instead of silently masquerading as "no
 * cache".
 */
async function readCache(storage: PortStorage, b: string, now: Date): Promise<CachedMeta | null> {
  let raw: Buffer;
  try {
    raw = await storage.get(metaKey(b));
  } catch (e) {
    if (e instanceof StorageNotFoundError) return null;
    throw e;
  }
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as CachedMeta;
    const ageDays = (now.getTime() - Date.parse(parsed.fetchedAt)) / 86_400_000;
    return ageDays <= STREET_VIEW_TTL_DAYS ? parsed : null;
  } catch {
    return null; // corrupt/malformed sidecar — self-heal as a cache miss
  }
}

/**
 * Street View per unique building of the given candidates: frozen entries
 * (`existing`) first, then the storage cache (meta sidecar + thumbnail, TTL
 * 12 months), then Google (Metadata → heading → Static 160×100). Failures are
 * per building and counted, never thrown — a Google hiccup must not cost the
 * appraiser the sample. Returns only numbers in `meta` (F-13).
 */
export async function enrichStreetView(
  candidates: readonly Candidate[],
  deps: {
    streetView: PortStreetView;
    storage: PortStorage;
    now: () => Date;
    existing?: StreetViewSnapshot | null;
    /** Overrides `ENRICH_BUDGET_MS` — `getSampleProposal` derives this from `REQUEST_BUDGET_MS` minus time already spent. Below `MIN_BUDGET_MS`, the whole pool is skipped (see that constant's doc). */
    budgetMs?: number;
    /** Max known floor per building over the whole pool (`domain/street-view-framing.ts`'s `storeysHintByBuilding`), used to pick the camera pitch. When absent, or when the map doesn't cover a given building, falls back to that building's own candidate's `floor`. */
    storeys?: Map<string, number | null>;
  },
): Promise<{
  snapshot: StreetViewSnapshot;
  meta: { requested: number; cached: number; missing: number; failed: number; skipped: number };
}> {
  const byBuilding = new Map<string, Candidate>();
  for (const c of candidates) {
    const b = buildingKey(c);
    if (b && c.pos && !byBuilding.has(b)) byBuilding.set(b, c);
  }
  const snapshot: StreetViewSnapshot = {};
  const meta = { requested: byBuilding.size, cached: 0, missing: 0, failed: 0, skipped: 0 };
  const budgetMs = deps.budgetMs ?? ENRICH_BUDGET_MS;

  /** Frozen `existing` entries cost nothing (an object lookup) — applied both on the fast path below and when the budget gate skips everything else. */
  function applyFrozen(b: string): boolean {
    const frozen = deps.existing?.[b];
    if (!frozen) return false;
    snapshot[b] = frozen;
    meta.cached += 1;
    if (frozen.panoId === null) meta.missing += 1;
    return true;
  }

  if (budgetMs < MIN_BUDGET_MS) {
    for (const b of byBuilding.keys()) {
      if (!applyFrozen(b)) meta.skipped += 1;
    }
    return { snapshot, meta };
  }

  const now = deps.now();
  const deadline = deps.now().getTime() + budgetMs;
  const queue = [...byBuilding.entries()];

  async function one([b, c]: [string, Candidate]) {
    if (applyFrozen(b)) return;
    const { lat, lng } = puwg92ToWgs84(c.pos!.x, c.pos!.y);
    const storeysHint = deps.storeys?.has(b) ? (deps.storeys.get(b) ?? null) : (c.floor ?? null);
    try {
      const cached = await readCache(deps.storage, b, now);
      if (cached) {
        snapshot[b] = {
          panoId: cached.panoId,
          captureDate: cached.captureDate,
          thumbnailKey: cached.thumbnailKey,
          heading: cached.heading,
          lat,
          lng,
          storeysHint,
        };
        meta.cached += 1;
        if (cached.panoId === null) meta.missing += 1;
        return;
      }
      let pano = await deps.streetView.lookup({ lat, lng }, LOOKUP_RADIUS_M);
      let cameraDistanceM = pano ? distanceM(pano.camera, { lat, lng }) : null;
      if (!pano || (cameraDistanceM !== null && cameraDistanceM > SECOND_LOOKUP_TRIGGER_M)) {
        // Second chance ONLY — a failure here must not cost the first
        // lookup's result (a successful pano, or a confirmed "missing"):
        // caught locally so it can never reach the outer catch, which would
        // otherwise count the WHOLE building `failed` and lose it.
        try {
          const second: PanoramaMeta | null = await deps.streetView.lookup(
            { lat, lng },
            SECOND_LOOKUP_RADIUS_M,
          );
          if (second) {
            const secondDistanceM = distanceM(second.camera, { lat, lng });
            if (cameraDistanceM === null || secondDistanceM < cameraDistanceM) {
              pano = second;
              cameraDistanceM = secondDistanceM;
            }
          }
        } catch {
          // keep whatever the first lookup found (or didn't)
        }
      }
      let entry: StreetViewEntry;
      let pitch: number | undefined;
      let fov: number | undefined;
      if (!pano) {
        entry = {
          panoId: null,
          captureDate: null,
          thumbnailKey: null,
          heading: null,
          lat,
          lng,
          storeysHint,
        };
        meta.missing += 1;
      } else {
        const heading = bearingDeg(pano.camera, { lat, lng });
        const framing = framingFor({ storeysHint, cameraDistanceM });
        pitch = framing.pitch;
        fov = framing.fov;
        const jpeg = await deps.streetView.thumbnail(pano.panoId, {
          heading,
          pitch,
          fov,
        });
        await deps.storage.put(thumbnailKey(b), jpeg);
        entry = {
          panoId: pano.panoId,
          captureDate: pano.captureDate,
          thumbnailKey: thumbnailKey(b),
          heading: Math.round(heading),
          lat,
          lng,
          storeysHint,
        };
      }
      const sidecar: CachedMeta = {
        panoId: entry.panoId,
        captureDate: entry.captureDate,
        thumbnailKey: entry.thumbnailKey,
        heading: entry.heading,
        fetchedAt: now.toISOString(),
        ...(pitch !== undefined ? { pitch } : {}),
        ...(fov !== undefined ? { fov } : {}),
      };
      await deps.storage.put(metaKey(b), JSON.stringify(sidecar));
      snapshot[b] = entry;
    } catch {
      meta.failed += 1;
    }
  }
  // ponytail: tiny worker pool, no dependency — 52 buildings max per fetch.
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        if (deps.now().getTime() > deadline) {
          meta.skipped += 1;
          continue;
        }
        await one(job);
      }
    }),
  );
  return { snapshot, meta };
}
