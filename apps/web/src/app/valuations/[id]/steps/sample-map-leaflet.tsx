"use client";

import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./sample-map-leaflet.css";
import { puwg92ToWgs84 } from "@/domain/geo";
import { DEFAULTS } from "@/domain/sample-selection";
import { effectiveSelection, type SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import { KIEG_WMS, ORTO_WMS } from "./embed-urls";
import {
  buildDots,
  dotAriaLabel,
  dotTooltip,
  rejectedCensus,
  ringStyle,
  viewHalfM,
  type Dot,
  type DotKind,
} from "./map-markers";

/**
 * Overview map of step 3 on Leaflet (Slice 3b, 2026-08-21). EPSG:3857 map;
 * candidate `pos` is EPSG:2180 `{x: easting, y: northing}` (worker `rcn.py`)
 * → `puwg92ToWgs84(x, y)`, the same helper Street View enrichment uses.
 *
 * Base layers: OSM raster tiles (street names — the reason this map exists)
 * and GUGiK ORTO WMS (answers in EPSG:3857). Overlay: KIEG/EGiB parcels and
 * buildings, on by default, drawn from zoom 17. Geoportal WMTS publishes no
 * EPSG:3857 matrix, so it cannot sit under OSM — left out (spike RAPORT.md).
 *
 * OSM tiles are for staging/QA only (tile usage policy: attribution, no
 * server-side caching, no SLA) — swap `OSM_TILES` for MapTiler/own tiles
 * before a wider rollout.
 */
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const EGIB_MIN_ZOOM = 17;
const M_PER_DEG_LAT = 111_320;

const DOT_SIZE: Record<DotKind, number> = { proposed: 14, alternate: 11, rejected: 9 };
const DOT_Z: Record<DotKind, number> = { proposed: 300, alternate: 200, rejected: 100 };
// Same literals as the CSS / the old SVG map — used only by the legend.
const FILL: Record<DotKind, string> = {
  proposed: "#1f7a5c",
  alternate: "#9a978f",
  rejected: "#e7000b",
};

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
  // Latest `onSelect` without re-wiring every marker on each render.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const [tilesFailed, setTilesFailed] = useState(false);

  const halfM = viewHalfM(selection.radiusUsedM);
  const { lat: centerLat, lng: centerLng } = puwg92ToWgs84(center.x, center.y);

  // Map + layers, once per mount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const map = L.map(el, {
      // Explicit SVG renderer: works in jsdom too (Leaflet's feature
      // detection would otherwise pick Canvas and crash on a null 2d context).
      renderer: new L.SVG(),
      zoomSnap: 0.5,
    });
    // OSM serves tiles up to z19; scale them (maxNativeZoom) instead of dropping the
    // background at z20–21, where the ORTO/EGiB layers (maxZoom 21) still draw.
    const osm = L.tileLayer(OSM_TILES, {
      maxNativeZoom: 19,
      maxZoom: 21,
      attribution: OSM_ATTRIBUTION,
    });
    const orto = L.tileLayer.wms(ORTO_WMS, {
      layers: "Raster",
      format: "image/jpeg",
      version: "1.3.0",
      maxZoom: 21,
      attribution: "Ortofotomapa &copy; GUGiK",
    });
    // Same layer set as the panel's kiegWmsUrl (old map parity — obreby kept).
    const egib = L.tileLayer.wms(KIEG_WMS, {
      layers: "dzialki,numery_dzialek,budynki,obreby",
      format: "image/png",
      transparent: true,
      version: "1.3.0",
      minZoom: EGIB_MIN_ZOOM,
      maxZoom: 21,
      attribution: "EGiB &copy; GUGiK",
    });
    osm.addTo(map);
    egib.addTo(map);
    osm.once("tileerror", () => setTilesFailed(true));
    const narrow =
      typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches;
    L.control
      .layers(
        { "Mapa (OpenStreetMap)": osm, "Ortofoto (GUGiK)": orto },
        { "Działki i budynki (EGiB)": egib },
        { collapsed: narrow },
      )
      .addTo(map);
    map.on("baselayerchange", (e) => {
      el.classList.toggle("smap--orto", e.layer === orto);
    });
    const rings = L.layerGroup().addTo(map);
    const dots = L.layerGroup().addTo(map);
    mapRef.current = map;
    ringsRef.current = rings;
    dotsRef.current = dots;
    const markers = markersRef.current;

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

  // View + radius rings + subject follow the centre / radius.
  useEffect(() => {
    const map = mapRef.current;
    const rings = ringsRef.current;
    if (!map || !rings) return;
    const c = L.latLng(centerLat, centerLng);
    rings.clearLayers();
    // All four steps: active solid, inner solid/thinner, outer thin/dashed/faded.
    for (const r of DEFAULTS.radiusStepsM) {
      const style = ringStyle(r, selection.radiusUsedM);
      L.circle(c, {
        radius: r,
        weight: style === "active" ? 2 : 1,
        dashArray: style === "outer" ? "4 4" : undefined,
        fill: false,
        interactive: false,
        className: `smap-ring smap-ring--${style}`,
      }).addTo(rings);
      L.tooltip({
        permanent: true,
        direction: "top",
        className: style === "outer" ? "smap-ring-label smap-ring-label--outer" : "smap-ring-label",
        offset: [0, 0],
        interactive: false,
      })
        .setLatLng([centerLat + r / M_PER_DEG_LAT, centerLng])
        .setContent(`${r} m`)
        .addTo(rings);
    }
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

  // Candidate dots follow the selection snapshot.
  useEffect(() => {
    const group = dotsRef.current;
    if (!group) return;
    const markers = markersRef.current;
    group.clearLayers();
    markers.clear();
    for (const d of buildDots(selection)) {
      markers.set(d.key, addDotMarker(d, toLatLng(d.pos), group, dotTooltip(d), onSelectRef));
    }
  }, [selection]);

  // Selected-row highlight. `selection` is a deliberate dependency: the dots
  // effect above rebuilds all markers on a new snapshot, so the selected
  // class must be re-applied to the freshly created elements.
  useEffect(() => {
    for (const [key, marker] of markersRef.current) {
      marker.getElement()?.classList.toggle("smap-dot--selected", key === selectedKey);
    }
  }, [selectedKey, selection]);

  const eff = effectiveSelection(selection);

  return (
    <>
      <figure
        className="relative aspect-square overflow-hidden rounded-lg border bg-muted"
        data-testid="sample-map"
      >
        <div
          ref={containerRef}
          className="smap absolute inset-0 h-full w-full"
          role="group"
          aria-label="Propozycje na mapie"
        />
        <figcaption className="absolute left-2 bottom-2 z-[1000] flex gap-3 rounded-md bg-background/90 px-2 py-1 text-xs">
          <span>
            <span style={{ color: FILL.proposed }}>●</span> w próbie {eff.proposed.length}
          </span>
          <span>
            <span style={{ color: FILL.alternate }}>●</span> alternatywy {eff.alternates.length}
          </span>
          <span>
            <span style={{ color: FILL.rejected }}>●</span> odrzucone {rejectedCensus(selection)}
          </span>
        </figcaption>
      </figure>
      <p className="text-sm text-muted-foreground">
        Mapa: OpenStreetMap · Ortofoto i działki: GUGiK (WMS) · kółko myszy przybliża, klik w kropkę
        podświetla wiersz i otwiera panel
        {tilesFailed ? " · tło mapy nie wczytało się — znaczniki i pierścienie działają" : null}
      </p>
    </>
  );
}

/**
 * One lokal as a divIcon dot. Clickable kinds get role/aria/keyboard;
 * rejected ones are hidden from assistive tech (native title only), exactly
 * as the old SVG map. Exported for Task 3 (spider legs reuse it).
 */
export function addDotMarker(
  d: Dot,
  latlng: L.LatLng,
  target: L.LayerGroup,
  tooltip: string,
  onSelectRef: { current: (key: string) => void },
  onSpider = false,
): L.Marker {
  const clickable = d.kind !== "rejected";
  const size = DOT_SIZE[d.kind];
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: `smap-dot smap-dot--${d.kind}${onSpider ? " smap-dot--spider" : ""}`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: "",
    }),
    interactive: clickable,
    keyboard: clickable,
    zIndexOffset: DOT_Z[d.kind] + (onSpider ? 1000 : 0),
    bubblingMouseEvents: false,
  }).addTo(target);
  const el = marker.getElement();
  if (el) {
    el.dataset.testid = `dot-${d.kind}`;
    el.dataset.key = d.key;
    if (clickable) {
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", dotAriaLabel(d));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          // preventDefault also suppresses the `keypress` Leaflet turns into
          // a synthetic click — one `onSelect` per key, not two.
          e.preventDefault();
          onSelectRef.current(d.key);
        }
      });
    } else {
      el.setAttribute("aria-hidden", "true");
      el.title = tooltip;
    }
  }
  if (clickable) {
    marker.bindTooltip(tooltip, { direction: "top", offset: [0, -size / 2] });
    marker.on("click", () => onSelectRef.current(d.key));
  }
  return marker;
}
