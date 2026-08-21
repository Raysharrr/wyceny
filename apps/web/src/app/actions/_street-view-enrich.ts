import { buildingKey, type Candidate } from "@/domain/sample-selection";
import { bearingDeg, puwg92ToWgs84 } from "@/domain/geo";
import type { StreetViewEntry, StreetViewSnapshot } from "@/domain/street-view-snapshot";
import { StorageNotFoundError, type PortStorage } from "@/ports/storage";
import type { PortStreetView } from "@/ports/street-view";

export const STREET_VIEW_TTL_DAYS = 365;
/** Wall-clock budget for one enrichment call (Important #1) — the RCN sample must always return; buildings not started in time are counted `skipped`, never left to blow the caller's own timeout. */
export const ENRICH_BUDGET_MS = 12_000;
const LOOKUP_RADIUS_M = 50;
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

type CachedMeta = Omit<StreetViewEntry, "lat" | "lng"> & { fetchedAt: string };

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
  const now = deps.now();
  const deadline = deps.now().getTime() + ENRICH_BUDGET_MS;
  const queue = [...byBuilding.entries()];

  async function one([b, c]: [string, Candidate]) {
    const frozen = deps.existing?.[b];
    if (frozen) {
      snapshot[b] = frozen;
      meta.cached += 1;
      if (frozen.panoId === null) meta.missing += 1;
      return;
    }
    const { lat, lng } = puwg92ToWgs84(c.pos!.x, c.pos!.y);
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
        };
        meta.cached += 1;
        if (cached.panoId === null) meta.missing += 1;
        return;
      }
      const pano = await deps.streetView.lookup({ lat, lng }, LOOKUP_RADIUS_M);
      let entry: StreetViewEntry;
      if (!pano) {
        entry = { panoId: null, captureDate: null, thumbnailKey: null, heading: null, lat, lng };
        meta.missing += 1;
      } else {
        const heading = bearingDeg(pano.camera, { lat, lng });
        const jpeg = await deps.streetView.thumbnail(pano.panoId, heading);
        await deps.storage.put(thumbnailKey(b), jpeg);
        entry = {
          panoId: pano.panoId,
          captureDate: pano.captureDate,
          thumbnailKey: thumbnailKey(b),
          heading: Math.round(heading),
          lat,
          lng,
        };
      }
      const sidecar: CachedMeta = {
        panoId: entry.panoId,
        captureDate: entry.captureDate,
        thumbnailKey: entry.thumbnailKey,
        heading: entry.heading,
        fetchedAt: now.toISOString(),
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
