"""RCN (Rejestr Cen Nieruchomości) pure core: GML parsing + comparable-sample selection.

Zero I/O — no network, no clock. Ported from two empirically-verified spikes in
the wyceny wiki repo (`~/Development/wyceny`):

- `tools/spike/2026-05-14-kcs/spike.py::parse_gml` (lines 184-217) — GUGiK WFS
  GML parsing. Price field is `lok_cena_brutto`, NOT `tran_cena_brutto` — a
  spike-pinned trap (the latter looks plausible but is empty in this dataset).
- `tools/spike/2026-07-14-rcn-live-revalidation/spike.py::production_selection`
  (lines 39-67) — "selection v2", proven against a live GUGiK re-run.

Selection v2 exists because of a spike discovery: RCN contains garbage
transaction dates from the future or elsewhere (e.g. `5201-07`, `2913-04`) —
apparent typos in the source registry. Fetching with `sortBy=dok_data D`
(newest first, needed to avoid ancient records dominating the pool) pulls
these garbage rows to the very top. Without a date-sanity filter, the
"newest N" selection would be poisoned by them. Callers of `select_sample`
MUST pass a real `today_month` — never trust the caller to have pre-filtered
dates.
"""

import json
import math
import re
import urllib.parse
import urllib.request

POOL_N = 19
AREA_BAND_PCT = 0.30
DATE_WINDOW_MONTHS = 24

# I/O constants — copied verbatim from tools/spike/2026-05-14-kcs/spike.py (lines 24-26).
WFS_URL = "https://mapy.geoportal.gov.pl/wss/service/rcn"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "wyceny-spike/1.0 (contact: czekala.michal@gmail.com)"

# --- v3 pure core (ADR-015) — additive; the v2 parser/selection above are
# replaced (not deleted) in Task 4. PAGE_SIZE/SORT_BY are the v3 fetch params;
# WFS_URL/NOMINATIM/USER_AGENT/DATE_WINDOW_MONTHS above are reused as-is.

PAGE_SIZE = 5000
SORT_BY = "dok_data D,tran_lokalny_id_iip D"

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
    """The earliest "YYYY-MM" still inside the date-sanity window.

    Public v3 twin of `_floor_month`.
    """
    year, month = int(today_month[:4]), int(today_month[5:7])
    total = year * 12 + (month - 1) - window_months
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def parse_gml(gml: str) -> list[dict]:
    """Parse GUGiK WFS GML into transaction dicts.

    Skips records with missing or non-positive price/area, same as the spike.
    """
    members = re.findall(r"<wfs:member>(.*?)</wfs:member>", gml, re.DOTALL)
    out = []
    for member in members:

        def get(field: str) -> str | None:
            match = re.search(rf"<ms:{field}>([^<]*)</ms:{field}>", member)
            return (match.group(1).strip() if match else "") or None

        def get_float(field: str) -> float | None:
            value = get(field)
            try:
                return float(value) if value else None
            except ValueError:
                return None

        price = get_float("lok_cena_brutto")
        area = get_float("lok_pow_uzyt")
        if price is None or area is None or price <= 0 or area <= 0:
            continue

        pos = re.search(r"<gml:pos>([\d.]+)\s+([\d.]+)</gml:pos>", member)
        x, y = (float(pos.group(1)), float(pos.group(2))) if pos else (None, None)

        date = get("dok_data") or ""
        out.append(
            {
                "transaction_id": get("tran_lokalny_id_iip") or "",
                "price_total": price,
                "area": area,
                "price_per_m2": price / area,
                "date": date[:10],
                "date_month": date[:7],
                "function": get("lok_funkcja") or "",
                "x": x,
                "y": y,
            }
        )
    return out


def _floor_month(today_month: str, window_months: int) -> str:
    """The earliest "YYYY-MM" still inside the date-sanity window."""
    year, month = int(today_month[:4]), int(today_month[5:7])
    total_months = year * 12 + (month - 1) - window_months
    floor_year, floor_month = divmod(total_months, 12)
    return f"{floor_year}-{floor_month + 1:02d}"


def select_sample(transactions: list[dict], subject_area: float, today_month: str) -> list[dict]:
    """Selection v2: residential + date-sane + area-banded + IQR-trimmed, newest first.

    `today_month` (e.g. "2026-07") is a parameter — the core never reads the
    clock, so results are deterministic and testable offline.
    """
    lo_area = subject_area * (1 - AREA_BAND_PCT)
    hi_area = subject_area * (1 + AREA_BAND_PCT)
    floor_month = _floor_month(today_month, DATE_WINDOW_MONTHS)

    pool = [
        t
        for t in transactions
        if t["function"] == "mieszkalna"
        and t["price_per_m2"] > 0
        and floor_month <= t["date_month"] <= today_month
        and lo_area <= t["area"] <= hi_area
    ]

    if len(pool) >= 8:  # IQR only makes sense from a dozen-ish points
        prices = sorted(t["price_per_m2"] for t in pool)
        q1 = prices[len(prices) // 4]
        q3 = prices[(3 * len(prices)) // 4]
        iqr = q3 - q1
        lo_price, hi_price = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        pool = [t for t in pool if lo_price <= t["price_per_m2"] <= hi_price]

    pool.sort(key=lambda t: t["date"], reverse=True)
    return pool[:POOL_N]


def fetch_rcn(
    bbox: tuple[float, float, float, float], count: int = 5000, sort: str = "dok_data D"
) -> str:
    """Fetch raw GML from the GUGiK RCN WFS endpoint for a lat/lon bbox.

    Port of the spike's `fetch_rcn_wgs84` (tools/spike/2026-05-14-kcs/spike.py,
    lines 159-181). `count=5000` + `sortBy=dok_data D` (newest first) is the
    spike-proven combination — smaller counts return a quasi-random subset
    dominated by ancient records. Timeout is 30s (the plan's override of the
    spike's 180s — spike-measured p95 is far below that).
    """
    lat_min, lon_min, lat_max, lon_max = bbox
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typenames": "ms:lokale",
        "count": str(count),
        "srsName": "EPSG:2180",
        "bbox": f"{lat_min},{lon_min},{lat_max},{lon_max},EPSG:4326",
    }
    if sort:
        params["sortBy"] = sort
    url = f"{WFS_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


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
