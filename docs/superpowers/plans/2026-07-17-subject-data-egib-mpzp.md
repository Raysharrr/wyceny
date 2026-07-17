# Subject Data EGiB/MPZP (Slice 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After typing an address (Poznań), the form auto-fetches parcel/building/MPZP data from public registries via the worker; fields carry `to_verify` provenance gated by F-4; operat sections 8.2 and 9 render real data (both MPZP variants).

**Architecture:** Mirror of the RCN slice: worker `POST /subject-proposal` (pure core `subject.py` + urllib I/O, shapely for polygon selection) → web port/adapter/server-action → auto-fetch on address blur with a status bar and hard section reset → snapshot in `inputs.subject`/`inputs.subjectMeta` (write-once jsonb, NO DDL migration) → group provenance `ewidencja`/`mpzp` in `approvalGate` → new placeholders in the template via `build_template.py` regeneration → `buildDocumentModel` + F-12 extended.

**Tech Stack:** FastAPI + urllib + shapely (worker), Next.js Server Actions + react-hook-form + zod (web), docxtemplater (angular-expressions parser), drizzle jsonb.

**Spec:** `docs/superpowers/specs/2026-07-17-subject-data-egib-mpzp-design.md` (decisions 1–10 binding).
**Spike (endpoints, fields, latencies — verbatim source of truth):** wiki repo `tools/spike/2026-07-17-egib-mpzp/RAPORT.md`.

## Global Constraints

- Code + commits in ENGLISH (conventional commits, ≤100 chars, lowercase-leading subject). UI copy and operat content in POLISH with full diacritics.
- Zero network in tests/CI. Worker tests: in-code fixtures (strings/dicts — repo convention, NO fixture files on disk). Endpoint tests: `TestClient` + `monkeypatch.setattr(subject, "<fn>", ...)`.
- F-11: worker returns data, never WR. Assert `'"wr"' not in r.text.lower()` in endpoint tests.
- F-9: no `\b[0-9]{11}\b` (PESEL) and no `[A-Z]{2}[0-9][A-Z]/[0-9]{8}/[0-9]` (KW) anywhere in fixtures/code (`scripts/check-no-pii.sh` scans tracked files).
- NBSP always as escape ` ` (TS) — never a literal invisible char.
- Template regenerated ONLY by `build_template.py` (wiki repo `tools/spike/2026-07-15-template-koscielna/`). Never hand-edit `.docx`.
- Worker gates per task: `cd apps/worker && uv run ruff check . && uv run pytest -q` (pytest without LibreOffice skips convert tests — fine; full run needs `SOFFICE=/Applications/LibreOffice.app/Contents/MacOS/soffice`).
- Web gates per task: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` from repo root.
- Every task: commit → push to main → `gh run watch --exit-status`.
- Python 3.12, deps via `pyproject.toml` + `uv lock`. Worker HTTP = synchronous `urllib.request`, `timeout=30`, User-Agent always set (httpx is dev-only).
- Domain files (`apps/web/src/domain/*`) import NO adapters/I/O (F-10, enforced by depcruise).

---

### Task 1: Worker pure core `subject.py` (parsers + geometry selection)

**Files:**

- Create: `apps/worker/app/subject.py`
- Create: `apps/worker/tests/test_subject_core.py`
- Modify: `apps/worker/pyproject.toml` (add `shapely>=2.0`)

**Interfaces:**

- Consumes: nothing (pure).
- Produces (used by Task 2): `parse_geopoz_fields(xml: str) -> dict[str, str]`, `parcel_from_xml(xml: str) -> dict | None` (keys: `parcel_id, obreb, arkusz, nr_dzialki, pow_ewid_ha (float|None), uzytek`), `building_from_xml(xml: str) -> dict | None` (keys: `rodzaj, kondygnacje_nadziemne (int|None), kondygnacje_podziemne (int|None)`), `pick_mpzp_function(parcel_wkt_2180: str, functions_geojson: dict) -> dict | None` (keys: `symbol, grupa`), `pick_plan(lon: float, lat: float, plans_geojson: dict) -> dict | None` (keys: `nazwa, uchwala, data, publ`), `is_poznan(teryt: str | None) -> bool`.

- [ ] **Step 1: Add shapely dependency**

In `apps/worker/pyproject.toml` `[project].dependencies` add `"shapely>=2.0"`, then:

```bash
cd apps/worker && uv lock && uv sync
```

- [ ] **Step 2: Write failing tests**

`apps/worker/tests/test_subject_core.py`:

```python
"""Pure-core tests for subject.py — in-code fixtures, zero network (F-9: no PESEL/KW shapes)."""

from app.subject import (
    building_from_xml,
    is_poznan,
    parcel_from_xml,
    parse_geopoz_fields,
    pick_mpzp_function,
    pick_plan,
)

DZIALKA_XML = """<?xml version="1.0"?>
<FeatureInfoResponse>
  <ID_DZIALKI>306401_1.0021.AR_10.161</ID_DZIALKI>
  <NUMER_DZIALKI>161</NUMER_DZIALKI>
  <NUMER_ARKUSZA>10</NUMER_ARKUSZA>
  <NUMER_OBREBU>21</NUMER_OBREBU>
  <NAZWA_OBREBU>JEŻYCE</NAZWA_OBREBU>
  <NAZWA_GMINY>Poznań</NAZWA_GMINY>
  <POLE_EWIDENCYJNE>0.0772</POLE_EWIDENCYJNE>
  <GRUPA_REJESTROWA>7</GRUPA_REJESTROWA>
  <KLASOUZYTKI_EGIB>B</KLASOUZYTKI_EGIB>
</FeatureInfoResponse>"""

BUDYNEK_XML = """<?xml version="1.0"?>
<FeatureInfoResponse>
  <ID_BUDYNKU>306401_1.0021.AR_10.162.1_BUD</ID_BUDYNKU>
  <RODZAJ>budynki mieszkalne</RODZAJ>
  <KONDYGNACJE_NADZIEMNE>6</KONDYGNACJE_NADZIEMNE>
  <KONDYGNACJE_PODZIEMNE>1</KONDYGNACJE_PODZIEMNE>
</FeatureInfoResponse>"""

EMPTY_XML = '<?xml version="1.0"?><FeatureInfoResponse></FeatureInfoResponse>'

PARCEL_WKT = "POLYGON((0 0,10 0,10 10,0 10,0 0))"

FUNCTIONS_GEOJSON = {
    "features": [
        {  # covers the whole parcel -> must win
            "properties": {"FUNKCJA": "4MW/U", "GRUPA": "mieszkalnictwo"},
            "geometry": {"type": "Polygon",
                         "coordinates": [[[-5, -5], [15, -5], [15, 15], [-5, 15], [-5, -5]]]},
        },
        {  # disjoint -> overlap 0
            "properties": {"FUNKCJA": "KD-L", "GRUPA": "komunikacja"},
            "geometry": {"type": "Polygon",
                         "coordinates": [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]},
        },
    ]
}

PLANS_GEOJSON = {
    "features": [
        {
            "properties": {"kod_planu": "Sec", "nazwa": "Testowo - Północ",
                           "uchw_zatw": "VII/84/VIII/2019", "data_zatw": "2019-02-26",
                           "publ_dz_urz": "Rocznik 2019, poz. 2776"},
            "geometry": {"type": "Polygon",
                         "coordinates": [[[16.89, 52.40], [16.92, 52.40], [16.92, 52.43],
                                          [16.89, 52.43], [16.89, 52.40]]]},
        }
    ]
}


def test_parse_geopoz_fields_flat_dump():
    fields = parse_geopoz_fields(DZIALKA_XML)
    assert fields["NUMER_DZIALKI"] == "161"
    assert fields["KLASOUZYTKI_EGIB"] == "B"


def test_parcel_from_xml_maps_fields():
    parcel = parcel_from_xml(DZIALKA_XML)
    assert parcel == {
        "parcel_id": "306401_1.0021.AR_10.161",
        "obreb": "Jeżyce",
        "arkusz": "10",
        "nr_dzialki": "161",
        "pow_ewid_ha": 0.0772,
        "uzytek": "B",
    }


def test_parcel_from_xml_empty_returns_none():
    assert parcel_from_xml(EMPTY_XML) is None


def test_building_from_xml_maps_fields():
    building = building_from_xml(BUDYNEK_XML)
    assert building == {
        "rodzaj": "budynki mieszkalne",
        "kondygnacje_nadziemne": 6,
        "kondygnacje_podziemne": 1,
    }


def test_building_from_xml_empty_returns_none():
    assert building_from_xml(EMPTY_XML) is None


def test_pick_mpzp_function_max_overlap_wins():
    picked = pick_mpzp_function(PARCEL_WKT, FUNCTIONS_GEOJSON)
    assert picked == {"symbol": "4MW/U", "grupa": "mieszkalnictwo"}


def test_pick_mpzp_function_no_features_returns_none():
    assert pick_mpzp_function(PARCEL_WKT, {"features": []}) is None


def test_pick_plan_point_in_polygon():
    plan = pick_plan(16.905, 52.416, PLANS_GEOJSON)
    assert plan == {"nazwa": "Testowo - Północ", "uchwala": "VII/84/VIII/2019",
                    "data": "2019-02-26", "publ": "Rocznik 2019, poz. 2776"}


def test_pick_plan_outside_returns_none():
    assert pick_plan(17.5, 53.0, PLANS_GEOJSON) is None


def test_is_poznan_teryt_prefix():
    assert is_poznan("306401") is True
    assert is_poznan("146501") is False
    assert is_poznan(None) is False
```

- [ ] **Step 3: Run tests — expect FAIL** (`uv run pytest tests/test_subject_core.py -q` → ImportError)

- [ ] **Step 4: Implement `app/subject.py`**

```python
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
```

- [ ] **Step 5: Run tests — expect PASS** (`uv run pytest tests/test_subject_core.py -q`), then `uv run ruff check .` and full `uv run pytest -q`.

- [ ] **Step 6: Commit + push + watch CI**

```bash
git add apps/worker/pyproject.toml apps/worker/uv.lock apps/worker/app/subject.py apps/worker/tests/test_subject_core.py
git commit -m "feat(worker): subject data pure core - egib/mpzp parsers and geometry selection"
git push && gh run watch --exit-status
```

---

### Task 2: Worker endpoint `POST /subject-proposal`

**Files:**

- Modify: `apps/worker/app/main.py`
- Create: `apps/worker/tests/test_subject_proposal.py`

**Interfaces:**

- Consumes: all Task 1 functions via `import app.subject as subject`.
- Produces (HTTP contract consumed by Task 3): `POST /subject-proposal` body `{ "address": str }` → 200 `{ parcel: { parcelId, obreb, arkusz, nrDzialki, powEwidHa: number|null, uzytek }, building: { rodzaj, kondygnacjeNadziemne: number|null, kondygnacjePodziemne: number|null } | null, mpzp: { symbol, nazwaPlanu, uchwala, dataUchwaly, publikator } | null, meta: { x, y, teryt, fetchedAt, source: "geopoz-gugik", mpzpAbsent: boolean } }`; 422 `{detail}` = out of coverage (non-retryable); 502 `{detail}` = upstream failure (retryable). Never returns WR (F-11).

- [ ] **Step 1: Write failing endpoint tests**

`apps/worker/tests/test_subject_proposal.py`:

```python
import pytest
from fastapi.testclient import TestClient

import app.subject as subject
from app.main import app
from tests.test_subject_core import BUDYNEK_XML, DZIALKA_XML, EMPTY_XML

client = TestClient(app)


@pytest.fixture
def happy_io(monkeypatch):
    monkeypatch.setattr(subject, "geocode_address",
                        lambda address: {"x": 357604.98, "y": 507623.88, "teryt": "306401"})
    monkeypatch.setattr(subject, "fetch_parcel_by_xy",
                        lambda x, y: {"parcel_id": "306401_1.0021.AR_10.161"})
    monkeypatch.setattr(subject, "fetch_egib_xml",
                        lambda layer, x, y: DZIALKA_XML if layer == "dzialki" else BUDYNEK_XML)
    monkeypatch.setattr(subject, "fetch_parcel_wkt",
                        lambda parcel_id, srid: "POLYGON((0 0,10 0,10 10,0 10,0 0))")
    monkeypatch.setattr(subject, "fetch_mpzp_functions", lambda wkt: {"features": []})
    monkeypatch.setattr(subject, "pick_mpzp_function",
                        lambda wkt, fns: {"symbol": "4MW/U", "grupa": "mieszkalnictwo"})
    monkeypatch.setattr(subject, "centroid_4326", lambda wkt: (16.905, 52.416))
    monkeypatch.setattr(subject, "fetch_plans", lambda: {"features": []})
    monkeypatch.setattr(subject, "pick_plan",
                        lambda lon, lat, plans: {"nazwa": "Testowo - Polnoc",
                                                 "uchwala": "VII/84/VIII/2019",
                                                 "data": "2019-02-26",
                                                 "publ": "Rocznik 2019, poz. 2776"})


def test_happy_path_returns_parcel_building_mpzp_and_never_wr(happy_io):
    r = client.post("/subject-proposal", json={"address": "Poznan, Koscielna 33"})
    assert r.status_code == 200
    body = r.json()
    assert body["parcel"]["obreb"] == "Jeżyce"
    assert body["parcel"]["nrDzialki"] == "161"
    assert body["parcel"]["powEwidHa"] == 0.0772
    assert body["building"]["kondygnacjeNadziemne"] == 6
    assert body["mpzp"]["symbol"] == "4MW/U"
    assert body["mpzp"]["uchwala"] == "VII/84/VIII/2019"
    assert body["meta"]["mpzpAbsent"] is False
    assert body["meta"]["source"] == "geopoz-gugik"
    assert '"wr"' not in r.text.lower()


def test_no_plan_returns_null_mpzp_and_absent_flag(happy_io, monkeypatch):
    monkeypatch.setattr(subject, "pick_mpzp_function", lambda wkt, fns: None)
    monkeypatch.setattr(subject, "pick_plan", lambda lon, lat, plans: None)
    r = client.post("/subject-proposal", json={"address": "Poznan, Glogowska 40"})
    assert r.status_code == 200
    assert r.json()["mpzp"] is None
    assert r.json()["meta"]["mpzpAbsent"] is True


def test_missing_building_returns_null_building(happy_io, monkeypatch):
    monkeypatch.setattr(subject, "fetch_egib_xml",
                        lambda layer, x, y: DZIALKA_XML if layer == "dzialki" else EMPTY_XML)
    r = client.post("/subject-proposal", json={"address": "Poznan, Koscielna 33"})
    assert r.status_code == 200
    assert r.json()["building"] is None


def test_outside_poznan_is_422_non_retryable(monkeypatch):
    monkeypatch.setattr(subject, "geocode_address",
                        lambda address: {"x": 1.0, "y": 2.0, "teryt": "146501"})
    r = client.post("/subject-proposal", json={"address": "Warszawa, Marszalkowska 1"})
    assert r.status_code == 422
    assert "dla Poznania" in r.json()["detail"]


def test_upstream_failure_is_502_polish_detail(monkeypatch):
    def boom(address):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(subject, "geocode_address", boom)
    r = client.post("/subject-proposal", json={"address": "x"})
    assert r.status_code == 502
    assert "Nie udało się pobrać danych przedmiotu" in r.json()["detail"]
```

- [ ] **Step 2: Run — expect FAIL** (404 on `/subject-proposal`).

- [ ] **Step 3: Implement endpoint in `apps/worker/app/main.py`**

Add `import app.subject as subject` next to the existing `import app.rcn as rcn`, then append (models above handler, mirroring `/sample-proposal`; plain `def`, not async):

```python
class SubjectProposalRequest(BaseModel):
    address: str


class SubjectParcel(BaseModel):
    parcelId: str
    obreb: str
    arkusz: str
    nrDzialki: str
    powEwidHa: float | None
    uzytek: str


class SubjectBuilding(BaseModel):
    rodzaj: str
    kondygnacjeNadziemne: int | None
    kondygnacjePodziemne: int | None


class SubjectMpzp(BaseModel):
    symbol: str
    nazwaPlanu: str
    uchwala: str
    dataUchwaly: str
    publikator: str


class SubjectMeta(BaseModel):
    x: float
    y: float
    teryt: str
    fetchedAt: str
    source: str
    mpzpAbsent: bool


class SubjectProposalResponse(BaseModel):
    parcel: SubjectParcel
    building: SubjectBuilding | None
    mpzp: SubjectMpzp | None
    meta: SubjectMeta


OUT_OF_COVERAGE_DETAIL = "Dane przedmiotu dostępne na razie dla Poznania — wpisz dane ręcznie."
SUBJECT_FAILED_DETAIL = (
    "Nie udało się pobrać danych przedmiotu — spróbuj ponownie albo wpisz dane ręcznie."
)


@app.post("/subject-proposal")
def subject_proposal(request: SubjectProposalRequest) -> SubjectProposalResponse:
    try:
        geo = subject.geocode_address(request.address)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=SUBJECT_FAILED_DETAIL) from exc

    # 422 = out of MVP coverage (decision 9: non-retryable, distinct from 502)
    if not subject.is_poznan(geo.get("teryt")):
        raise HTTPException(status_code=422, detail=OUT_OF_COVERAGE_DETAIL)

    try:
        x, y = geo["x"], geo["y"]
        parcel_ref = subject.fetch_parcel_by_xy(x, y)
        parcel = subject.parcel_from_xml(subject.fetch_egib_xml("dzialki", x, y))
        if parcel is None:
            raise RuntimeError("EGiB nie zwrocilo dzialki")
        building = subject.building_from_xml(subject.fetch_egib_xml("budynki", x, y))
        wkt_2180 = subject.fetch_parcel_wkt(parcel_ref["parcel_id"], 2180)
        function = subject.pick_mpzp_function(wkt_2180, subject.fetch_mpzp_functions(wkt_2180))
        lon, lat = subject.centroid_4326(subject.fetch_parcel_wkt(parcel_ref["parcel_id"], 4326))
        plan = subject.pick_plan(lon, lat, subject.fetch_plans())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=SUBJECT_FAILED_DETAIL) from exc

    mpzp = None
    if function or plan:
        mpzp = SubjectMpzp(
            symbol=(function or {}).get("symbol", ""),
            nazwaPlanu=(plan or {}).get("nazwa", ""),
            uchwala=(plan or {}).get("uchwala", ""),
            dataUchwaly=(plan or {}).get("data", ""),
            publikator=(plan or {}).get("publ", ""),
        )
    return SubjectProposalResponse(
        parcel=SubjectParcel(
            parcelId=parcel["parcel_id"], obreb=parcel["obreb"], arkusz=parcel["arkusz"],
            nrDzialki=parcel["nr_dzialki"], powEwidHa=parcel["pow_ewid_ha"],
            uzytek=parcel["uzytek"],
        ),
        building=SubjectBuilding(
            rodzaj=building["rodzaj"],
            kondygnacjeNadziemne=building["kondygnacje_nadziemne"],
            kondygnacjePodziemne=building["kondygnacje_podziemne"],
        ) if building else None,
        mpzp=mpzp,
        meta=SubjectMeta(
            x=x, y=y, teryt=geo["teryt"], fetchedAt=datetime.now(UTC).isoformat(),
            source="geopoz-gugik", mpzpAbsent=mpzp is None,
        ),
    )
```

- [ ] **Step 4: Run — expect PASS**: `uv run pytest -q && uv run ruff check .`

- [ ] **Step 5 (one-off reality check, NOT a committed test):** run the worker locally (`uv run uvicorn app.main:app --port 8001`) and `curl -s -X POST localhost:8001/subject-proposal -H 'Content-Type: application/json' -d '{"address":"Poznań, Kościelna 33"}'` — expect obręb Jeżyce, działka 161, 4MW/U, uchwała VII/84/VIII/2019 (spike parity). Paste the output into the task report.

- [ ] **Step 6: Commit + push + watch CI**

```bash
git add apps/worker/app/main.py apps/worker/tests/test_subject_proposal.py
git commit -m "feat(worker): post /subject-proposal endpoint with out-of-coverage 422"
git push && gh run watch --exit-status
```

---

### Task 3: Web port + HTTP adapter + server action

**Files:**

- Create: `apps/web/src/ports/subject.ts`
- Create: `apps/web/src/adapters/subject-http.ts`
- Create: `apps/web/src/app/actions/get-subject-data.ts`
- Modify: `apps/web/src/app/valuations/_deps.ts` (add `subjectData` — mirror how `sampleProposal` is wired there, same env/base-url source)
- Test: `apps/web/tests/subject-contract.test.ts`

**Interfaces:**

- Consumes: worker HTTP contract from Task 2.
- Produces: `ports/subject.ts` exports `SubjectParcel, SubjectBuilding, SubjectMpzp, SubjectMeta` (field-for-field the Task 2 JSON), `SubjectProposal { parcel; building: SubjectBuilding | null; mpzp: SubjectMpzp | null; meta }`, `SubjectFetchResult = { kind: "ok"; proposal: SubjectProposal } | { kind: "outOfCoverage"; message: string }`, `interface PortSubjectData { fetchSubject(address: string): Promise<SubjectFetchResult> }`. Adapter exports `WORKER_SUBJECT_PREFIX = "worker /subject-proposal responded"` and `httpSubjectProposal(baseUrl: string): PortSubjectData`. Action exports `getSubjectData(input: { address: string }): Promise<GetSubjectDataResult>` where `GetSubjectDataResult = { proposal: SubjectProposal } | { outOfCoverage: string } | { error: string }`.

- [ ] **Step 1: Failing contract test** `apps/web/tests/subject-contract.test.ts` (mirror `sample-contract.test.ts` style — mock global `fetch`):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { httpSubjectProposal, WORKER_SUBJECT_PREFIX } from "../src/adapters/subject-http";

const proposal = {
  parcel: {
    parcelId: "306401_1.0021.AR_10.161",
    obreb: "Jeżyce",
    arkusz: "10",
    nrDzialki: "161",
    powEwidHa: 0.0772,
    uzytek: "B",
  },
  building: { rodzaj: "budynki mieszkalne", kondygnacjeNadziemne: 6, kondygnacjePodziemne: 1 },
  mpzp: {
    symbol: "4MW/U",
    nazwaPlanu: "Testowo",
    uchwala: "VII/84/VIII/2019",
    dataUchwaly: "2019-02-26",
    publikator: "Rocznik 2019, poz. 2776",
  },
  meta: {
    x: 357604.98,
    y: 507623.88,
    teryt: "306401",
    fetchedAt: "2026-07-17T10:00:00Z",
    source: "geopoz-gugik",
    mpzpAbsent: false,
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("httpSubjectProposal", () => {
  it("returns ok result on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(proposal), { status: 200 })),
    );
    const result = await httpSubjectProposal("http://w").fetchSubject("Poznań, Kościelna 33");
    expect(result).toEqual({ kind: "ok", proposal });
  });

  it("maps 422 to outOfCoverage (non-retryable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: "Dane przedmiotu dostępne na razie dla Poznania — wpisz dane ręcznie.",
          }),
          { status: 422 },
        ),
      ),
    );
    const result = await httpSubjectProposal("http://w").fetchSubject("Warszawa, X 1");
    expect(result).toEqual({
      kind: "outOfCoverage",
      message: "Dane przedmiotu dostępne na razie dla Poznania — wpisz dane ręcznie.",
    });
  });

  it("throws worker detail on 502 (retryable path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail:
              "Nie udało się pobrać danych przedmiotu — spróbuj ponownie albo wpisz dane ręcznie.",
          }),
          { status: 502 },
        ),
      ),
    );
    await expect(httpSubjectProposal("http://w").fetchSubject("x")).rejects.toThrow(
      /Nie udało się pobrać danych przedmiotu/,
    );
  });

  it("throws prefixed error when body has no detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(httpSubjectProposal("http://w").fetchSubject("x")).rejects.toThrow(
      new RegExp(`^${WORKER_SUBJECT_PREFIX}`),
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`pnpm --filter web test -- subject-contract`).

- [ ] **Step 3: Implement.** `ports/subject.ts` — types exactly as in Interfaces. `adapters/subject-http.ts` (mirror of `sample-http.ts`, plus the 422 branch):

```ts
import type { PortSubjectData, SubjectFetchResult, SubjectProposal } from "@/ports/subject";

export const WORKER_SUBJECT_PREFIX = "worker /subject-proposal responded";

export function httpSubjectProposal(baseUrl: string): PortSubjectData {
  return {
    async fetchSubject(address: string): Promise<SubjectFetchResult> {
      const response = await fetch(`${baseUrl}/subject-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (response.status === 422) {
        const body = (await response.json()) as { detail?: string };
        return {
          kind: "outOfCoverage",
          message:
            body.detail ?? "Auto-pobieranie danych przedmiotu jest niedostępne dla tego adresu.",
        };
      }
      if (!response.ok) {
        let detail: string | undefined;
        try {
          const body = (await response.json()) as { detail?: string };
          detail = body.detail;
        } catch {
          /* no JSON body — fall back below */
        }
        throw new Error(
          detail ?? `${WORKER_SUBJECT_PREFIX} ${response.status} ${response.statusText}`,
        );
      }
      return { kind: "ok", proposal: (await response.json()) as SubjectProposal };
    },
  };
}
```

`app/actions/get-subject-data.ts` (mirror of `get-sample-proposal.ts`: session gate → zod → try/catch with prefix classification):

```ts
"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { subjectData } from "@/app/valuations/_deps";
import { WORKER_SUBJECT_PREFIX } from "@/adapters/subject-http";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import type { SubjectProposal } from "@/ports/subject";

const inputSchema = valuationFormSchema.pick({ address: true });

export type GetSubjectDataResult =
  { proposal: SubjectProposal } | { outOfCoverage: string } | { error: string };

const GENERIC_ERROR =
  "Nie udało się pobrać danych przedmiotu — spróbuj ponownie albo wpisz dane ręcznie.";

export async function getSubjectData(input: { address: string }): Promise<GetSubjectDataResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Nieprawidłowe dane formularza." };
  }
  try {
    const result = await subjectData.fetchSubject(parsed.data.address);
    if (result.kind === "outOfCoverage") {
      return { outOfCoverage: result.message };
    }
    return { proposal: result.proposal };
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    if (message && !message.startsWith(WORKER_SUBJECT_PREFIX)) {
      return { error: message };
    }
    return { error: GENERIC_ERROR };
  }
}
```

In `_deps.ts` add `subjectData = httpSubjectProposal(<same base url expression sampleProposal uses>)`.

- [ ] **Step 4: Run — expect PASS**, then full gates: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`.

- [ ] **Step 5: Commit + push + watch CI**

```bash
git add apps/web/src/ports/subject.ts apps/web/src/adapters/subject-http.ts apps/web/src/app/actions/get-subject-data.ts apps/web/src/app/valuations/_deps.ts apps/web/tests/subject-contract.test.ts
git commit -m "feat(web): subject data port, http adapter and session-gated action"
git push && gh run watch --exit-status
```

---

### Task 4: Schema + snapshot type + provenance ACL + F-4 gate

**Files:**

- Create: `apps/web/src/domain/subject-snapshot.ts`
- Modify: `apps/web/src/lib/valuation-form-schema.ts` (add `subjectSchema`, `subjectMetaSchema`, fields `subject`/`subjectMeta`)
- Modify: `apps/web/src/domain/kcs.ts` (KcsInput: add `subject?: SubjectSnapshot | null; subjectMeta?: SubjectMetaSnapshot | null;` — engine ignores them)
- Modify: `apps/web/src/lib/assign-provenance.ts`
- Modify: `apps/web/src/domain/provenance.ts` (InputsProvenance + GateInput + gate rules)
- Modify: `apps/web/src/domain/valuation.ts` (add `confirmSubjectProvenance`)
- Test: `apps/web/tests/assign-provenance.test.ts`, `apps/web/tests/f4-approval-gate.test.ts` (extend both)

**Interfaces:**

- Consumes: kernel `Provenance` from `@wyceny/shared`.
- Produces: `domain/subject-snapshot.ts` exports `SubjectSnapshot = { parcelId?: string; obreb?: string; arkusz?: string; nrDzialki?: string; powEwidHa?: number; uzytek?: string; budynekRodzaj?: string; kondygnacjeNadziemne?: number; kondygnacjePodziemne?: number; rokBudowy?: number; mpzpAbsent?: boolean; mpzpSymbol?: string; mpzpNazwa?: string; mpzpUchwala?: string; mpzpData?: string; mpzpPubl?: string; przeznaczenieStudium?: string }` and `SubjectMetaSnapshot = { x: number; y: number; teryt: string; fetchedAt: string; source: string; mpzpAbsent: boolean }`. `InputsProvenance` gains `ewidencja?: Provenance; mpzp?: Provenance`. `GateInput` gains `subject?: unknown | null`. `assignProvenance` accepts `Pick<ValuationFormValues, "comparables" | "sampleMeta" | "subject" | "subjectMeta">`. `confirmSubjectProvenance(v: Valuation): Valuation` flips `ewidencja`/`mpzp` to confirmed.

- [ ] **Step 1: Failing tests.** Extend `assign-provenance.test.ts`:

```ts
it("marks subject groups to_verify when subjectMeta present (auto-fetched)", () => {
  const { provenance } = assignProvenance({
    comparables: [],
    sampleMeta: undefined,
    subject: { obreb: "Jeżyce", nrDzialki: "161" },
    subjectMeta: {
      x: 1,
      y: 2,
      teryt: "306401",
      fetchedAt: "t",
      source: "geopoz-gugik",
      mpzpAbsent: false,
    },
  });
  expect(provenance.ewidencja).toEqual({ source: "ewidencja", status: "to_verify" });
  expect(provenance.mpzp).toEqual({ source: "mpzp", status: "to_verify" });
});

it("marks subject groups confirmed for manual entry (no subjectMeta)", () => {
  const { provenance } = assignProvenance({
    comparables: [],
    sampleMeta: undefined,
    subject: { obreb: "Jeżyce" },
    subjectMeta: undefined,
  });
  expect(provenance.ewidencja).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  expect(provenance.mpzp).toEqual({ source: "rzeczoznawca", status: "confirmed" });
});

it("omits subject provenance when subject absent", () => {
  const { provenance } = assignProvenance({
    comparables: [],
    sampleMeta: undefined,
    subject: undefined,
    subjectMeta: undefined,
  });
  expect(provenance.ewidencja).toBeUndefined();
  expect(provenance.mpzp).toBeUndefined();
});
```

Extend `f4-approval-gate.test.ts` (build on the file's existing valid-input helper; add `subject` to it in these cases):

```ts
it("blocks approval when subject fetched but not confirmed", () => {
  const result = approvalGate({
    ...validInput(),
    subject: { obreb: "Jeżyce" },
    provenance: {
      ...validProvenance(),
      ewidencja: { source: "ewidencja", status: "to_verify" },
      mpzp: { source: "mpzp", status: "to_verify" },
    },
  });
  expect(result.ok).toBe(false);
  const paths = (result as { blockers: { path: string }[] }).blockers.map((b) => b.path);
  expect(paths).toContain("provenance.ewidencja");
  expect(paths).toContain("provenance.mpzp");
});

it("blocks when subject present but provenance entries missing (default-deny)", () => {
  const result = approvalGate({ ...validInput(), subject: { obreb: "X" } });
  expect(result.ok).toBe(false);
});

it("passes with subject groups confirmed", () => {
  const result = approvalGate({
    ...validInput(),
    subject: { obreb: "Jeżyce" },
    provenance: {
      ...validProvenance(),
      ewidencja: { source: "ewidencja", status: "confirmed" },
      mpzp: { source: "mpzp", status: "confirmed" },
    },
  });
  expect(result.ok).toBe(true);
});

it("does not gate subject when subject absent (legacy)", () => {
  expect(approvalGate(validInput()).ok).toBe(true);
});
```

Add to `apps/web/tests/` coverage of `confirmSubjectProvenance` (in the file that tests `confirmSampleProvenance` — find it via `grep -rl confirmSampleProvenance apps/web/tests`): confirmed flip of both groups, no-op on legacy inputs without subject.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.**

`valuation-form-schema.ts` — add above `valuationFormSchema`:

```ts
export const subjectSchema = z.object({
  parcelId: z.string().optional(),
  obreb: z.string().optional(),
  arkusz: z.string().optional(),
  nrDzialki: z.string().optional(),
  powEwidHa: z.coerce
    .number()
    .positive("Powierzchnia działki musi być większa od zera.")
    .optional(),
  uzytek: z.string().optional(),
  budynekRodzaj: z.string().optional(),
  kondygnacjeNadziemne: z.coerce.number().int().min(0).optional(),
  kondygnacjePodziemne: z.coerce.number().int().min(0).optional(),
  rokBudowy: z.coerce
    .number()
    .int()
    .min(1500, "Rok budowy wygląda na błędny.")
    .max(2100, "Rok budowy wygląda na błędny.")
    .optional(),
  mpzpAbsent: z.boolean().optional(),
  mpzpSymbol: z.string().optional(),
  mpzpNazwa: z.string().optional(),
  mpzpUchwala: z.string().optional(),
  mpzpData: z.string().optional(),
  mpzpPubl: z.string().optional(),
  przeznaczenieStudium: z.string().optional(),
});
export const subjectMetaSchema = z.object({
  x: z.number(),
  y: z.number(),
  teryt: z.string(),
  fetchedAt: z.string(),
  source: z.string(),
  mpzpAbsent: z.boolean(),
});
```

and in `valuationFormSchema`: `subject: subjectSchema.optional(), subjectMeta: subjectMetaSchema.optional(),`.

NOTE the repo trap: `z.coerce.number().optional()` turns `""` into `0` → min/positive fails. The form (Task 5) must keep empty numeric subject fields as `undefined`, same as `emptyComparable.area`.

`domain/subject-snapshot.ts` — plain types per Interfaces (keep in sync with `subjectSchema`; add the comment `// Keep in sync with subjectSchema in lib/valuation-form-schema.ts`).

`assign-provenance.ts` — extend signature and provenance object:

```ts
export function assignProvenance(
  values: Pick<ValuationFormValues, "comparables" | "sampleMeta" | "subject" | "subjectMeta">,
): { comparables: Comparable[]; provenance: InputsProvenance } {
  // ...existing comparables mapping unchanged...
  const confirmed = { source: "rzeczoznawca", status: "confirmed" } as const;
  const provenance: InputsProvenance = {
    address: confirmed,
    area: confirmed,
    weights: confirmed,
    ratings: confirmed,
    ...(values.sampleMeta ? { geocode: { source: "geokoder", status: "to_verify" } as const } : {}),
    ...(values.subject
      ? {
          ewidencja: values.subjectMeta
            ? ({ source: "ewidencja", status: "to_verify" } as const)
            : confirmed,
          mpzp: values.subjectMeta ? ({ source: "mpzp", status: "to_verify" } as const) : confirmed,
        }
      : {}),
  };
  return { comparables, provenance };
}
```

`provenance.ts` — `InputsProvenance` gains `ewidencja?: Provenance; mpzp?: Provenance;`; `GateInput` gains `subject?: unknown | null;`; in `approvalGate`, after the `sampleMeta` block:

```ts
// Subject data (EGiB/MPZP): gated whenever a subject snapshot exists.
// Decision 10: confirmed "no plan" is also a conscious approval — mpzp group
// covers both plan data and its absence.
if (input.subject != null) {
  const ewidencja = input.provenance?.ewidencja;
  const sE = sourced("ewidencja", ewidencja?.source ?? "ewidencja", ewidencja?.status ?? "none");
  if (isBlocking(sE)) {
    blockers.push({
      path: "provenance.ewidencja",
      label: `Dane ewidencyjne przedmiotu (EGiB) — ${statusLabel(ewidencja?.status ?? "none")}.`,
    });
  }
  const mpzp = input.provenance?.mpzp;
  const sM = sourced("mpzp", mpzp?.source ?? "mpzp", mpzp?.status ?? "none");
  if (isBlocking(sM)) {
    blockers.push({
      path: "provenance.mpzp",
      label: `Przeznaczenie planistyczne (MPZP) — ${statusLabel(mpzp?.status ?? "none")}.`,
    });
  }
}
```

`domain/kcs.ts` — add to `KcsInput`: `subject?: SubjectSnapshot | null; subjectMeta?: SubjectMetaSnapshot | null;` (import types from `./subject-snapshot`; `computeKcs` untouched).

`domain/valuation.ts` — mirror `confirmSampleProvenance`:

```ts
export function confirmSubjectProvenance(valuation: Valuation): Valuation {
  if (!valuation.inputs?.provenance) return valuation;
  const provenance = { ...valuation.inputs.provenance };
  if (provenance.ewidencja) provenance.ewidencja = { ...provenance.ewidencja, status: "confirmed" };
  if (provenance.mpzp) provenance.mpzp = { ...provenance.mpzp, status: "confirmed" };
  return { ...valuation, inputs: { ...valuation.inputs, provenance } };
}
```

- [ ] **Step 4: Run — expect PASS** + full web gates + depcruise.
- [ ] **Step 5: Commit + push + watch CI** — `feat(web): subject snapshot schema, provenance groups and f-4 gate`

---

### Task 5: Form section "Dane przedmiotu" + auto-fetch + hard reset + status bar

**Files:**

- Create: `apps/web/src/lib/subject-form.ts` (pure helpers)
- Create: `apps/web/src/app/valuations/new/subject-section.tsx`
- Modify: `apps/web/src/app/valuations/new/new-valuation-form.tsx`
- Modify: `apps/web/e2e/smoke.spec.ts` + the CI e2e workflow env (see Step 5)
- Test: `apps/web/tests/subject-form.test.ts`

**Interfaces:**

- Consumes: `getSubjectData` (Task 3), `subjectSchema` fields (Task 4).
- Produces: `lib/subject-form.ts` exports `EMPTY_SUBJECT` (all fields `""`/`undefined`, numerics `undefined`), `proposalToSubjectValues(p: SubjectProposal): SubjectFormValues` (flattens `mpzp` → `mpzpSymbol…mpzpPubl`, sets `mpzpAbsent: p.mpzp === null`; preserves nothing manual — hard reset semantics), where `SubjectFormValues = z.input<typeof subjectSchema>`.

- [ ] **Step 1: Failing tests** `apps/web/tests/subject-form.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_SUBJECT, proposalToSubjectValues } from "../src/lib/subject-form";

const proposal = {
  parcel: {
    parcelId: "306401_1.0021.AR_10.161",
    obreb: "Jeżyce",
    arkusz: "10",
    nrDzialki: "161",
    powEwidHa: 0.0772,
    uzytek: "B",
  },
  building: { rodzaj: "budynki mieszkalne", kondygnacjeNadziemne: 6, kondygnacjePodziemne: 1 },
  mpzp: {
    symbol: "4MW/U",
    nazwaPlanu: "Testowo",
    uchwala: "VII/84/VIII/2019",
    dataUchwaly: "2019-02-26",
    publikator: "Rocznik 2019, poz. 2776",
  },
  meta: {
    x: 357604.98,
    y: 507623.88,
    teryt: "306401",
    fetchedAt: "2026-07-17T10:00:00Z",
    source: "geopoz-gugik",
    mpzpAbsent: false,
  },
};

describe("proposalToSubjectValues", () => {
  it("flattens parcel, building and mpzp", () => {
    const v = proposalToSubjectValues(proposal);
    expect(v.obreb).toBe("Jeżyce");
    expect(v.powEwidHa).toBe(0.0772);
    expect(v.kondygnacjeNadziemne).toBe(6);
    expect(v.mpzpSymbol).toBe("4MW/U");
    expect(v.mpzpAbsent).toBe(false);
    expect(v.rokBudowy).toBeUndefined(); // never auto-filled — not publicly available
  });

  it("null building leaves building fields empty", () => {
    const v = proposalToSubjectValues({ ...proposal, building: null });
    expect(v.budynekRodzaj).toBe("");
    expect(v.kondygnacjeNadziemne).toBeUndefined();
  });

  it("null mpzp sets mpzpAbsent true and empty plan fields", () => {
    const v = proposalToSubjectValues({
      ...proposal,
      mpzp: null,
      meta: { ...proposal.meta, mpzpAbsent: true },
    });
    expect(v.mpzpAbsent).toBe(true);
    expect(v.mpzpSymbol).toBe("");
  });

  it("EMPTY_SUBJECT has no numeric zeros (coerce trap)", () => {
    expect(EMPTY_SUBJECT.powEwidHa).toBeUndefined();
    expect(EMPTY_SUBJECT.rokBudowy).toBeUndefined();
    expect(EMPTY_SUBJECT.obreb).toBe("");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `lib/subject-form.ts`:**

```ts
import type { z } from "zod";
import type { SubjectProposal } from "@/ports/subject";
import type { subjectSchema } from "@/lib/valuation-form-schema";

export type SubjectFormValues = z.input<typeof subjectSchema>;

export const EMPTY_SUBJECT: SubjectFormValues = {
  parcelId: "",
  obreb: "",
  arkusz: "",
  nrDzialki: "",
  powEwidHa: undefined,
  uzytek: "",
  budynekRodzaj: "",
  kondygnacjeNadziemne: undefined,
  kondygnacjePodziemne: undefined,
  rokBudowy: undefined,
  mpzpAbsent: undefined,
  mpzpSymbol: "",
  mpzpNazwa: "",
  mpzpUchwala: "",
  mpzpData: "",
  mpzpPubl: "",
  przeznaczenieStudium: "",
};

export function proposalToSubjectValues(p: SubjectProposal): SubjectFormValues {
  return {
    ...EMPTY_SUBJECT,
    parcelId: p.parcel.parcelId,
    obreb: p.parcel.obreb,
    arkusz: p.parcel.arkusz,
    nrDzialki: p.parcel.nrDzialki,
    powEwidHa: p.parcel.powEwidHa ?? undefined,
    uzytek: p.parcel.uzytek,
    budynekRodzaj: p.building?.rodzaj ?? "",
    kondygnacjeNadziemne: p.building?.kondygnacjeNadziemne ?? undefined,
    kondygnacjePodziemne: p.building?.kondygnacjePodziemne ?? undefined,
    mpzpAbsent: p.mpzp === null,
    mpzpSymbol: p.mpzp?.symbol ?? "",
    mpzpNazwa: p.mpzp?.nazwaPlanu ?? "",
    mpzpUchwala: p.mpzp?.uchwala ?? "",
    mpzpData: p.mpzp?.dataUchwaly ?? "",
    mpzpPubl: p.mpzp?.publikator ?? "",
  };
}
```

- [ ] **Step 4: Wire the form.** In `new-valuation-form.tsx`:

1. defaultValues: `subject: { ...EMPTY_SUBJECT }, subjectMeta: undefined,`.
2. State + handler (auto-fetch, decision 2 + 8 + 9):

```tsx
type SubjectFetchState =
  | { status: "idle" | "loading" }
  | { status: "done"; summary: string }
  | { status: "outOfCoverage"; message: string }
  | { status: "error"; message: string };

const [subjectFetch, setSubjectFetch] = useState<SubjectFetchState>({ status: "idle" });
const lastFetchedAddress = useRef<string | null>(null);

const fetchSubject = async (address: string) => {
  // Decision 8: address is the section key — hard reset before every fetch.
  setValue("subject", { ...EMPTY_SUBJECT });
  setValue("subjectMeta", undefined);
  setSubjectFetch({ status: "loading" });
  const result = await getSubjectData({ address });
  if ("proposal" in result) {
    setValue("subject", proposalToSubjectValues(result.proposal), { shouldValidate: true });
    setValue("subjectMeta", result.proposal.meta, { shouldDirty: true });
    const p = result.proposal;
    setSubjectFetch({
      status: "done",
      summary: `obręb ${p.parcel.obreb}, dz. ${p.parcel.nrDzialki}${p.mpzp ? `, MPZP ${p.mpzp.symbol}` : ", brak MPZP"}`,
    });
  } else if ("outOfCoverage" in result) {
    setSubjectFetch({ status: "outOfCoverage", message: result.outOfCoverage });
  } else {
    setSubjectFetch({ status: "error", message: result.error });
  }
};

const onAddressBlur = async () => {
  if (process.env.NEXT_PUBLIC_SUBJECT_AUTOFETCH === "off") return; // e2e: no network in CI
  const address = getValues("address")?.trim();
  if (!address || address === lastFetchedAddress.current) return;
  if (!(await trigger("address"))) return;
  lastFetchedAddress.current = address;
  await fetchSubject(address);
};
```

3. Address field: add `onBlur={(e) => { field.onBlur(); void onAddressBlur(); }}` to the existing `<Input id="address" ...>` (keep RHF's own blur first).
4. Render `<SubjectSection control={control} fetchState={subjectFetch} onRetry={() => { lastFetchedAddress.current = null; void onAddressBlur(); }} />` between the address/area fields and the "Próba porównawcza" section.
5. `subject-section.tsx` — client component. Contents:
   - Status bar `data-testid="subject-fetch-status"`, four states (spec/UI section): loading `⏳ Pobieram dane działki i MPZP…`; done `✓ Pobrano: {summary} — do potwierdzenia`; outOfCoverage `ℹ {message}` (NO retry button); error `⚠ {message}` + `<Button type="button" variant="outline" onClick={onRetry}>Spróbuj ponownie</Button>` (amber styling: `text-amber-600`).
   - Text fields (Controller + `{...field}`, ids `subject-obreb`, `subject-arkusz`, `subject-nr-dzialki`, `subject-uzytek`, `subject-budynek-rodzaj`, `subject-mpzp-symbol`, `subject-mpzp-nazwa`, `subject-mpzp-uchwala`, `subject-mpzp-data`, `subject-mpzp-publ`, `subject-przeznaczenie-studium`): labels „Obręb", „Arkusz mapy", „Nr działki", „Użytek", „Rodzaj budynku", „Symbol MPZP", „Nazwa planu", „Uchwała", „Data uchwały", „Publikator", „Przeznaczenie wg studium/decyzji WZ".
   - Numeric fields (manual value/onChange split — the coerce trap): `subject-pow-ewid` („Pow. ewidencyjna działki [ha]"), `subject-kondygnacje-nadziemne`, `subject-kondygnacje-podziemne`, `subject-rok-budowy` („Rok budowy") with `<FieldDescription>` hint: „Brak w publicznej ewidencji — uzupełnij z dokumentacji lub oględzin."
   - MPZP toggle: checkbox `subject-mpzp-absent` („Brak obowiązującego MPZP") bound via Controller to `subject.mpzpAbsent`; `useWatch({ control, name: "subject.mpzpAbsent" })` — when true hide the five MPZP fields and show `przeznaczenieStudium`; when false/undefined the reverse.
6. `onSubmit` unchanged (subject flows through `createValuation` values — Task 6 persists it).

- [ ] **Step 5: e2e guard.** In the GitHub Actions workflow job that runs Playwright (find it: `grep -rn "playwright" .github/workflows/`), add `NEXT_PUBLIC_SUBJECT_AUTOFETCH: "off"` to the web build/run env, and the same in the local e2e script if one exists (`playwright.config.ts` webServer env). In `smoke.spec.ts` no changes to `fillDraft` (subject stays empty — valid). Run `pnpm --filter web exec playwright test` locally if the setup allows; otherwise rely on CI e2e job.

- [ ] **Step 6: Run all web gates — expect PASS.**
- [ ] **Step 7: Commit + push + watch CI** — `feat(web): subject data form section with auto-fetch, hard reset and status bar`

---

### Task 6: Persist snapshot + detail page card + bulk confirm

**Files:**

- Modify: `apps/web/src/app/actions/create-valuation.ts` (thread `subject`/`subjectMeta` into the KcsInput snapshot)
- Create: `apps/web/src/app/actions/confirm-subject.ts`
- Modify: `apps/web/src/ports/valuation.ts` (PortValuation: add `confirmSubject(id, user)`)
- Modify: `apps/web/src/adapters/valuation-drizzle.ts` (implement `confirmSubject` — mirror `confirmSample`, call `confirmSubjectProvenance`)
- Modify: `apps/web/src/app/valuations/[id]/page.tsx` (subject card + badges + `hasSubjectToVerify`)
- Modify: `apps/web/src/app/valuations/[id]/valuation-actions.tsx` (second confirm button)
- Test: extend the existing action/domain test files that cover `create-valuation`/`confirmSample` (find: `grep -rl "confirmSample\|createValuation" apps/web/tests`)

**Interfaces:**

- Consumes: `confirmSubjectProvenance` (Task 4), schema fields (Task 4).
- Produces: `confirmSubject(id: string): Promise<{ error: string } | undefined>` server action; `PortValuation.confirmSubject(id, user): Promise<Valuation | null>`; `ValuationActions` props extended with `hasSubjectToVerify: boolean`.

- [ ] **Step 1: Failing tests.** (a) create-valuation snapshot: assert that when form values include `subject` + `subjectMeta`, the repository receives `inputs.subject` and `inputs.subjectMeta` and `inputs.provenance.ewidencja.status === "to_verify"`. (b) `confirmSubject` domain/repo path: to_verify → confirmed for both groups; ownership miss → null. Mirror the shape of existing `confirmSample` tests.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.**

`create-valuation.ts` — destructure `subject, subjectMeta` from `parsed.data`; extend the snapshot:

```ts
const kcsInput: KcsInput = {
  area,
  comparables: sourcedComparables,
  features: features.map((f) => ({ name: f.name, weight: f.weightPct / 100, rating: f.rating })),
  sampleMeta: sampleMeta ?? null,
  subject: subject ?? null,
  subjectMeta: subjectMeta ?? null,
  provenance,
};
```

(`assignProvenance` call site now passes the full `parsed.data` — signature updated in Task 4.)

`confirm-subject.ts` — mirror `confirm-sample.ts` verbatim, calling `valuationRepository.confirmSubject`, error copy: „Nie udało się potwierdzić danych przedmiotu — spróbuj ponownie."

`valuation-drizzle.ts` — `confirmSubject` mirrors `confirmSample`, using `confirmSubjectProvenance`.

`valuation-actions.tsx` — add prop `hasSubjectToVerify: boolean` and next to the sample button:

```tsx
{
  hasSubjectToVerify ? (
    <Button
      type="button"
      variant="outline"
      data-testid="confirm-subject-button"
      disabled={isPending}
      onClick={() => run(confirmSubject)}
    >
      {isPending ? "Potwierdzanie…" : "Potwierdź dane przedmiotu"}
    </Button>
  ) : null;
}
```

`page.tsx` — (a) compute:

```tsx
const hasSubjectToVerify =
  isDraft && valuation.inputs
    ? valuation.inputs.provenance?.ewidencja?.status === "to_verify" ||
      valuation.inputs.provenance?.mpzp?.status === "to_verify"
    : false;
```

(b) render a „Dane przedmiotu" card when `valuation.inputs?.subject` exists: rows (label → value or „—"): Obręb, Arkusz, Nr działki, Pow. ewidencyjna [ha], Użytek, Rodzaj budynku, Kondygnacje (nad/podziemne), Rok budowy (fallback „b.d."), then MPZP block: either symbol/nazwa/uchwała/data/publikator or „Brak obowiązującego MPZP" + przeznaczenie wg studium/WZ when set. Group badges reuse `ProvenanceBadge` pattern with the group provenance: `<Badge variant="outline" className="border-amber-500 text-amber-600">EGiB — do weryfikacji</Badge>` / `<Badge variant="secondary">EGiB — potwierdzone</Badge>` and same for MPZP (render from `valuation.inputs.provenance?.ewidencja/mpzp`).

- [ ] **Step 4: Run all web gates — expect PASS.**
- [ ] **Step 5: Commit + push + watch CI** — `feat(web): persist subject snapshot, detail card and bulk confirm`

---

### Task 7: Template placeholders (sections 8.2 + 9) via `build_template.py` + F-12 integrity

**Files:**

- Modify (WIKI repo — leave uncommitted, S6 PR will carry it): `/Users/michalczekala/Development/wyceny/tools/spike/2026-07-15-template-koscielna/build_template.py`
- Regenerated (app repo): `apps/web/templates/operat-szablon.docx`, `apps/web/src/domain/operat-sections.ts`
- Modify: `apps/web/tests/f12-template-integrity.test.ts` (extend `REQUIRED_PLACEHOLDERS` + `FORBIDDEN_LITERALS`)

**Interfaces:**

- Consumes: existing script stages/helpers (`para_prefix_replace`, `set_para_text_collapsed`, `check`, `verify`, `PLACEHOLDERS`).
- Produces (template contract consumed by Task 8): scalar placeholders `{obreb} {arkusz} {nr_dzialki} {pow_dzialki} {uzytek} {budynek_rodzaj} {kondygnacje} {rok_budowy} {przeznaczenie_studium}` and conditional sections `{#mpzp}…{/mpzp}` (fields `{symbol} {nazwa} {uchwala} {data} {publ}` inside scope) + `{#mpzp_brak}…{/mpzp_brak}`. Section headings unchanged (`operat-sections.ts` regenerates identically).

- [ ] **Step 1: Extend the F-12 integrity test FIRST (failing).** In `f12-template-integrity.test.ts` add to `REQUIRED_PLACEHOLDERS`: `"{obreb}", "{arkusz}", "{nr_dzialki}", "{pow_dzialki}", "{uzytek}", "{budynek_rodzaj}", "{kondygnacje}", "{rok_budowy}", "{przeznaczenie_studium}", "{#mpzp}", "{/mpzp}", "{#mpzp_brak}", "{/mpzp_brak}"`. Add to `FORBIDDEN_LITERALS`: `"4MW/U"` (source-operat plan symbol must never be baked into the template). Run `pnpm --filter web test -- f12-template-integrity` → FAIL (placeholders missing).

- [ ] **Step 2: Extend `build_template.py`.** Add a paragraph-insertion helper (ElementTree-safe — insert as sibling in the body children list):

```python
import copy

def insert_paras_after(body, anchor_p, texts, label):
    """Insert copies of anchor_p after it, one per text (docxtemplater tags inline)."""
    children = list(body)
    check(anchor_p in children, f"{label}: anchor paragraph not a direct child of body")
    idx = children.index(anchor_p)
    for offset, text in enumerate(texts, start=1):
        new_p = copy.deepcopy(anchor_p)
        set_para_text_collapsed(new_p, text)
        body.insert(idx + offset, new_p)
```

New stage 1c (after stage 1's `{nr_kw}` paragraph exists) — section 8.2 facts block (decisions 5–6). Locate the stage-1 `{nr_kw}` paragraph by its text prefix and rewrite + append:

```python
print("== stage 1c: section 8.2 facts block (EGiB/MPZP slice) ==")
FACTS_82 = [
    "Dane ewidencyjne (EGiB): obręb {obreb}, arkusz mapy {arkusz}, działka nr {nr_dzialki}, "
    "powierzchnia ewidencyjna działki {pow_dzialki} ha, użytek {uzytek}.",
    "Budynek: {budynek_rodzaj}, kondygnacje (nadziemne / podziemne): {kondygnacje}, "
    "rok budowy: {rok_budowy}.",
    # fixed annotation (decision 6) — the block's last paragraph
    "Udział w nieruchomości wspólnej — wg odpisu księgi wieczystej.",
]
# anchor = the single {nr_kw} paragraph produced by stage 1
anchor = None
for p in body.iter(W_P):
    if "{nr_kw}" in para_text(p):
        anchor = p
        break
check(anchor is not None, "stage 1c: {nr_kw} paragraph found")
insert_paras_after(body, anchor, FACTS_82, "stage 1c facts block")
```

Note for the implementer: if the `{nr_kw}` paragraph is not a direct child of `body` (the `check` inside `insert_paras_after` fails), locate its actual parent element and pass that instead of `body`.

New stage 4c — section 9 variants (decisions 3+10). Replace the neutral paragraph stage 4b produced and add the two conditionals:

```python
print("== stage 4c: section 9 MPZP variants (EGiB/MPZP slice) ==")
SEC9_INTRO = ("Przeznaczenie przedmiotowego terenu ustalono na podstawie "
              "dokumentacji planistycznej.")
SEC9_MPZP = ("{#mpzp}Teren objęty miejscowym planem zagospodarowania przestrzennego: "
             "{nazwa} — symbol przeznaczenia {symbol}, uchwała nr {uchwala} "
             "z dnia {data}, publikacja: {publ}.{/mpzp}")
SEC9_BRAK = ("{#mpzp_brak}Dla przedmiotowego terenu brak obowiązującego miejscowego planu "
             "zagospodarowania przestrzennego. Przeznaczenie określono na podstawie studium "
             "uwarunkowań i kierunków zagospodarowania przestrzennego lub decyzji o warunkach "
             "zabudowy: {przeznaczenie_studium}.{/mpzp_brak}")
sec9_anchor = None
for p in body.iter(W_P):
    if para_text(p).strip().startswith("Wobec powyższego, przeznaczenie przedmiotowego terenu"):
        sec9_anchor = p
        break
check(sec9_anchor is not None, "stage 4c: section 9 neutral paragraph found")
set_para_text_collapsed(sec9_anchor, SEC9_INTRO)
insert_paras_after(body, sec9_anchor, [SEC9_MPZP, SEC9_BRAK], "stage 4c variants")
```

Extend the script's `PLACEHOLDERS` list with the same 13 entries as the test, and `EXTRA_FORBIDDEN` with `"4MW/U"`.

- [ ] **Step 3: Regenerate.** `cd /Users/michalczekala/Development/wyceny/tools/spike/2026-07-15-template-koscielna && python3 build_template.py` — must end with all `check()` PASS and write both app-repo artifacts. If `operat-sections.ts` diff is non-empty, headings changed — STOP and investigate (they must not change).

- [ ] **Step 4: Run — expect PASS**: `pnpm --filter web test -- f12-template-integrity` (other F-12 legs still green — render test doesn't know new placeholders yet but uses `nullGetter`-free model… NOTE: `f12-document-sections.test.ts` WILL fail now with unresolved-tag assertions. That is EXPECTED RED handed to Task 8 — run only the integrity test here and note the sections-test failure in the task report; Task 8 goes green the same push? NO — CI runs all tests. Therefore Tasks 7 and 8 are ONE PUSH: commit Task 7 locally WITHOUT pushing, proceed to Task 8, push both commits together.)

- [ ] **Step 5: Commit (NO push yet)** — `feat(web): operat template placeholders for egib facts block and mpzp variants (f-12)`

---

### Task 8: DocumentModel + `buildDocumentModel` + F-12 render/masking tests (push with Task 7)

**Files:**

- Modify: `apps/web/src/domain/document-model.ts`
- Modify: `apps/web/tests/f12-document-sections.test.ts`, `apps/web/tests/f12-document-masking.test.ts`

**Interfaces:**

- Consumes: template contract (Task 7), `SubjectSnapshot` (Task 4).
- Produces: `DocumentModel` gains `obreb, arkusz, nr_dzialki, pow_dzialki, uzytek, budynek_rodzaj, kondygnacje, rok_budowy, przeznaczenie_studium: string`, `mpzp: { symbol: string; nazwa: string; uchwala: string; data: string; publ: string } | null`, `mpzp_brak: boolean`.

- [ ] **Step 1: Failing tests.** `f12-document-masking.test.ts` — extend model unit tests:

```ts
it("maps subject snapshot into document fields", () => {
  const model = buildDocumentModel({
    ...goldenInput(),
    inputs: {
      ...syntheticInputs(),
      subject: {
        obreb: "Jeżyce",
        arkusz: "10",
        nrDzialki: "161",
        powEwidHa: 0.0772,
        uzytek: "B",
        budynekRodzaj: "budynki mieszkalne",
        kondygnacjeNadziemne: 6,
        kondygnacjePodziemne: 1,
        mpzpAbsent: false,
        mpzpSymbol: "1MW/U",
        mpzpNazwa: "Plan Testowy",
        mpzpUchwala: "I/1/2020",
        mpzpData: "2020-01-01",
        mpzpPubl: "Rocznik 2020, poz. 1",
      },
    },
  });
  expect(model.obreb).toBe("Jeżyce");
  expect(model.pow_dzialki).toBe("0,0772");
  expect(model.kondygnacje).toBe("6 / 1");
  expect(model.rok_budowy).toBe("b.d. (brak w publicznej ewidencji)");
  expect(model.mpzp).toEqual({
    symbol: "1MW/U",
    nazwa: "Plan Testowy",
    uchwala: "I/1/2020",
    data: "01.01.2020",
    publ: "Rocznik 2020, poz. 1",
  });
  expect(model.mpzp_brak).toBe(false);
});

it("mpzp absent renders brak variant fields", () => {
  const model = buildDocumentModel({
    ...goldenInput(),
    inputs: {
      ...syntheticInputs(),
      subject: {
        obreb: "Łazarz",
        mpzpAbsent: true,
        przeznaczenieStudium: "zabudowa mieszkaniowa (studium)",
      },
    },
  });
  expect(model.mpzp).toBeNull();
  expect(model.mpzp_brak).toBe(true);
  expect(model.przeznaczenie_studium).toBe("zabudowa mieszkaniowa (studium)");
});

it("legacy inputs without subject render dashes and neither mpzp variant", () => {
  const model = buildDocumentModel(goldenInput());
  expect(model.obreb).toBe("—");
  expect(model.mpzp).toBeNull();
  expect(model.mpzp_brak).toBe(false);
});

it("rok budowy set renders the year", () => {
  const model = buildDocumentModel({
    ...goldenInput(),
    inputs: { ...syntheticInputs(), subject: { rokBudowy: 1938 } },
  });
  expect(model.rok_budowy).toBe("1938");
});
```

(Adapt helper names to the file's actual `goldenInput()`/`syntheticInputs()` helpers — keep their conventions.) `f12-document-sections.test.ts` — extend `renderGolden()` inputs with the full subject (as above, WITH mpzp) and add assertions: rendered text contains `"obręb Jeżyce"`, `"działka nr 161"`, `"symbol przeznaczenia 1MW/U"`, `"uchwała nr I/1/2020"`; does NOT contain `"brak obowiązującego miejscowego planu"`. Add a second render case `renderNoMpzp()` (same but `mpzpAbsent: true`, `przeznaczenieStudium: "zabudowa (studium)"`): contains the brak sentence + `"zabudowa (studium)"`, does NOT contain `"symbol przeznaczenia"`. Keep the existing no-unresolved-tags assertion on both renders.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement in `document-model.ts`.** Type additions per Interfaces. In `buildDocumentModel` (after existing mappings; `DASH = "—"` — reuse the file's existing dash constant if present):

```ts
const subject = input.inputs.subject ?? null;
const DASH = "—";
const ROK_BUDOWY_BD = "b.d. (brak w publicznej ewidencji)";
const hasMpzp = subject != null && subject.mpzpAbsent !== true &&
  Boolean(subject.mpzpSymbol || subject.mpzpNazwa || subject.mpzpUchwala);
// spread into the returned model:
obreb: subject?.obreb || DASH,
arkusz: subject?.arkusz || DASH,
nr_dzialki: subject?.nrDzialki || DASH,
pow_dzialki: subject?.powEwidHa != null ? formatNumber(subject.powEwidHa, 4) : DASH,
uzytek: subject?.uzytek || DASH,
budynek_rodzaj: subject?.budynekRodzaj || DASH,
kondygnacje: subject
  ? `${subject.kondygnacjeNadziemne ?? DASH} / ${subject.kondygnacjePodziemne ?? DASH}`
  : DASH,
rok_budowy: subject?.rokBudowy != null ? String(subject.rokBudowy) : ROK_BUDOWY_BD,
mpzp: hasMpzp
  ? { symbol: subject.mpzpSymbol ?? "", nazwa: subject.mpzpNazwa ?? "",
      uchwala: subject.mpzpUchwala ?? "",
      data: subject.mpzpData ? formatDatePl(subject.mpzpData) : "",
      publ: subject.mpzpPubl ?? "" }
  : null,
mpzp_brak: subject?.mpzpAbsent === true,
przeznaczenie_studium: subject?.przeznaczenieStudium || DASH,
```

- [ ] **Step 4: Run — expect PASS**: full `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` (all F-12 legs green together with Task 7's template).

- [ ] **Step 5: Commit + push BOTH commits + watch CI**

```bash
git add apps/web/src/domain/document-model.ts apps/web/tests/f12-document-sections.test.ts apps/web/tests/f12-document-masking.test.ts
git commit -m "feat(web): document model renders egib facts and mpzp variants (f-12)"
git push && gh run watch --exit-status
```

---

## Out of plan scope (handled by build-slice stages, not tasks)

- **S5 deploy:** worker (`railway up ./apps/worker --path-as-root --service worker-v2` — Dockerfile builder, startCommand without shell) FIRST, then web (`vercel deploy --prod` from monorepo root). NO migration this slice. Live verify on prod: Kościelna 33 → auto-fetch → Jeżyce / AR 10 / dz. 161 / 0,0772 ha / 4MW/U / VII/84/VIII/2019 → confirm → approve → PDF sections 8.2/9; second address without MPZP → brak variant.
- **S6 wiki:** log/timeline/tech page/roadmap PR — includes committing the wiki-repo `build_template.py` changes and the new spike dir `tools/spike/2026-07-17-egib-mpzp/`.
- **Carry-forwards to ledger:** worker endpoints still unauthenticated (now also `/subject-proposal`); KIEG adapter (nationwide parcels) parked; building-on-adjacent-parcel known limitation; e2e live-fetch stub infra still parked (auto-fetch disabled in e2e via `NEXT_PUBLIC_SUBJECT_AUTOFETCH=off`).
