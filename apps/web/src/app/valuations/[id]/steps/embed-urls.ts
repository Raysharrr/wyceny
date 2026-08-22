import { mapFrame } from "@/domain/geo";
import { framingFor } from "@/domain/street-view-framing";

const EMBED = "https://www.google.com/maps/embed/v1";
/** Same endpoint, layer and axis order as apps/worker/app/maps.py (verified 2026-08-21: GetMap 1.3.0/EPSG:2180 returns JPEG for Heweliusza). */
export const ORTO_WMS =
  "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution";
export const KIEG_WMS = "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow";

/**
 * Camera framed via `framingFor` (Spike C, 2026-08-21): `cameraDistanceM`
 * is unknown at render time (the panorama's actual camera position isn't
 * carried in `StreetViewEntry`), so it defaults `fov` to 80; `storeysHint`
 * (frozen at enrichment time) still tilts `pitch` up for a taller building.
 */
export function streetViewEmbedUrl(
  key: string,
  e: {
    panoId: string | null;
    heading: number | null;
    lat: number;
    lng: number;
    storeysHint?: number | null;
  },
): string {
  const { pitch, fov } = framingFor({ storeysHint: e.storeysHint ?? null, cameraDistanceM: null });
  const u = new URL(`${EMBED}/streetview`);
  u.searchParams.set("key", key);
  if (e.panoId) u.searchParams.set("pano", e.panoId);
  else u.searchParams.set("location", `${e.lat},${e.lng}`);
  u.searchParams.set("heading", String(Math.round(e.heading ?? 0)));
  u.searchParams.set("pitch", String(pitch));
  u.searchParams.set("fov", String(fov));
  return u.toString();
}

export function mapEmbedUrl(key: string, e: { lat: number; lng: number }): string {
  const u = new URL(`${EMBED}/view`);
  u.searchParams.set("key", key);
  u.searchParams.set("center", `${e.lat},${e.lng}`);
  u.searchParams.set("zoom", "18");
  u.searchParams.set("maptype", "satellite");
  return u.toString();
}

export function wmsGetMapUrl(
  base: string,
  layers: string,
  pos: { x: number; y: number },
  halfM: number,
  px: number,
  format: string,
): string {
  const { bbox } = mapFrame(pos, halfM, px);
  const u = new URL(base);
  u.searchParams.set("REQUEST", "GetMap");
  u.searchParams.set("SERVICE", "WMS");
  u.searchParams.set("VERSION", "1.3.0");
  u.searchParams.set("LAYERS", layers);
  u.searchParams.set("STYLES", "");
  u.searchParams.set("CRS", "EPSG:2180");
  u.searchParams.set("BBOX", bbox.map((v) => String(Math.round(v))).join(","));
  u.searchParams.set("WIDTH", String(px));
  u.searchParams.set("HEIGHT", String(px));
  u.searchParams.set("FORMAT", format);
  return u.toString();
}
export const ortoWmsUrl = (pos: { x: number; y: number }, halfM = 150, px = 600) =>
  wmsGetMapUrl(ORTO_WMS, "Raster", pos, halfM, px, "image/jpeg");
/**
 * Requested at 2× pixel density (`WIDTH`/`HEIGHT` = `px * 2`), the ORTHO
 * fallback isn't — GUGiK's KIEG dzialki/budynki/numery_dzialek/obreby
 * layers are vector-rendered with a SCALE THRESHOLD: at the overview map's
 * usual density (e.g. radius 500 m → halfM 600 → 1200 m / 640 px) the
 * requested scale falls below it and the layers draw NOTHING — an empty
 * 144-byte PNG, confirmed by curl (same BBOX at 1280×1280 → a 264 KB
 * drawing; at 640×640 → empty). `mapFrame`'s `bbox` comes from `pos`/`halfM`
 * alone (`domain/geo.ts`), never `px`, so doubling WIDTH/HEIGHT here
 * doesn't move the BBOX at all — only the requested pixel density (and
 * therefore the WMS scale denominator) changes. The `<img>` itself is
 * still laid out at `px` via CSS, so this is bytes-for-legibility only,
 * not a visible size change.
 */
export const kiegWmsUrl = (pos: { x: number; y: number }, halfM = 150, px = 600) =>
  wmsGetMapUrl(KIEG_WMS, "dzialki,numery_dzialek,budynki,obreby", pos, halfM, px * 2, "image/png");
