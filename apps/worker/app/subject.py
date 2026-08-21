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

from app.rcn import parse_address

# --- pure core -------------------------------------------------------------

_APARTMENT_RX = re.compile(r"(\d+[A-Za-z]?)/\w+$")


def normalize_uug_address(address: str) -> str:
    """Normalize a user-typed address into the shape the UUG geokoder accepts.

    Pinned live against the UUG geokoder 2026-07-17 (subject-proposal hotfix):
    city must come first, "ul."/"pl."/"al."/"os." prefixes are tolerated but
    optional, and an apartment suffix ("33/36") makes the lookup return no
    result. Reuses rcn.parse_address (Slice 2) for the city/street split and
    prefix strip, then strips the apartment part.
    """
    city, street = parse_address(address)
    street = _APARTMENT_RX.sub(r"\1", street)
    return f"{city}, {street}"


def suggestions_from_uug(payload: dict) -> list[dict]:
    """Map a UUG GetAddress payload to suggestion dicts, in UUG rank order.

    Only "street" and "address" result types feed the address combobox;
    "city" results are deliberately skipped (suggesting bare cities does not
    help the appraiser build a geocodable address). Shape pinned live in the
    2026-08-20 spike (tools/spike/2026-08-20-uug-podpowiedzi, wiki repo).
    """
    if payload.get("type") not in ("street", "address"):
        return []
    results = payload.get("results") or {}
    suggestions = []
    for key in sorted(results, key=int):
        entry = results[key]
        city, street = entry.get("city"), entry.get("street")
        if not city or not street:
            continue
        suggestions.append(
            {
                "city": city,
                "street": street,
                "number": entry.get("number"),
                "teryt": entry.get("teryt"),
            }
        )
    return suggestions


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


_FIELDS_BLOCK_RX = re.compile(r"<FIELDS>(.*?)</FIELDS>", re.DOTALL)


def building_from_xml(xml: str, building_id: str | None = None) -> dict | None:
    """Building fields for `building_id`, or (without one) the whole response
    flattened into one dict — see `building_ids_from_xml` for why that
    matters when a query box holds more than one building.

    A real GetFeatureInfo response wraps each feature in its own <FIELDS>
    block; when `building_id` is given, the block whose ID_BUDYNKU matches it
    is parsed alone, so the returned fields describe the SAME building as
    `meta.buildingId` (ADR-015). If no block matches — or none was requested,
    or the response has no <FIELDS> wrapper at all (single-building fixtures) —
    this falls back to flattening the whole xml, same as before.
    """
    source = xml
    if building_id is not None:
        for block in _FIELDS_BLOCK_RX.findall(xml):
            if f"<ID_BUDYNKU>{building_id}</ID_BUDYNKU>" in block:
                source = block
                break
    fields = parse_geopoz_fields(source)
    if not fields.get("ID_BUDYNKU"):
        return None
    return {
        "rodzaj": fields.get("RODZAJ", ""),
        "kondygnacje_nadziemne": _to_int(fields.get("KONDYGNACJE_NADZIEMNE")),
        "kondygnacje_podziemne": _to_int(fields.get("KONDYGNACJE_PODZIEMNE")),
    }


_BUILDING_ID_RX = re.compile(r"<ID_BUDYNKU>([^<]+)</ID_BUDYNKU>")


def building_ids_from_xml(xml: str) -> list[str]:
    """Every ID_BUDYNKU in the GetFeatureInfo response, in document order.

    `building_from_xml` flattens the whole response into one dict via
    `parse_geopoz_fields` (last block wins) unless given the building id to
    select one block; a real response within the ±50 m query box can list up
    to FEATURE_COUNT=10 buildings (`fetch_egib_xml`), so ranking the
    subject's building needs all of them, not just the first.
    """
    return [m.strip() for m in _BUILDING_ID_RX.findall(xml)]


def pick_building_id(ids: list[str], parcel_id: str | None) -> str | None:
    """Pick the building on the subject's own ULDK parcel, else the first hit.

    ID_BUDYNKU is prefixed with the parcel id it sits on (e.g.
    "306401_1.0021.AR_10.161.1_BUD" on parcel "306401_1.0021.AR_10.161"), so
    a "startswith(parcel_id + '.')" match identifies the subject's building
    among neighbours returned by the ±50 m query box. Spike A found the UUG
    geocoded point lands on a neighbouring parcel for ~40% of addresses, so
    that match is not guaranteed — falling back to the first hit still gives
    web step 3 a usable ranking signal instead of silently returning nothing.
    """
    if parcel_id:
        for building_id in ids:
            if building_id.startswith(f"{parcel_id}."):
                return building_id
    return ids[0] if ids else None


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


# The ONE place that says how far the app reaches. Widening coverage later means
# changing this prefix (or turning it into a list) — nothing else (decision 2026-08-20).
COVERAGE_TERYT_PREFIX = "3064"  # powiat Poznań (gmina 306401)


def is_poznan(teryt: str | None) -> bool:
    """Coverage gate: subject data, address suggestions and operat maps stop at this TERYT prefix."""
    return bool(teryt) and teryt.startswith(COVERAGE_TERYT_PREFIX)


# --- I/O boundary (verbatim endpoints from the 2026-07-17 spike) ------------

GEOKODER_URL = "https://services.gugik.gov.pl/uug/"
ULDK_URL = "https://uldk.gugik.gov.pl/"
GEOPOZ_WMS_URL = "https://portal.geopoz.poznan.pl/wmsegib"
GEOPOZ_WFS_URL = "https://sip.poznan.pl/geoserver/ows"
PLANS_URL = "https://www.poznan.pl/mim/plan/map_service.html?mtype=urban_planning&co=mpzp"
HEADERS = {"User-Agent": "wyceny-worker/1.0", "X-Requested-With": "XMLHttpRequest"}
PLANS_CACHE_TTL_S = 3600.0  # ponytail: module-level cache; plans layer ~1 s and changes rarely

_plans_cache: tuple[float, dict] | None = None


def _get(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


class AddressNotFound(RuntimeError):
    """The geocoder answered, and the answer was "no such address".

    Distinct from a transport/service failure ON PURPOSE: this one is not
    retryable, and telling the appraiser to "try again" sends them into a loop
    that cannot end. Only correcting the address can.
    """


def suggest_addresses(query: str) -> list[dict]:
    """Ask UUG for street/address candidates matching a partial user input.

    Timeout is 5 s, not 30 — this feeds a debounced combobox, a hanging
    geocoder must not hold the field hostage. UUG answers plain text
    ("Blad zapytania.") for queries it dislikes; that is an empty list here,
    not an error (incident 3d23717d turned exactly that into a 502).
    """
    normalized = normalize_uug_address(query)
    url = (
        GEOKODER_URL
        + "?"
        + urllib.parse.urlencode({"request": "GetAddress", "address": normalized})
    )
    try:
        payload = json.loads(_get(url, timeout=5))
    except json.JSONDecodeError:
        return []
    return suggestions_from_uug(payload)


def geocode_address(address: str) -> dict:
    query = normalize_uug_address(address)
    url = GEOKODER_URL + "?" + urllib.parse.urlencode({"request": "GetAddress", "address": query})
    results = json.loads(_get(url)).get("results") or {}
    first = results.get("1")
    if not first:
        raise AddressNotFound(f"Geokoder UUG nic nie znalazl: {address}")
    return {"x": float(first["x"]), "y": float(first["y"]), "teryt": first.get("teryt")}


def fetch_parcel_by_xy(x: float, y: float) -> dict:
    url = (
        ULDK_URL
        + "?"
        + urllib.parse.urlencode(
            {"request": "GetParcelByXY", "xy": f"{x},{y},2180", "result": "id,region,parcel"}
        )
    )
    lines = _get(url).strip().splitlines()
    if not lines or lines[0] != "0" or len(lines) < 2:
        raise RuntimeError(f"ULDK nie znalazl dzialki dla punktu {x},{y}")
    parts = lines[1].split("|")
    return {"parcel_id": parts[0]}


def fetch_parcel_wkt(parcel_id: str, srid: int) -> str:
    url = (
        ULDK_URL
        + "?"
        + urllib.parse.urlencode(
            {"request": "GetParcelById", "id": parcel_id, "result": "geom_wkt", "srid": str(srid)}
        )
    )
    raw = _get(url).strip()
    match = re.search(r"(MULTIPOLYGON\s*\(.*\)|POLYGON\s*\(\(.*\)\))", raw, re.DOTALL)
    if not match:
        raise RuntimeError(f"ULDK nie zwrocil geometrii dzialki {parcel_id}")
    return match.group(1)


def fetch_egib_xml(layer: str, x: float, y: float) -> str:
    half = 50.0
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetFeatureInfo",
        "LAYERS": layer,
        "QUERY_LAYERS": layer,
        "CRS": "EPSG:2180",
        # WMS 1.3.0 + EPSG:2180 axis order is (northing, easting) -> y before x
        "BBOX": f"{y - half},{x - half},{y + half},{x + half}",
        "WIDTH": "256",
        "HEIGHT": "256",
        "I": "128",
        "J": "128",
        "INFO_FORMAT": "text/xml",
        "FEATURE_COUNT": "10",
    }
    return _get(GEOPOZ_WMS_URL + "?" + urllib.parse.urlencode(params))


def fetch_mpzp_functions(parcel_wkt_2180: str) -> dict:
    minx, miny, maxx, maxy = shapely_wkt.loads(parcel_wkt_2180).bounds
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": "mpzp_poznan:mpzp_funkcje",
        "srsName": "EPSG:2180",
        "bbox": f"{minx},{miny},{maxx},{maxy},EPSG:2180",
        "outputFormat": "application/json",
        "count": "50",
    }
    return json.loads(_get(GEOPOZ_WFS_URL + "?" + urllib.parse.urlencode(params)))


def centroid_4326(parcel_wkt_4326: str) -> tuple[float, float]:
    centroid = shapely_wkt.loads(parcel_wkt_4326).centroid
    return centroid.x, centroid.y


def nominatim_to_2180(lat: float, lon: float) -> tuple[float, float]:
    """Nominatim speaks WGS84; everything downstream is EPSG:2180. ULDK converts for free:
    parcel under the WGS84 point -> its geometry in 2180 -> centroid. No pyproj dependency.
    """
    body = _get(f"{ULDK_URL}?request=GetParcelByXY&xy={lon},{lat},4326&result=id")
    lines = body.strip().splitlines()
    if not lines or lines[0].strip() != "0" or len(lines) < 2:
        raise AddressNotFound(f"ULDK nie zna działki pod punktem Nominatim: {body[:80]}")
    pt = shapely_wkt.loads(fetch_parcel_wkt(lines[1].strip(), 2180)).centroid
    return (pt.x, pt.y)


def fetch_plans() -> dict:
    global _plans_cache
    now = time.monotonic()
    if _plans_cache and now - _plans_cache[0] < PLANS_CACHE_TTL_S:
        return _plans_cache[1]
    data = json.loads(_get(PLANS_URL))
    _plans_cache = (now, data)
    return data
