"""GetMap fetch for operat maps (Slice 9).

Empirical WMS contracts (spike wiki-repo tools/spike/2026-07-21-mapy-wms, 2026-07-21):
- ORTO WMS randomly returns 404 (~12-30% of identical requests, more under burst,
  looks like rate limiting disguised as 404) -> retry with backoff is mandatory.
- KIEG answers 302 to integracja01/02 mirrors -> urllib follows redirects by default.
- WMS 1.3.0 + EPSG:2180 axis order: BBOX=(minNorthing,minEasting,maxNorthing,maxEasting)
  but WIDTH spans the EASTING axis. ULDK WKT pairs are (easting northing).
- FORMAT must be URL-encoded (image%2Fjpeg); JPEG for orthophoto is ~6x smaller than PNG.
"""

import time
import urllib.error
import urllib.parse
import urllib.request

from shapely import wkt as shapely_wkt

ORTO_URL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution"
KIEG_URL = "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow"
KIEG_LAYERS = "dzialki,numery_dzialek,budynki,obreby"
WIDTH, HEIGHT = 1800, 1350  # 4:3, ~285 DPI at 16 cm print width
EWID_HALF_W_MIN = 125.0  # min half-width [m] of the cadastral map box
ORTO_SCALE = 2.0  # orthophoto box = 2x cadastral box (wider context)
HEADERS = {"User-Agent": "wyceny-worker/1.0"}


def _bbox_around(center_e: float, center_n: float, half_w: float) -> tuple:
    half_h = half_w * HEIGHT / WIDTH
    return (center_n - half_h, center_e - half_w, center_n + half_h, center_e + half_w)


def map_bboxes(wkt_2180: str) -> tuple[tuple, tuple]:
    """(ewid bbox, orto bbox), each (minN, minE, maxN, maxE) — WMS 1.3.0 order."""
    min_e, min_n, max_e, max_n = shapely_wkt.loads(wkt_2180).bounds
    center_e, center_n = (min_e + max_e) / 2, (min_n + max_n) / 2
    half_w = max(EWID_HALF_W_MIN, 1.5 * max(max_e - min_e, max_n - min_n))
    return (
        _bbox_around(center_e, center_n, half_w),
        _bbox_around(center_e, center_n, half_w * ORTO_SCALE),
    )


def getmap_url(base: str, layers: str, bbox: tuple, fmt: str) -> str:
    bbox_s = ",".join(f"{v:.2f}" for v in bbox)
    return (
        f"{base}?REQUEST=GetMap&SERVICE=WMS&VERSION=1.3.0&LAYERS={layers}"
        f"&STYLES=&CRS=EPSG:2180&BBOX={bbox_s}&WIDTH={WIDTH}&HEIGHT={HEIGHT}"
        f"&FORMAT={urllib.parse.quote(fmt, safe='')}"
    )


def fetch_map(url: str, attempts: int = 4) -> bytes:
    """Binary GET with retry — ORTO WMS randomly 404s (module docstring)."""
    last: Exception | None = None
    for i in range(attempts):
        if i > 0:
            time.sleep(1)
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            if not (data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8")):
                raise RuntimeError(f"WMS returned non-image ({data[:40]!r})")
            return data
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as exc:
            if isinstance(exc, urllib.error.HTTPError) and exc.code not in (404, 500, 502, 503):
                raise
            last = exc
    raise RuntimeError(f"WMS GetMap failed after {attempts} attempts: {last}")
