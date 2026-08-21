import { describe, it, expect } from "vitest";
import {
  kiegWmsUrl,
  mapEmbedUrl,
  ortoWmsUrl,
  streetViewEmbedUrl,
} from "../src/app/valuations/[id]/steps/embed-urls";

describe("embed-urls", () => {
  it("street view by pano when known (same panorama as the thumbnail), heading rounded, framing from framingFor with no storeysHint (pitch 10, fov 80)", () => {
    const u = new URL(
      streetViewEmbedUrl("K", { panoId: "P1", heading: 123.6, lat: 52.39, lng: 16.87 }),
    );
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/embed/v1/streetview");
    expect(u.searchParams.get("key")).toBe("K");
    expect(u.searchParams.get("pano")).toBe("P1");
    expect(u.searchParams.get("heading")).toBe("124");
    expect(u.searchParams.get("pitch")).toBe("10");
    expect(u.searchParams.get("fov")).toBe("80");
    expect(u.searchParams.has("location")).toBe(false);
  });
  it("street view by location when no pano", () => {
    const u = new URL(
      streetViewEmbedUrl("K", { panoId: null, heading: null, lat: 52.39, lng: 16.87 }),
    );
    expect(u.searchParams.get("location")).toBe("52.39,16.87");
    expect(u.searchParams.has("pano")).toBe(false);
  });
  it("storeysHint feeds framingFor's pitch (7 storeys → pitch 24), cameraDistanceM unknown at render time → fov 80", () => {
    const u = new URL(
      streetViewEmbedUrl("K", { panoId: "P1", heading: 0, lat: 52.39, lng: 16.87, storeysHint: 7 }),
    );
    expect(u.searchParams.get("pitch")).toBe("24");
    expect(u.searchParams.get("fov")).toBe("80");
  });
  it("map embed: view mode, satellite, zoom 18", () => {
    const u = new URL(mapEmbedUrl("K", { lat: 52.39, lng: 16.87 }));
    expect(u.pathname).toBe("/maps/embed/v1/view");
    expect(u.searchParams.get("center")).toBe("52.39,16.87");
    expect(u.searchParams.get("maptype")).toBe("satellite");
  });
  it("orto WMS: GUGiK ORTO, WMS 1.3.0, EPSG:2180, bbox northing-first, square", () => {
    const u = new URL(ortoWmsUrl({ x: 355285, y: 505324 }, 150, 600));
    expect(u.origin + u.pathname).toBe(
      "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution",
    );
    expect(u.searchParams.get("VERSION")).toBe("1.3.0");
    expect(u.searchParams.get("CRS")).toBe("EPSG:2180");
    expect(u.searchParams.get("BBOX")).toBe("505174,355135,505474,355435");
    expect(u.searchParams.get("WIDTH")).toBe("600");
    expect(u.searchParams.get("HEIGHT")).toBe("600");
    expect(u.searchParams.get("FORMAT")).toBe("image/jpeg");
    expect(u.searchParams.get("LAYERS")).toBe("Raster");
  });
  it("kieg WMS: requested at 2x pixel density (WIDTH/HEIGHT = px*2) so GUGiK's cadastral layers clear the scale threshold, but the SAME bbox as orto's — mapDots/viewBox stays exact", () => {
    const pos = { x: 355285, y: 505324 };
    // The overview map's usual frame: radius 500 m → halfM 600 → 640 px,
    // the exact density that returned an empty KIEG PNG before this fix.
    const orto = new URL(ortoWmsUrl(pos, 600, 640));
    const kieg = new URL(kiegWmsUrl(pos, 600, 640));
    expect(kieg.origin + kieg.pathname).toBe(
      "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow",
    );
    expect(kieg.searchParams.get("WIDTH")).toBe("1280");
    expect(kieg.searchParams.get("HEIGHT")).toBe("1280");
    expect(kieg.searchParams.get("BBOX")).toBe(orto.searchParams.get("BBOX"));
    expect(kieg.searchParams.get("LAYERS")).toBe("dzialki,numery_dzialek,budynki,obreby");
    expect(kieg.searchParams.get("FORMAT")).toBe("image/png");
  });
});
