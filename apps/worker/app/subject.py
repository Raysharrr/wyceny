"""EGiB/MPZP subject-data: pure core (parsers, geometry selection) + I/O boundary.

Pure part: zero network, zero clock. I/O functions live at the bottom of this
module (endpoint tests monkeypatch them on the module object), mirroring rcn.py.

Ported from the validated spikes (wiki repo):
- tools/spike/2026-07-17-egib-mpzp/ — live re-validation 2026-07-17, endpoints/fields verbatim
- tools/spike/2026-06-05-zrodla-danych-przedmiotu/mpzp_resolver.py — max-overlap
  plan-function selection (Koscielna -> 4MW/U at 100%)

Data traps pinned by the spikes:
- GEOPOZ WMS 1.3.0 + EPSG:2180: axis order is (northing, easting) -> BBOX = y,x pairs.
- GEOPOZ building layer has NO construction year (verified via full field dump).
- National MPZP service does not cover Poznan; ~half of Poznan has no MPZP at all —
  an empty WFS result is a valid answer ("no plan"), not an error.
"""

import json
import re
import time
import urllib.parse
import urllib.request

from shapely import wkt as shapely_wkt
from shapely.geometry import Point, shape

# --- pure core -------------------------------------------------------------

GEOPOZ_FIELD_RX = re.compile(r"<([A-Z_][A-Z0-9_]*)>([^<]*)</\1>")


def parse_geopoz_fields(xml: str) -> dict[str, str]:
    """Flat dump of <TAG>value</TAG> pairs from a GEOPOZ GetFeatureInfo response."""
    out = {}
    for match in GEOPOZ_FIELD_RX.finditer(xml):
        value = match.group(2).strip()
        if value:
            out[match.group(1)] = value
    return out


def _to_float(value: str | None) -> float | None:
    try:
        return float(value) if value else None
    except ValueError:
        return None


def _to_int(value: str | None) -> int | None:
    try:
        return int(value) if value else None
    except ValueError:
        return None


def parcel_from_xml(xml: str) -> dict | None:
    fields = parse_geopoz_fields(xml)
    if not fields.get("NUMER_DZIALKI"):
        return None
    return {
        "parcel_id": fields.get("ID_DZIALKI", ""),
        "obreb": fields.get("NAZWA_OBREBU", "").title(),
        "arkusz": fields.get("NUMER_ARKUSZA", ""),
        "nr_dzialki": fields.get("NUMER_DZIALKI", ""),
        "pow_ewid_ha": _to_float(fields.get("POLE_EWIDENCYJNE")),
        "uzytek": fields.get("KLASOUZYTKI_EGIB", ""),
    }


def building_from_xml(xml: str) -> dict | None:
    fields = parse_geopoz_fields(xml)
    if not fields.get("ID_BUDYNKU"):
        return None
    return {
        "rodzaj": fields.get("RODZAJ", ""),
        "kondygnacje_nadziemne": _to_int(fields.get("KONDYGNACJE_NADZIEMNE")),
        "kondygnacje_podziemne": _to_int(fields.get("KONDYGNACJE_PODZIEMNE")),
    }


def pick_mpzp_function(parcel_wkt_2180: str, functions_geojson: dict) -> dict | None:
    """Pick the plan function with max area overlap with the parcel (spike-proven)."""
    parcel = shapely_wkt.loads(parcel_wkt_2180)
    best, best_area = None, 0.0
    for feature in functions_geojson.get("features", []):
        geometry = feature.get("geometry")
        if not geometry:
            continue
        overlap = parcel.intersection(shape(geometry)).area
        if overlap > best_area:
            best, best_area = feature.get("properties", {}), overlap
    if best is None:
        return None
    return {"symbol": best.get("FUNKCJA") or "", "grupa": best.get("GRUPA") or ""}


def pick_plan(lon: float, lat: float, plans_geojson: dict) -> dict | None:
    """Point-in-polygon on the city plans layer (EPSG:4326)."""
    point = Point(lon, lat)
    for feature in plans_geojson.get("features", []):
        geometry = feature.get("geometry")
        if geometry and shape(geometry).contains(point):
            props = feature.get("properties", {})
            return {
                "nazwa": props.get("nazwa") or "",
                "uchwala": props.get("uchw_zatw") or "",
                "data": props.get("data_zatw") or "",
                "publ": props.get("publ_dz_urz") or "",
            }
    return None


def is_poznan(teryt: str | None) -> bool:
    """Poznan city TERYT prefix (gmina 306401 -> powiat 3064). MVP coverage gate."""
    return bool(teryt) and teryt.startswith("3064")


# --- I/O boundary (verbatim endpoints from the 2026-07-17 spike) ------------

GEOKODER_URL = "https://services.gugik.gov.pl/uug/"
ULDK_URL = "https://uldk.gugik.gov.pl/"
GEOPOZ_WMS_URL = "https://portal.geopoz.poznan.pl/wmsegib"
GEOPOZ_WFS_URL = "https://sip.poznan.pl/geoserver/ows"
PLANS_URL = "https://www.poznan.pl/mim/plan/map_service.html?mtype=urban_planning&co=mpzp"
HEADERS = {"User-Agent": "wyceny-worker/1.0", "X-Requested-With": "XMLHttpRequest"}
PLANS_CACHE_TTL_S = 3600.0  # ponytail: module-level cache; plans layer ~1 s and changes rarely

_plans_cache: tuple[float, dict] | None = None


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "replace")


def geocode_address(address: str) -> dict:
    url = GEOKODER_URL + "?" + urllib.parse.urlencode({"request": "GetAddress", "address": address})
    results = json.loads(_get(url)).get("results") or {}
    first = results.get("1")
    if not first:
        raise RuntimeError(f"Geokoder UUG nic nie znalazl: {address}")
    return {"x": float(first["x"]), "y": float(first["y"]), "teryt": first.get("teryt")}


def fetch_parcel_by_xy(x: float, y: float) -> dict:
    url = ULDK_URL + "?" + urllib.parse.urlencode(
        {"request": "GetParcelByXY", "xy": f"{x},{y},2180", "result": "id,region,parcel"}
    )
    lines = _get(url).strip().splitlines()
    if not lines or lines[0] != "0" or len(lines) < 2:
        raise RuntimeError(f"ULDK nie znalazl dzialki dla punktu {x},{y}")
    parts = lines[1].split("|")
    return {"parcel_id": parts[0]}


def fetch_parcel_wkt(parcel_id: str, srid: int) -> str:
    url = ULDK_URL + "?" + urllib.parse.urlencode(
        {"request": "GetParcelById", "id": parcel_id, "result": "geom_wkt", "srid": str(srid)}
    )
    raw = _get(url).strip()
    match = re.search(r"(MULTIPOLYGON\s*\(.*\)|POLYGON\s*\(\(.*\)\))", raw, re.DOTALL)
    if not match:
        raise RuntimeError(f"ULDK nie zwrocil geometrii dzialki {parcel_id}")
    return match.group(1)


def fetch_egib_xml(layer: str, x: float, y: float) -> str:
    half = 50.0
    params = {
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetFeatureInfo",
        "LAYERS": layer, "QUERY_LAYERS": layer, "CRS": "EPSG:2180",
        # WMS 1.3.0 + EPSG:2180 axis order is (northing, easting) -> y before x
        "BBOX": f"{y - half},{x - half},{y + half},{x + half}",
        "WIDTH": "256", "HEIGHT": "256", "I": "128", "J": "128",
        "INFO_FORMAT": "text/xml", "FEATURE_COUNT": "10",
    }
    return _get(GEOPOZ_WMS_URL + "?" + urllib.parse.urlencode(params))


def fetch_mpzp_functions(parcel_wkt_2180: str) -> dict:
    minx, miny, maxx, maxy = shapely_wkt.loads(parcel_wkt_2180).bounds
    params = {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": "mpzp_poznan:mpzp_funkcje", "srsName": "EPSG:2180",
        "bbox": f"{minx},{miny},{maxx},{maxy},EPSG:2180",
        "outputFormat": "application/json", "count": "50",
    }
    return json.loads(_get(GEOPOZ_WFS_URL + "?" + urllib.parse.urlencode(params)))


def centroid_4326(parcel_wkt_4326: str) -> tuple[float, float]:
    centroid = shapely_wkt.loads(parcel_wkt_4326).centroid
    return centroid.x, centroid.y


def fetch_plans() -> dict:
    global _plans_cache
    now = time.monotonic()
    if _plans_cache and now - _plans_cache[0] < PLANS_CACHE_TTL_S:
        return _plans_cache[1]
    data = json.loads(_get(PLANS_URL))
    _plans_cache = (now, data)
    return data
