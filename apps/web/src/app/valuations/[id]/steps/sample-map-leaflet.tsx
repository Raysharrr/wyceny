"use client";

import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./sample-map-leaflet.css";
import { puwg92ToWgs84 } from "@/domain/geo";
import { DEFAULTS, candidateKey } from "@/domain/sample-selection";
import { effectiveSelection, type SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import { KIEG_WMS, ORTO_WMS } from "./embed-urls";

/**
 * SPIKE (2026-08-21, `spike/leaflet-map`): Leaflet replacement for the
 * single-image `sample-map.tsx`. Throwaway prototype behind
 * `NEXT_PUBLIC_MAP_LEAFLET=1` — see tools/spike/2026-08-21-leaflet-mapa in
 * the wiki repo for the questions it answers. Not wired into any test that
 * the CI runs by default apart from its own RTL file.
 *
 * Base layers: OSM raster tiles (EPSG:3857), GUGiK ORTO WMS (answers in
 * EPSG:3857 — verified with curl 2026-08-21), Geoportal BDOT10k WMS (also
 * reprojects to 3857 even though GetCapabilities lists only 2176-2180/4326).
 * Geoportal WMTS (TOPO, G2_MOBILE_500) publishes ONLY EPSG:2180 / 4326 tile
 * matrices, so it cannot sit under OSM without proj4leaflet and a 2180 map —
 * left out on purpose (see RAPORT.md).
 *
 * Coordinates: candidate `pos` is `{x: easting, y: northing}` in EPSG:2180
 * (worker `rcn.py` normalises gml:pos that way; the subject point in
 * `sampleMeta.point` follows the same convention — Heweliusza 3 is
 * `{x: 355300, y: 505330}`), so `puwg92ToWgs84(x, y)` — the SAME helper the
 * Street View enrichment already uses — lands on the building.
 */

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const BDOT_WMS =
  "https://mapy.geoportal.gov.pl/wss/service/pub/guest/kompozycja_BDOT10k_WMS/MapServer/WMSServer";
// Filled from GetCapabilities (the root "WMS" group is not requestable).
const BDOT_LAYERS =
  "RZab,TPrz,SOd2,SOd1,GNu2,GNu1,TKa2,TKa1,TPi2,TPi1,UTrw,TLes,RKr,RTr,ku7,ku6,ku5,ku4,ku3,ku2,ku1,Mo,Pl3,Pl2,Pl1,kanOkr,rzOk,row,kan,rz,RowEt,kanEt,rzEt,WPow,Szu,LBrzN,LBrz,WPowEt,GrPol,Rez,GrPK,GrPN,GrDz,GrGm,GrPo,GrWo,GrPns,PRur,ZbTA,BudCm,TerCm,BudSp,Szkl,Kap,SwNch,SwCh,BudZr,BudGo,BudPWy,BudP2,BudP1,BudUWy,BudU,BudMWy,BudMJ,BudMW,Bzn,BHydA,BHydL,wyk,wa6,wa5,wa4,wa3,wa2,wa1,IUTA,ObOrA,ObPL,Prom,PomL,MurH,PerA,PerL,Tryb,UTrL,LTra,LKNc,LKBu,LKWs,TSt,LKNelJ,LKNelD,LKNelW,LKZelJ,LKZelD,LKZelW,Scz,Al,AlEt,Sch2,Sch1,DrDGr,DrLGr,JDrLNUt,JDLNTw,JDrZTw,JDrG,DrEk,JDrEk,AuBud,JAu,NazDr,NrDr,Umo,PPdz,Prze,TunK,TunD,Klad,MosK,MosD,UTrP,ObKom,InUTP,ZbTP,NazUl,ObOrP,WyBT,LTel,LEle,ObPP,DrzPomP";

type DotKind = "proposed" | "alternate" | "rejected";
type Dot = {
  key: string;
  pos: { x: number; y: number };
  kind: DotKind;
  date: string;
  pricePerM2: number;
  distanceM: number;
};

const DOT_SIZE: Record<DotKind, number> = { proposed: 14, alternate: 11, rejected: 9 };
const DOT_Z: Record<DotKind, number> = { proposed: 300, alternate: 200, rejected: 100 };
// Same literals as `sample-map.tsx` (brand teal / muted grey / destructive red).
const FILL: Record<DotKind, string> = {
  proposed: "#1f7a5c",
  alternate: "#9a978f",
  rejected: "#e7000b",
};
/** Ring radius (px) a duplicate dot is nudged onto — mirrors `map-dots.ts`. */
const OVERLAP_RING_PX = 8;
const M_PER_DEG_LAT = 111_320;

const priceFmt = new Intl.NumberFormat("pl-PL");

function dotTooltip(d: Dot): string {
  return `${d.date} · ${priceFmt.format(Math.round(d.pricePerM2))} zł/m² · ${Math.round(d.distanceM)} m`;
}

/** Same wording as `sample-map.tsx`'s `dotAriaLabel` — the table's keyboard users hear one vocabulary. */
function dotAriaLabel(d: Dot): string {
  const kindLabel = d.kind === "proposed" ? "propozycja" : "alternatywa";
  return `kandydatka ${d.date} · ${priceFmt.format(Math.round(d.pricePerM2))} zł/m² · ${Math.round(d.distanceM)} m · ${kindLabel}`;
}

/** Draw order rejected → alternate → proposed (proposed on top), as `mapDots`. */
function buildDots(snap: SampleSelectionSnapshot): Dot[] {
  const eff = effectiveSelection(snap);
  const dots: Dot[] = [];
  const push = (
    row: {
      pos: { x: number; y: number } | null;
      date: string;
      pricePerM2: number;
      distanceM: number;
    },
    key: string,
    kind: DotKind,
  ) => {
    if (!row.pos) return;
    dots.push({
      key,
      pos: row.pos,
      kind,
      date: row.date,
      pricePerM2: row.pricePerM2,
      distanceM: row.distanceM,
    });
  };
  for (const r of snap.rejected ?? []) push(r, candidateKey(r), "rejected");
  for (const c of eff.removed) push(c, candidateKey(c), "rejected");
  for (const c of eff.alternates) push(c, candidateKey(c), "alternate");
  for (const c of eff.proposed) push(c, candidateKey(c), "proposed");
  return dots;
}

/**
 * Pixel offsets for dots sharing the EXACT same `pos` (several lokale of one
 * building): first stays on the coordinate, the k-th after it goes onto a
 * ring of 8 — the `spreadOverlaps` rule from `map-dots.ts`, but applied as a
 * screen-space `iconAnchor` shift so the spread is zoom-independent.
 */
function overlapOffsets(dots: Dot[]): Map<string, [number, number]> {
  const totalAt = new Map<string, number>();
  for (const d of dots) {
    const posKey = `${d.pos.x},${d.pos.y}`;
    totalAt.set(posKey, (totalAt.get(posKey) ?? 0) + 1);
  }
  const seenAt = new Map<string, number>();
  const out = new Map<string, [number, number]>();
  for (const d of dots) {
    const posKey = `${d.pos.x},${d.pos.y}`;
    if ((totalAt.get(posKey) ?? 0) <= 1) continue;
    const k = seenAt.get(posKey) ?? 0;
    seenAt.set(posKey, k + 1);
    if (k === 0) continue;
    const ring = Math.ceil(k / 8);
    const angle = ((k - 1) % 8) * ((2 * Math.PI) / 8);
    const radius = ring * OVERLAP_RING_PX;
    out.set(d.key, [radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return out;
}

function toLatLng(pos: { x: number; y: number }): L.LatLng {
  const { lat, lng } = puwg92ToWgs84(pos.x, pos.y);
  return L.latLng(lat, lng);
}

export function SampleMapLeaflet({
  selection,
  center,
  selectedKey,
  onSelect,
}: {
  selection: SampleSelectionSnapshot;
  center: { x: number; y: number };
  selectedKey: string | null;
  onSelect(key: string): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const ringsRef = useRef<L.LayerGroup | null>(null);
  const dotsRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const ortoRef = useRef<L.Layer | null>(null);
  // Latest `onSelect` without re-wiring every marker on each render.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const halfM = Math.max(300, selection.radiusUsedM * 1.2);
  const { lat: centerLat, lng: centerLng } = puwg92ToWgs84(center.x, center.y);

  // Map + base layers, once per mount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const t0 = performance.now();
    const map = L.map(el, {
      // Explicit SVG renderer: the same kind of overlay the old component
      // drew, and it also works in jsdom (Leaflet's feature detection would
      // otherwise pick Canvas there and crash on a null 2d context).
      renderer: new L.SVG(),
      zoomSnap: 0.5,
    });
    const osm = L.tileLayer(OSM_TILES, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    const orto = L.tileLayer.wms(ORTO_WMS, {
      layers: "Raster",
      format: "image/jpeg",
      version: "1.3.0",
      maxZoom: 21,
      attribution: "Ortofotomapa &copy; GUGiK",
    });
    const bdot = L.tileLayer.wms(BDOT_WMS, {
      layers: BDOT_LAYERS,
      format: "image/png",
      version: "1.3.0",
      maxZoom: 20,
      attribution: "BDOT10k &copy; GUGiK",
    });
    const kieg = L.tileLayer.wms(KIEG_WMS, {
      layers: "dzialki,numery_dzialek,budynki",
      format: "image/png",
      transparent: true,
      version: "1.3.0",
      minZoom: 16,
      maxZoom: 21,
      attribution: "EGiB &copy; GUGiK",
    });
    osm.addTo(map);
    L.control
      .layers(
        { "Mapa (OSM)": osm, "Ortofoto (GUGiK)": orto, "BDOT10k (Geoportal)": bdot },
        { "Działki i budynki (EGiB)": kieg },
        { collapsed: false },
      )
      .addTo(map);
    map.on("baselayerchange", (e) => {
      el.classList.toggle("smap--orto", e.layer === orto);
    });
    // First-render timing for the spike report: ms from map creation to the
    // first base layer's tiles all loaded (read via `data-first-render-ms`).
    osm.once("load", () => {
      el.dataset.firstRenderMs = String(Math.round(performance.now() - t0));
    });
    const rings = L.layerGroup().addTo(map);
    const dots = L.layerGroup().addTo(map);
    const markers = markersRef.current;
    // Spike-only debugging hook (read from the browser console / devtools).
    Object.assign(el, { _spikeMap: map });
    mapRef.current = map;
    ringsRef.current = rings;
    dotsRef.current = dots;
    ortoRef.current = orto;

    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(el);

    return () => {
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      ringsRef.current = null;
      dotsRef.current = null;
      markers.clear();
    };
  }, []);

  // View + radius rings follow the subject / radius.
  useEffect(() => {
    const map = mapRef.current;
    const rings = ringsRef.current;
    if (!map || !rings) return;
    const c = L.latLng(centerLat, centerLng);
    rings.clearLayers();
    for (const r of DEFAULTS.radiusStepsM) {
      const active = r === selection.radiusUsedM;
      L.circle(c, {
        radius: r,
        weight: active ? 2 : 1,
        dashArray: active ? undefined : "4 4",
        fill: false,
        interactive: false,
        className: active ? "smap-ring smap-ring--active" : "smap-ring",
      }).addTo(rings);
      L.tooltip({
        permanent: true,
        direction: "top",
        className: "smap-ring-label",
        offset: [0, 0],
        interactive: false,
      })
        .setLatLng([centerLat + r / M_PER_DEG_LAT, centerLng])
        .setContent(`${r} m`)
        .addTo(rings);
    }
    // The diamond is an INNER span — Leaflet positions the icon element with
    // an inline `transform: translate3d(...)`, which would override a
    // `rotate(45deg)` on the element itself.
    L.marker(c, {
      icon: L.divIcon({
        className: "smap-subject",
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        html: '<span class="smap-subject-diamond" role="img" aria-label="przedmiot wyceny"></span>',
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 500,
    }).addTo(rings);
    const size = map.getSize();
    if (size.x > 0 && size.y > 0) map.fitBounds(c.toBounds(2 * halfM), { animate: false });
    else map.setView(c, 15, { animate: false });
  }, [centerLat, centerLng, halfM, selection.radiusUsedM]);

  // Candidate markers follow the selection snapshot.
  useEffect(() => {
    const map = mapRef.current;
    const group = dotsRef.current;
    if (!map || !group) return;
    group.clearLayers();
    markersRef.current.clear();
    const dots = buildDots(selection);
    const offsets = overlapOffsets(dots);
    for (const d of dots) {
      const clickable = d.kind !== "rejected";
      const size = DOT_SIZE[d.kind];
      const [dx, dy] = offsets.get(d.key) ?? [0, 0];
      const marker = L.marker(toLatLng(d.pos), {
        icon: L.divIcon({
          className: `smap-dot smap-dot--${d.kind}`,
          iconSize: [size, size],
          iconAnchor: [size / 2 - dx, size / 2 - dy],
          html: "",
        }),
        interactive: clickable,
        keyboard: clickable,
        zIndexOffset: DOT_Z[d.kind],
        bubblingMouseEvents: false,
      });
      marker.addTo(group);
      const el = marker.getElement();
      if (el) {
        el.dataset.testid = `dot-${d.kind}`;
        el.dataset.key = d.key;
        if (clickable) {
          el.setAttribute("role", "button");
          el.setAttribute("aria-label", dotAriaLabel(d));
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              // preventDefault also suppresses the `keypress` Leaflet turns
              // into a synthetic click — one `onSelect` per key, not two.
              e.preventDefault();
              onSelectRef.current(d.key);
            }
          });
        } else {
          // Rejected dots carry no interaction — hidden from assistive tech
          // entirely (as `sample-map.tsx`), native title only.
          el.setAttribute("aria-hidden", "true");
          el.title = dotTooltip(d);
        }
      }
      if (clickable) {
        marker.bindTooltip(dotTooltip(d), { direction: "top", offset: [0, -size / 2] });
        marker.on("click", () => onSelectRef.current(d.key));
      }
      markersRef.current.set(d.key, marker);
    }
  }, [selection]);

  // Selected-row highlight.
  useEffect(() => {
    for (const [key, marker] of markersRef.current) {
      marker.getElement()?.classList.toggle("smap-dot--selected", key === selectedKey);
    }
  }, [selectedKey, selection]);

  const eff = effectiveSelection(selection);
  const rejectedCensus =
    Object.values(selection.rejectedCounts ?? {}).reduce((sum, n) => sum + (n ?? 0), 0) +
    (selection.manualRejections?.length ?? 0);

  return (
    <>
      <figure className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
        <div
          ref={containerRef}
          className="smap absolute inset-0 h-full w-full"
          aria-label="Kandydatki na mapie"
          data-testid="sample-map-leaflet"
        />
        <figcaption className="absolute left-2 bottom-2 z-[1000] flex gap-3 rounded-md bg-background/90 px-2 py-1 text-xs">
          <span>
            <span style={{ color: FILL.proposed }}>●</span> propozycja {eff.proposed.length}
          </span>
          <span>
            <span style={{ color: FILL.alternate }}>●</span> alternatywy {eff.alternates.length}
          </span>
          <span>
            <span style={{ color: FILL.rejected }}>●</span> odrzucone {rejectedCensus}
          </span>
        </figcaption>
      </figure>
      <p className="text-sm text-muted-foreground">
        Mapa OpenStreetMap · Ortofoto i BDOT10k z GUGiK (WMS) · kółko myszy przybliża, klik w kropkę
        podświetla wiersz i otwiera panel
      </p>
    </>
  );
}
