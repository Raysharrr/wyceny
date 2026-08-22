"""Street/city of an RCN transaction, from the monthly GEOPOZ export (Slice 3d).

RCN WFS (GUGiK) leaves `lok_adres` empty for Poznań, so the comparables table had a dash
where the reference operat has a street name. The monthly export published by GEOPOZ on
BIP carries the address of every lokal and joins to our pool on `lokalId` — the same key
we already use. Measured 2026-08-22 (`tools/spike/2026-08-22-ulice-z-eksportu-geopoz`,
wiki repo): 12/12 on the proposed sample, 99,7–99,9 % inside city limits, ZERO key
normalisation errors. Transactions outside Poznań (TERYT != 3064) are absent from this
export by definition — they get a dash, not an error.

Parser: stdlib `ElementTree`, deliberately NOT lxml. Same result byte for byte, but the
spike measured **42,6 MB peak RSS against lxml's 807,8 MB** on 268 MB of GML — lxml keeps
the document in its C tree and the usual `el.clear()` frees nothing here, because
`RCN_Lokal` is a child of `gml:featureMember` (clearing an already-empty wrapper).

The GML is RELATIONAL: `gml:featureMember` carries RCN_Transakcja, RCN_Nieruchomosc,
RCN_Lokal and RCN_Dokument side by side, wired with `xlink:href` over `gml:id`.
"""

import gzip
import io
import json
import os
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.logging_setup import log

NS = "urn:gugik:specyfikacje:gmlas:rejestrcennieruchomosci:1.0"
_Q = "{" + NS + "}"
_HREF = "{http://www.w3.org/1999/xlink}href"
_GML_ID = "{http://www.opengis.net/gml/3.2}id"

StreetIndex = dict[str, dict[str, str]]
Status = Literal["ready", "building", "unavailable"]


def parse_street_index(path: str | Path) -> tuple[StreetIndex, str]:
    """Build `lokalId -> {ulica, nr, miejscowosc}` from one export file, with its cut-off.

    The cut-off is the newest `dataSporzadzeniaDokumentu` in the file, taken from CONTENT —
    never from the file name or `Last-Modified` (the spike saw 4 days between the newest
    act and publication). It is read from the documents DIRECTLY rather than by walking
    Transakcja -> podstawaPrawna: both give the same date on the real export
    (2026-08-13), and the walk costs a graph of ~200 000 entries in memory (137 MB against
    18 MB) for a number that never differs.

    Lokale without an address are left OUT of the index rather than stored as empty
    strings, so the caller can tell "no address" from "not in the export".
    """
    index: StreetIndex = {}
    cutoff = ""

    context = ET.iterparse(str(path), events=("start", "end"))
    _, root = next(context)
    for event, el in context:
        if event != "end":
            continue
        if el.tag == _Q + "RCN_Lokal":
            lokal_id = (el.findtext(_Q + "idLokalu") or "").strip()
            street = (el.findtext(f".//{_Q}ulica") or "").strip()
            if lokal_id and street:
                index[lokal_id] = {
                    "ulica": street,
                    "nr": (el.findtext(f".//{_Q}numerPorzadkowy") or "").strip(),
                    "miejscowosc": (el.findtext(f".//{_Q}miejscowosc") or "").strip(),
                }
        elif el.tag == _Q + "RCN_Dokument":
            date = (el.findtext(_Q + "dataSporzadzeniaDokumentu") or "").strip()[:10]
            # RCN carries typo dates from the future (the WFS pool has 2070-9200); a single
            # one of those would push the cut-off decades ahead and silence the
            # "newer than the export" badge for good.
            if "1990-01-01" <= date <= "2100-12-31" and date > cutoff:
                cutoff = date
        elif el.tag.endswith("}featureMember"):
            # The ONLY line keeping memory flat — without it the tree grows to the size of
            # the file (268 MB of GML). Measured on the real export: 18 MB peak RSS.
            root.clear()

    return index, cutoff


# Ścieżki z BIP GEOPOZ — stałe od co najmniej sierpnia 2026 (spike sprawdził oba HEAD-em).
# Gdyby ID kiedyś się obróciło, listę linków da się odczytać ze strony BIP (dataset 28509
# na dane.gov.pl wystawia tylko odsyłacz HTML, bez `file_url`).
EXPORTS = (
    "https://bip.geopoz.poznan.pl/download/119/9590/BazaDanychRCNPoznan202614.zip",
    "https://bip.geopoz.poznan.pl/download/119/9591/BazaDanychRCNPoznan2021-202514.zip",
)
CACHE_NAME = "rcn-street-index.json.gz"
USER_AGENT = "wyceny-worker/1.0 (contact: czekala.michal@gmail.com)"
_TIMEOUT_S = 120


@dataclass(frozen=True)
class StreetIndexSnapshot:
    """One build of the index: the addresses, the export cut-off and the signature it was
    built from (`Last-Modified`/`ETag` of both packages — how a new month is detected)."""

    streets: StreetIndex
    cutoff: str
    signature: str
    generated_at: str


def _http_get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=_TIMEOUT_S) as response:
        return response.read()


def _http_signature(url: str) -> str:
    """`Last-Modified` + `ETag` from a HEAD — 13 MB stay on the server when nothing changed."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="HEAD")
    with urllib.request.urlopen(request, timeout=30) as response:
        return f"{response.headers.get('Last-Modified', '')}|{response.headers.get('ETag', '')}"


def remote_signature(head=_http_signature) -> str:
    return "::".join(head(url) for url in EXPORTS)


def build_snapshot(cache_dir: Path, fetch=_http_get, head=_http_signature) -> StreetIndexSnapshot:
    """Download both packages, unzip in memory, parse, return the snapshot.

    ~13 MB over the wire and ~5 s of parsing for 52 823 lokale — a monthly cost, not a
    per-request one. The GML is unzipped to `cache_dir` rather than held in memory
    (268 MB of text) and removed right after parsing.
    """
    streets: StreetIndex = {}
    cutoff = ""
    for url in EXPORTS:
        gml_path = cache_dir / f"{url.rsplit('/', 1)[-1]}.gml"
        with zipfile.ZipFile(io.BytesIO(fetch(url))) as archive:
            member = archive.namelist()[0]
            with archive.open(member) as source, open(gml_path, "wb") as target:
                while chunk := source.read(1 << 20):
                    target.write(chunk)
        try:
            index, file_cutoff = parse_street_index(gml_path)
        finally:
            gml_path.unlink(missing_ok=True)
        streets.update(index)
        cutoff = max(cutoff, file_cutoff)
    return StreetIndexSnapshot(
        streets=streets,
        cutoff=cutoff,
        signature=remote_signature(head),
        generated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


def save_cached(cache_dir: Path, snapshot: StreetIndexSnapshot) -> None:
    """~600 KB gzipped — a restart costs a read, not a rebuild."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "signature": snapshot.signature,
        "cutoff": snapshot.cutoff,
        "generatedAt": snapshot.generated_at,
        "streets": snapshot.streets,
    }
    (cache_dir / CACHE_NAME).write_bytes(
        gzip.compress(json.dumps(payload, ensure_ascii=False).encode())
    )


def load_cached(cache_dir: Path, expected_signature: str) -> StreetIndexSnapshot | None:
    """The cached snapshot when it was built from the CURRENT export, else None.

    A missing, unreadable or stale cache is not an error — it just means "rebuild".
    """
    path = cache_dir / CACHE_NAME
    try:
        payload = json.loads(gzip.decompress(path.read_bytes()))
    except (OSError, ValueError, EOFError):
        return None
    if payload.get("signature") != expected_signature:
        return None
    return StreetIndexSnapshot(
        streets=payload["streets"],
        cutoff=payload["cutoff"],
        signature=payload["signature"],
        generated_at=payload["generatedAt"],
    )


# --------------------------------------------------------------------- serwis
# Modułowy stan zamiast klasy: testy podmieniają `status`/`lookup` przez
# `monkeypatch.setattr(street_index, ...)`, jak resztę I/O w tym workerze.

CACHE_DIR = Path(os.environ.get("STREET_INDEX_CACHE_DIR", "/tmp"))

_lock = threading.Lock()
_snapshot: StreetIndexSnapshot | None = None
_status: Status = "unavailable"


def status() -> Status:
    """`ready` gdy indeks obsługuje zapytania, `building` w trakcie budowy,
    `unavailable` gdy ostatnia próba się nie powiodła."""
    return _status


def cutoff() -> str | None:
    return _snapshot.cutoff if _snapshot else None


def generated_at() -> str | None:
    return _snapshot.generated_at if _snapshot else None


def lookup(lokal_id: str) -> dict[str, str] | None:
    """Address of one lokal, or None — a transaction outside Poznań, a lokal without an
    address in the export, or an index that is not ready yet. The caller renders a dash
    for all three; only the `status` above tells them apart."""
    return _snapshot.streets.get(lokal_id) if _snapshot else None


def _build_now(fetch=_http_get, head=_http_signature) -> None:
    """Runs INSIDE a worker thread — `urllib` and `iterparse` are synchronous and
    CPU-bound, so on uvicorn's event loop they would stall the healthcheck and every
    in-flight request for the ~7 s the build takes."""
    global _snapshot, _status
    started = time.monotonic()
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        signature = remote_signature(head)
        snapshot = load_cached(CACHE_DIR, signature)
        source = "cache"
        if snapshot is None:
            snapshot = build_snapshot(CACHE_DIR, fetch=fetch, head=head)
            save_cached(CACHE_DIR, snapshot)
            source = "download"
        _snapshot, _status = snapshot, "ready"
        # F-13: liczby i klasy, nigdy adres.
        log.info(
            "street_index_ready",
            source=source,
            entries=len(snapshot.streets),
            cutoff=snapshot.cutoff,
            took_ms=round((time.monotonic() - started) * 1000),
        )
    except Exception as exc:  # noqa: BLE001 — brak indeksu to kreska w UI, nie awaria próby
        _status = "unavailable"
        log.warning(
            "street_index_failed",
            err_type=type(exc).__name__,
            took_ms=round((time.monotonic() - started) * 1000),
        )
    finally:
        _lock.release()


def autostart_enabled() -> bool:
    """`STREET_INDEX=off` keeps the build from ever starting.

    The e2e job in CI is deliberately network-free (every fetch behind an env flag, see
    `.github/workflows/ci.yml`) — without this switch the worker would pull 13 MB from BIP
    on startup and quietly break that rule. Same reason the test suite disables the
    autostart in `tests/conftest.py`.
    """
    return os.environ.get("STREET_INDEX", "").lower() not in {"off", "0", "false"}


def ensure_started(fetch=_http_get, head=_http_signature) -> None:
    """Start a build unless one is running, finished or switched off. Idempotent — called
    both on startup and from the request path, so a restart mid-month costs a cache read
    and a cold worker still answers the first request (without streets)."""
    global _status
    if not autostart_enabled() or _status == "ready" or not _lock.acquire(blocking=False):
        return
    _status = "building"
    threading.Thread(
        target=_build_now, kwargs={"fetch": fetch, "head": head}, name="street-index", daemon=True
    ).start()
