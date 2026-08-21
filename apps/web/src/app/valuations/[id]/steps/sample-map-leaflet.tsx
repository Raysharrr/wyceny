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
  bestKind,
  buildDots,
  buildingSummary,
  dotAriaLabel,
  dotTooltip,
  groupByPos,
  rejectedCensus,
  ringStyle,
  spiderOffsets,
  spiderTooltip,
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

type Building = { marker: L.Marker; latlng: L.LatLng; dots: Dot[]; keys: string[] };
// Mutable record: the mount effect's map handlers read `open/close/relayout`
// at call time, the markers effect reassigns them on every snapshot.
type SpiderState = {
  posKey: string | null;
  layer: L.LayerGroup;
  open: (posKey: string) => void;
  close: () => void;
  relayout: () => void;
};

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
  const buildingsRef = useRef<Map<string, Building>>(new Map());
  const spiderRef = useRef<SpiderState>({
    posKey: null,
    layer: L.layerGroup(),
    open: () => {},
    close: () => {},
    relayout: () => {},
  });
  const applyHighlightRef = useRef<() => void>(() => {});
  // The initial view: `fitBounds` needs a non-zero container size, which the
  // container may not have yet (e.g. a hidden tab). If the `setView` fallback
  // ran instead, `fittedRef` stays false so the ResizeObserver can retry once
  // the container actually gains a size.
  const viewRef = useRef<{ c: L.LatLng; halfM: number } | null>(null);
  const fittedRef = useRef(false);
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
    // Not cleared on `load` — Leaflet fires it once ALL tiles settle, errors
    // included, so it would clear the banner in the all-tiles-failed case.
    for (const layer of [osm, orto, egib]) {
      layer.on("tileerror", () => setTilesFailed(true));
    }
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
      setTilesFailed(false);
    });
    const rings = L.layerGroup().addTo(map);
    const dots = L.layerGroup().addTo(map);
    mapRef.current = map;
    ringsRef.current = rings;
    dotsRef.current = dots;
    const markers = markersRef.current;
    const buildings = buildingsRef.current;
    const spider = spiderRef.current;
    spider.layer.addTo(map);
    // A click on the map background folds an open spider; a zoom re-lays it out
    // (legs are pixel-length, so their lat/lng ends move with the zoom).
    map.on("click", () => spider.close());
    map.on("zoomend", () => spider.relayout());
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") spider.close();
    };
    el.addEventListener("keydown", onKeyDown);

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            map.invalidateSize();
            // Retry the initial fit once the container actually has a size —
            // the mount may have happened while it was still zero-sized.
            if (!fittedRef.current && viewRef.current) {
              const size = map.getSize();
              if (size.x > 0 && size.y > 0) {
                map.fitBounds(viewRef.current.c.toBounds(2 * viewRef.current.halfM), {
                  animate: false,
                });
                fittedRef.current = true;
              }
            }
          })
        : null;
    ro?.observe(el);

    return () => {
      ro?.disconnect();
      el.removeEventListener("keydown", onKeyDown);
      map.remove();
      mapRef.current = null;
      ringsRef.current = null;
      dotsRef.current = null;
      markers.clear();
      buildings.clear();
      spider.posKey = null;
      spider.layer = L.layerGroup();
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
    viewRef.current = { c, halfM };
    const size = map.getSize();
    if (size.x > 0 && size.y > 0) {
      map.fitBounds(c.toBounds(2 * halfM), { animate: false });
      fittedRef.current = true;
    } else {
      map.setView(c, 15, { animate: false });
      fittedRef.current = false;
    }
  }, [centerLat, centerLng, halfM, selection.radiusUsedM]);

  // Markers follow the snapshot: a plain dot for a lokal alone at its
  // coordinate, ONE building marker (badge = count, colour = best status) for
  // several lokale sharing it; click/Enter on the building spiderfies them onto
  // legs, each lokal its own clickable dot.
  useEffect(() => {
    const map = mapRef.current;
    const group = dotsRef.current;
    if (!map || !group) return;
    const markers = markersRef.current;
    const buildings = buildingsRef.current;
    const spider = spiderRef.current;

    const unspiderfy = () => {
      const open = spider.posKey ? buildings.get(spider.posKey) : null;
      spider.layer.clearLayers();
      if (open) {
        for (const k of open.keys) markers.delete(k);
        const el = open.marker.getElement();
        el?.classList.remove("smap-bld--open");
        if (el?.getAttribute("role") === "button") el.setAttribute("aria-expanded", "false");
      }
      spider.posKey = null;
    };

    const spiderfy = (key: string) => {
      const b = buildings.get(key);
      if (!b) return;
      unspiderfy();
      spider.posKey = key;
      const el = b.marker.getElement();
      el?.classList.add("smap-bld--open");
      if (el?.getAttribute("role") === "button") el.setAttribute("aria-expanded", "true");
      const origin = map.latLngToLayerPoint(b.latlng);
      const offsets = spiderOffsets(b.dots.length);
      b.dots.forEach((d, i) => {
        const ll = map.layerPointToLatLng(origin.add(L.point(offsets[i].dx, offsets[i].dy)));
        L.polyline([b.latlng, ll], {
          className: "smap-leg",
          weight: 1.5,
          interactive: false,
        }).addTo(spider.layer);
        markers.set(d.key, addDotMarker(d, ll, spider.layer, spiderTooltip(d), onSelectRef, true));
      });
      applyHighlightRef.current();
    };

    const addBuildingMarker = (key: string, dots: Dot[]) => {
      const kind = bestKind(dots);
      const clickable = kind !== "rejected";
      const latlng = toLatLng(dots[0].pos);
      const summary = buildingSummary(dots);
      const toggle = () => (spider.posKey === key ? unspiderfy() : spiderfy(key));
      const marker = L.marker(latlng, {
        icon: L.divIcon({
          className: `smap-bld smap-bld--${kind}`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          html: `<span class="smap-bld-badge">${dots.length}</span>`,
        }),
        interactive: clickable,
        keyboard: clickable,
        zIndexOffset: DOT_Z[kind] + 50,
        bubblingMouseEvents: false,
      }).addTo(group);
      const el = marker.getElement();
      if (el) {
        el.dataset.testid = `building-${kind}`;
        el.dataset.posKey = key;
        if (clickable) {
          el.setAttribute("role", "button");
          el.setAttribute("aria-label", `budynek: ${summary}`);
          el.setAttribute("aria-expanded", "false");
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          });
        } else {
          el.setAttribute("aria-hidden", "true");
          el.title = summary;
        }
      }
      if (clickable) {
        marker.bindTooltip(summary, { direction: "top", offset: [0, -12] });
        marker.on("click", toggle);
      }
      buildings.set(key, { marker, latlng, dots, keys: dots.map((d) => d.key) });
    };

    unspiderfy();
    group.clearLayers();
    markers.clear();
    buildings.clear();
    spider.open = spiderfy;
    spider.close = unspiderfy;
    spider.relayout = () => {
      if (spider.posKey) spiderfy(spider.posKey);
    };
    for (const [key, dots] of groupByPos(buildDots(selection))) {
      if (dots.length === 1) {
        const d = dots[0];
        markers.set(d.key, addDotMarker(d, toLatLng(d.pos), group, dotTooltip(d), onSelectRef));
      } else {
        addBuildingMarker(key, dots);
      }
    }
  }, [selection]);

  // Selected-row highlight: the dot itself, its building and its siblings as
  // "kin". Only CLASS PAINTING goes on the ref (`spiderfy` calls it back after
  // laying out legs); the auto-open of the selected lokal's building stays in
  // the effect body — if it lived in the callback, opening ANY other building
  // would immediately snap the spider back to the selected one (final review).
  useEffect(() => {
    const applyClasses = () => {
      for (const [key, marker] of markersRef.current) {
        marker.getElement()?.classList.toggle("smap-dot--selected", key === selectedKey);
      }
      for (const b of buildingsRef.current.values()) {
        const hit = selectedKey !== null && b.keys.includes(selectedKey);
        b.marker.getElement()?.classList.toggle("smap-dot--selected", hit);
        for (const k of b.keys) {
          // Visit EVERY key (also the selected one) so a stale kin class from an
          // earlier selection is cleared — `.smap-dot--kin` would override `--selected`.
          markersRef.current
            .get(k)
            ?.getElement()
            ?.classList.toggle("smap-dot--kin", hit && k !== selectedKey);
        }
      }
    };
    applyHighlightRef.current = applyClasses;
    applyClasses();
    if (selectedKey !== null) {
      for (const [key, b] of buildingsRef.current) {
        if (b.keys.includes(selectedKey) && spiderRef.current.posKey !== key) {
          spiderRef.current.open(key); // → spiderfy → applyClasses paints the legs
          break;
        }
      }
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
        Mapa: OpenStreetMap · Ortofoto i działki: GUGiK (WMS) · kółko myszy przybliża · znacznik z
        liczbą = kilka lokali w jednym budynku, klik rozkłada je wokół · klik w kropkę podświetla
        wiersz i otwiera panel
        {tilesFailed ? " · tło mapy nie wczytało się — znaczniki i pierścienie działają" : null}
      </p>
    </>
  );
}

/**
 * One lokal as a divIcon dot. Clickable kinds get role/aria/keyboard;
 * rejected ones are hidden from assistive tech (native title only), exactly
 * as the old SVG map. Reused for spider legs (onSpider=true).
 */
function addDotMarker(
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
