"""RCN (Rejestr Cen Nieruchomości): GML parsing/pool assembly (pure) + WFS/Nominatim I/O.

Ported from tools/spike/2026-05-14-kcs/spike.py (wyceny wiki repo). Price field is
`lok_cena_brutto`, NOT `tran_cena_brutto` — a spike-pinned trap (the latter looks
plausible but is empty in this dataset).

RCN contains garbage transaction dates from the future or elsewhere (e.g. `5201-07`,
`2913-04`) — apparent typos in the source registry. `fetch_pool` (ADR-015) pages with
`sortBy=dok_data D,tran_lokalny_id_iip D` (newest first) and stops once a page's
oldest *sane* date falls before the 24-month window floor; garbage dates are ignored
for that stop rule so they never end the pool early. Callers pass a real
`today_month` — the core never reads the clock.
"""

import json
import math
import re
import urllib.parse
import urllib.request

DATE_WINDOW_MONTHS = 24
PAGE_SIZE = 5000
SORT_BY = "dok_data D,tran_lokalny_id_iip D"

# GUGiK RCN WFS + Nominatim geocoder endpoints.
WFS_URL = "https://mapy.geoportal.gov.pl/wss/service/rcn"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "wyceny-worker/1.0 (contact: czekala.michal@gmail.com)"

_MEMBER_RX = re.compile(r"<wfs:member>(.*?)</wfs:member>", re.DOTALL)
_POS_RX = re.compile(r"<gml:pos>([\d.]+)\s+([\d.]+)</gml:pos>")
_RETURNED_RX = re.compile(r'numberReturned="(\d+)"')
# TERYT.OBREB[.AR_ARKUSZ].DZIALKA.BUDYNEK_BUD.LOKAL_LOK — Poznań has AR_, neighbouring
# gminas don't (ADR-015 rule 3).
_LOKAL_ID_RX = re.compile(r"^(\d{6}_\d)\.(\d+)\.(?:AR_(\d+)\.)?([^.]+)\.(\d+)_BUD\.(.+)_LOK$")


def parse_lokal_id(lokal_id: str) -> dict | None:
    """Parse a lok_id_lokalu EGIB identifier (see egib-id.ts for the TS twin)."""
    m = _LOKAL_ID_RX.match(lokal_id.strip())
    if not m:
        return None
    teryt, obreb, arkusz, dzialka, budynek, lokal = m.groups()
    return {
        "teryt": teryt,
        "obreb": obreb.lstrip("0").rjust(4, "0"),
        "arkusz": (arkusz or "").lstrip("0"),
        "dzialka": dzialka,
        "budynek": budynek,
        "lokal": lokal,
    }


def _float(s: str) -> float:
    try:
        value = float(s) if s else 0.0
    except ValueError:
        return 0.0
    return value if math.isfinite(value) else 0.0


def _int(s: str) -> int | None:
    try:
        return int(float(s)) if s else None
    except (ValueError, OverflowError):
        return None


def parse_candidates(gml: str, subject_xy: tuple[float, float]) -> list[dict]:
    """Every member becomes a candidate — hygiene is the web domain's job.

    Spec: the worker rejects nothing.
    """
    sx, sy = subject_xy
    out: list[dict] = []
    for member in _MEMBER_RX.findall(gml):

        def get(field: str) -> str:
            m = re.search(rf"<ms:{field}>([^<]*)</ms:{field}>", member)
            return m.group(1).strip() if m else ""

        price, area = _float(get("lok_cena_brutto")), _float(get("lok_pow_uzyt"))
        pos_m = _POS_RX.search(member)
        pos = None
        distance = float("inf")
        if pos_m:
            northing, easting = float(pos_m.group(1)), float(pos_m.group(2))
            pos = {"x": easting, "y": northing}
            distance = math.hypot(easting - sx, northing - sy)
        market = get("tran_rodzaj_rynku")
        lokal_id = get("lok_id_lokalu")
        out.append(
            {
                "transactionId": get("tran_lokalny_id_iip"),
                "versionId": get("tran_wersja_id"),
                "lokalId": lokal_id,
                "date": get("dok_data")[:10],
                "area": area,
                "pricePerM2": price / area if price > 0 and area > 0 else 0.0,
                "priceTotal": price,
                "egib": parse_lokal_id(lokal_id),
                "distanceM": distance,
                "floor": _int(get("lok_nr_kond")),
                "rooms": _int(get("lok_liczba_izb")),
                "market": market if market in ("wtorny", "pierwotny") else None,
                "share": get("nier_udzial"),
                "transType": get("tran_rodzaj_trans"),
                "function": get("lok_funkcja"),
                "seller": get("tran_sprzedajacy") or None,
                "pos": pos,
            }
        )
    return out


def dedupe_pair(records: list[dict]) -> tuple[list[dict], int]:
    """ADR-015 rule 2: key = (tran_lokalny_id_iip, lok_id_lokalu), keep the highest
    tran_wersja_id.
    """
    best: dict[tuple[str, str], dict] = {}
    dropped = 0
    for r in records:
        k = (r["transactionId"], r["lokalId"])
        prev = best.get(k)
        if prev is None:
            best[k] = r
        else:
            dropped += 1
            if r["versionId"] > prev["versionId"]:
                best[k] = r
    return list(best.values()), dropped


def number_returned(gml: str) -> int:
    """numberReturned="N" from the collection root, 0 when absent."""
    m = _RETURNED_RX.search(gml)
    return int(m.group(1)) if m else 0


def floor_month(today_month: str, window_months: int) -> str:
    """The earliest "YYYY-MM" still inside the date-sanity window."""
    year, month = int(today_month[:4]), int(today_month[5:7])
    total = year * 12 + (month - 1) - window_months
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def bbox_for(x: float, y: float, radius_m: float) -> tuple[float, float, float, float]:
    """EPSG:2180 bbox around (easting x, northing y) — the WFS wants northing,easting order."""
    return (y - radius_m, x - radius_m, y + radius_m, x + radius_m)


def fetch_rcn(
    bbox: tuple[float, float, float, float],
    count: int = PAGE_SIZE,
    sort: str = SORT_BY,
    start_index: int = 0,
) -> str:
    """Fetch one page of raw GML from the GUGiK RCN WFS for an EPSG:2180 bbox.

    `bbox` is (y_min, x_min, y_max, x_max) — see `bbox_for`. `start_index` supports
    ADR-015 pagination.
    """
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typenames": "ms:lokale",
        "count": str(count),
        "srsName": "EPSG:2180",
        "bbox": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},EPSG:2180",
        "sortBy": sort,
    }
    if start_index:
        params["startIndex"] = str(start_index)
    url = f"{WFS_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8")


def _oldest_sane_month(records: list[dict]) -> str | None:
    """The earliest "YYYY-MM" among dates in a plausible (1990-2100) range."""
    months = [r["date"][:7] for r in records if "1990-01" <= r["date"][:7] <= "2100-12"]
    return min(months) if months else None


def fetch_pool(
    x: float,
    y: float,
    radius_m: float,
    today_month: str,
    *,
    fetch=None,
    max_pages: int = 8,
) -> dict:
    """ADR-015 rule 1: page with startIndex until the 24-month window is covered.

    `truncated` = the last page was full and the window floor was not yet reached —
    the pool may be incomplete (page cap or no sane dates on that final page).
    """
    fetch = fetch or fetch_rcn
    bbox = bbox_for(x, y, radius_m)
    floor = floor_month(today_month, DATE_WINDOW_MONTHS)
    raw: list[dict] = []
    pages = 0
    covered = False
    for page in range(max_pages):
        gml = fetch(bbox, PAGE_SIZE, SORT_BY, page * PAGE_SIZE)
        records = parse_candidates(gml, (x, y))
        returned = number_returned(gml)
        raw.extend(records)
        pages += 1
        oldest = _oldest_sane_month(records)
        covered = returned < PAGE_SIZE or (oldest is not None and oldest < floor)
        if covered:
            break
    return {"raw": raw, "pages": pages, "truncated": not covered, "bbox": list(bbox)}


_STREET_PREFIXES = ("ul.", "pl.", "al.", "os.")

# "NN-NNN" only — a building range like "21-23" is \d{2}-\d{2} and stays intact.
_POSTAL_CODE_RX = re.compile(r"\b\d{2}-\d{3}\b")


def parse_address(address: str) -> tuple[str, str]:
    """Split an address into (city, street), accepting both comma orders.

    The spike assumed "Miasto, ul. Nazwa nr", but the web form's placeholder
    (and real users) use "ul. Nazwa nr, Miasto" — 2026-07-14 prod QA caught
    street-first input geocoding to nothing. A part that carries a street
    prefix or a house number is treated as the street regardless of order.

    Postal codes are dropped first: staging incident 3d23717d had digits in
    "61-619 Poznań" read as a house number, so the halves never swapped and
    both geocoders got an inverted query. Neither Nominatim nor UUG needs
    the code to resolve a street address.
    """
    address = _POSTAL_CODE_RX.sub(" ", address)
    address = re.sub(r"\s{2,}", " ", address).strip()
    match = re.match(r"^([^,]+),\s*(.+)$", address)
    if not match:
        return "Poznań", re.sub(r"^(ul\.|pl\.|al\.|os\.)\s*", "", address.strip())
    first, second = match.group(1).strip(), match.group(2).strip()

    def looks_like_street(part: str) -> bool:
        return part.lower().startswith(_STREET_PREFIXES) or any(ch.isdigit() for ch in part)

    if looks_like_street(first) and not looks_like_street(second):
        first, second = second, first
    street = re.sub(r"^(ul\.|pl\.|al\.|os\.)\s*", "", second)
    return first, street


def geocode(address: str) -> tuple[float, float]:
    """Geocode a Polish address via Nominatim (both "Miasto, ulica" and "ulica, Miasto").

    Port of the spike's `geocode_nominatim` (tools/spike/2026-05-14-kcs/spike.py,
    lines 220-248). Nominatim dislikes the "ul." prefix, so a structured
    street/city query is tried first, with a `q=` fallback for addresses
    that don't match the expected shape.
    """
    city, street = parse_address(address)

    params = {"street": street, "city": city, "country": "Poland", "format": "json", "limit": 1}
    url = f"{NOMINATIM}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    if not data:
        params2 = {"q": f"{street}, {city}", "format": "json", "limit": 1, "countrycodes": "pl"}
        url2 = f"{NOMINATIM}?{urllib.parse.urlencode(params2)}"
        req2 = urllib.request.Request(url2, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req2, timeout=30) as resp2:
            data = json.loads(resp2.read())
        if not data:
            raise RuntimeError(f"Nominatim nic nie znalazł (struct ani q): {address}")

    return float(data[0]["lat"]), float(data[0]["lon"])
