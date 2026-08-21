"use client";

import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./sample-map-leaflet.css";
import { plural } from "@/components/wizard/plural";
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
  /** Unknown for `RejectedRow`s (the compact shape carries no floor). */
  floor: number | null;
};

const DOT_SIZE: Record<DotKind, number> = { proposed: 14, alternate: 11, rejected: 9 };
const DOT_Z: Record<DotKind, number> = { proposed: 300, alternate: 200, rejected: 100 };
// Same literals as `sample-map.tsx` (brand teal / muted grey / destructive red).
const FILL: Record<DotKind, string> = {
  proposed: "#1f7a5c",
  alternate: "#9a978f",
  rejected: "#e7000b",
};
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
      floor?: number | null;
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
      floor: row.floor ?? null,
    });
  };
  for (const r of snap.rejected ?? []) push(r, candidateKey(r), "rejected");
  for (const c of eff.removed) push(c, candidateKey(c), "rejected");
  for (const c of eff.alternates) push(c, candidateKey(c), "alternate");
  for (const c of eff.proposed) push(c, candidateKey(c), "proposed");
  return dots;
}

/**
 * Dots grouped by EXACT `pos` (several lokale of one building share the
 * building's centroid from EGiB), insertion order kept. A group of one is a
 * plain dot; a bigger group becomes one BUILDING marker that spiderfies on
 * click (team-lead feedback 2026-08-21: a fixed pixel ring, as `map-dots.ts`
 * does, still leaves lokale unclickable at max zoom).
 */
function groupByPos(dots: Dot[]): Map<string, Dot[]> {
  const groups = new Map<string, Dot[]>();
  for (const d of dots) {
    const posKey = `${d.pos.x},${d.pos.y}`;
    const g = groups.get(posKey);
    if (g) g.push(d);
    else groups.set(posKey, [d]);
  }
  return groups;
}

/** Best status of a building: any proposed → proposed, else any alternate → alternate, else rejected. */
function bestKind(dots: Dot[]): DotKind {
  if (dots.some((d) => d.kind === "proposed")) return "proposed";
  if (dots.some((d) => d.kind === "alternate")) return "alternate";
  return "rejected";
}

/** "5 propozycji: 3 w próbie · 1 alternatywa · 1 odrzucona" */
function buildingSummary(dots: Dot[]): string {
  const n = dots.length;
  const a = dots.filter((d) => d.kind === "proposed").length;
  const b = dots.filter((d) => d.kind === "alternate").length;
  const c = n - a - b;
  return `${n} ${plural(n, "propozycja", "propozycje", "propozycji")}: ${a} w próbie · ${b} ${plural(b, "alternatywa", "alternatywy", "alternatyw")} · ${c} ${plural(c, "odrzucona", "odrzucone", "odrzuconych")}`;
}

/** "2026-05 · 7505 zł/m² · p. 2" for a lokal on a spider leg — month, not day, the building is the context. */
function spiderTooltip(d: Dot): string {
  const floor = d.floor == null ? "" : ` · p. ${d.floor}`;
  return `${d.date.slice(0, 7)} · ${priceFmt.format(Math.round(d.pricePerM2))} zł/m²${floor}`;
}

/** Spider leg length (px): base + per-lokal growth so 12 legs still leave the dots apart. */
const SPIDER_BASE_PX = 26;
const SPIDER_STEP_PX = 3;

type Building = { marker: L.Marker; latlng: L.LatLng; dots: Dot[]; keys: string[] };
type SpiderState = {
  posKey: string | null;
  layer: L.LayerGroup;
  open: (posKey: string) => void;
  close: () => void;
  relayout: () => void;
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
  const buildingsRef = useRef<Map<string, Building>>(new Map());
  const spiderRef = useRef<SpiderState>({
    posKey: null,
    layer: L.layerGroup(),
    open: () => {},
    close: () => {},
    relayout: () => {},
  });
  const applyHighlightRef = useRef<() => void>(() => {});
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
    const buildings = buildingsRef.current;
    const spider = spiderRef.current;
    spider.layer.addTo(map);
    // A click on the map background folds an open spider; a zoom re-lays it
    // out (legs are pixel-length, so their lat/lng ends move with the zoom).
    map.on("click", () => spider.close());
    map.on("zoomend", () => spider.relayout());
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") spider.close();
    };
    el.addEventListener("keydown", onKeyDown);
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

  // Candidate markers follow the selection snapshot: a plain dot for a lokal
  // alone at its coordinate, ONE building marker (badge = count, colour =
  // best status) for several lokale sharing it; click/Enter on the building
  // spiderfies them onto legs, each lokal its own clickable dot.
  useEffect(() => {
    const map = mapRef.current;
    const group = dotsRef.current;
    if (!map || !group) return;
    const markers = markersRef.current;
    const buildings = buildingsRef.current;
    const spider = spiderRef.current;

    const addDotMarker = (
      d: Dot,
      latlng: L.LatLng,
      target: L.LayerGroup,
      tooltip: string,
      onSpider: boolean,
    ): L.Marker => {
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
          el.title = tooltip;
        }
      }
      if (clickable) {
        marker.bindTooltip(tooltip, { direction: "top", offset: [0, -size / 2] });
        marker.on("click", () => onSelectRef.current(d.key));
      }
      return marker;
    };

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

    const spiderfy = (posKey: string) => {
      const b = buildings.get(posKey);
      if (!b) return;
      unspiderfy();
      spider.posKey = posKey;
      const el = b.marker.getElement();
      el?.classList.add("smap-bld--open");
      if (el?.getAttribute("role") === "button") el.setAttribute("aria-expanded", "true");
      const center = map.latLngToLayerPoint(b.latlng);
      const n = b.dots.length;
      const r = SPIDER_BASE_PX + SPIDER_STEP_PX * n;
      b.dots.forEach((d, i) => {
        // Start at 12 o'clock, clockwise — the table's order is the ranking,
        // so the first lokal sits on top.
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const ll = map.layerPointToLatLng(
          center.add(L.point(r * Math.cos(angle), r * Math.sin(angle))),
        );
        L.polyline([b.latlng, ll], {
          className: "smap-leg",
          weight: 1.5,
          interactive: false,
        }).addTo(spider.layer);
        markers.set(d.key, addDotMarker(d, ll, spider.layer, spiderTooltip(d), true));
      });
      applyHighlightRef.current();
    };

    const addBuildingMarker = (dots: Dot[]) => {
      const d0 = dots[0];
      const posKey = `${d0.pos.x},${d0.pos.y}`;
      const kind = bestKind(dots);
      const clickable = kind !== "rejected";
      const latlng = toLatLng(d0.pos);
      const summary = buildingSummary(dots);
      const toggle = () => (spider.posKey === posKey ? unspiderfy() : spiderfy(posKey));
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
        el.dataset.posKey = posKey;
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
      buildings.set(posKey, { marker, latlng, dots, keys: dots.map((d) => d.key) });
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
    for (const dots of groupByPos(buildDots(selection)).values()) {
      if (dots.length === 1) {
        const d = dots[0];
        markers.set(d.key, addDotMarker(d, toLatLng(d.pos), group, dotTooltip(d), false));
      } else {
        addBuildingMarker(dots);
      }
    }
  }, [selection]);

  // Selected-row highlight: the dot itself, its building (and the building
  // auto-spiderfies so the lokal is visible), and its siblings as "kin".
  useEffect(() => {
    const apply = () => {
      for (const [key, marker] of markersRef.current) {
        marker.getElement()?.classList.toggle("smap-dot--selected", key === selectedKey);
      }
      for (const [posKey, b] of buildingsRef.current) {
        const hit = selectedKey !== null && b.keys.includes(selectedKey);
        b.marker.getElement()?.classList.toggle("smap-dot--selected", hit);
        for (const k of b.keys) {
          if (k !== selectedKey) {
            markersRef.current.get(k)?.getElement()?.classList.toggle("smap-dot--kin", hit);
          }
        }
        if (hit && spiderRef.current.posKey !== posKey) spiderRef.current.open(posKey);
      }
    };
    applyHighlightRef.current = apply;
    apply();
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
