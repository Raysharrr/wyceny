"""Offline tests for the GEOPOZ street index. NO network — GML is built in-test.

The monthly RCN export from BIP GEOPOZ is the only public source carrying the street
of a Poznań transaction (RCN WFS leaves the address empty here). Spike 2026-08-22
(wiki: tools/spike/2026-08-22-ulice-z-eksportu-geopoz) measured 12/12 coverage on the
proposed sample and 99,7–99,9 % inside city limits.

The export GML is RELATIONAL, not nested: `gml:featureMember` carries RCN_Transakcja,
RCN_Nieruchomosc, RCN_Lokal and RCN_Dokument side by side, wired with `xlink:href`
over `gml:id`. Reaching a lokal's transaction date means walking
Transakcja → nieruchomosc → Lokal and Transakcja → podstawaPrawna → Dokument.
"""

from app.street_index import parse_street_index

NS = (
    'xmlns:gml="http://www.opengis.net/gml/3.2" '
    'xmlns:xlink="http://www.w3.org/1999/xlink" '
    'xmlns:rcn="urn:gugik:specyfikacje:gmlas:rejestrcennieruchomosci:1.0"'
)


def lokal(
    gml_id: str, lokal_id: str, street: str | None = "ul. Kościelna", number: str = "33A"
) -> str:
    address = (
        f"""
 <rcn:adresBudynkuZLokalem>
  <rcn:RCN_Adres>
   <rcn:miejscowosc>Poznań</rcn:miejscowosc>
   <rcn:ulica>{street}</rcn:ulica>
   <rcn:numerPorzadkowy>{number}</rcn:numerPorzadkowy>
  </rcn:RCN_Adres>
 </rcn:adresBudynkuZLokalem>"""
        if street is not None
        else ""
    )
    return f"""<gml:featureMember>
<rcn:RCN_Lokal gml:id="{gml_id}">
 <rcn:idLokalu>{lokal_id}</rcn:idLokalu>
 <rcn:powUzytkowaLokalu uom="m2">55.5</rcn:powUzytkowaLokalu>{address}
</rcn:RCN_Lokal>
</gml:featureMember>"""


def dokument(gml_id: str, date: str) -> str:
    return f"""<gml:featureMember>
<rcn:RCN_Dokument gml:id="{gml_id}">
 <rcn:dataSporzadzeniaDokumentu>{date}</rcn:dataSporzadzeniaDokumentu>
</rcn:RCN_Dokument>
</gml:featureMember>"""


def nieruchomosc(gml_id: str, lokal_href: str) -> str:
    return f"""<gml:featureMember>
<rcn:RCN_Nieruchomosc gml:id="{gml_id}">
 <rcn:lokal xlink:href="{lokal_href}"/>
</rcn:RCN_Nieruchomosc>
</gml:featureMember>"""


def transakcja(local_id: str, doc_href: str, nier_href: str) -> str:
    return f"""<gml:featureMember>
<rcn:RCN_Transakcja gml:id="TX.{local_id}">
 <rcn:IdRCN><rcn:RCN_IdentyfikatorIIP><rcn:lokalnyId>{local_id}</rcn:lokalnyId>
 </rcn:RCN_IdentyfikatorIIP></rcn:IdRCN>
 <rcn:podstawaPrawna xlink:href="{doc_href}"/>
 <rcn:nieruchomosc xlink:href="{nier_href}"/>
</rcn:RCN_Transakcja>
</gml:featureMember>"""


def write_gml(tmp_path, *members: str):
    path = tmp_path / "export.gml"
    path.write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<gml:FeatureCollection {NS}>\n'
        + "\n".join(members)
        + "\n</gml:FeatureCollection>",
        encoding="utf-8",
    )
    return path


def test_index_carries_street_number_and_city(tmp_path):
    path = write_gml(
        tmp_path,
        dokument("D1", "2026-08-13"),
        lokal("L1", "306401_1.0021.AR_10.27.2_BUD.5_LOK"),
        nieruchomosc("N1", "L1"),
        transakcja("00000113-0000-0000-0000-000000417939", "D1", "N1"),
    )
    index, cutoff = parse_street_index(path)

    assert index["306401_1.0021.AR_10.27.2_BUD.5_LOK"] == {
        "ulica": "ul. Kościelna",
        "nr": "33A",
        "miejscowosc": "Poznań",
    }
    assert cutoff == "2026-08-13"


def test_cutoff_is_the_newest_document_date_not_the_first_seen(tmp_path):
    """The export cut-off comes from CONTENT, never from the file name or Last-Modified —
    the spike measured 4 days between the newest act (2026-08-13) and publication."""
    path = write_gml(
        tmp_path,
        dokument("D1", "2026-08-13"),
        dokument("D2", "2016-11-10"),
        lokal("L1", "A.1_BUD.1_LOK"),
        lokal("L2", "B.1_BUD.1_LOK"),
        nieruchomosc("N1", "L1"),
        nieruchomosc("N2", "L2"),
        transakcja("TX-NEW", "D1", "N1"),
        transakcja("TX-OLD", "D2", "N2"),
    )
    _, cutoff = parse_street_index(path)
    assert cutoff == "2026-08-13"


def test_lokal_without_address_is_absent_from_the_index(tmp_path):
    """Spike: 52 823 of 52 915 lokale carry a street — the rest must not appear as empty
    strings, or the caller cannot tell 'no address' from 'not in the export'."""
    path = write_gml(
        tmp_path,
        dokument("D1", "2026-08-13"),
        lokal("L1", "NO-ADDRESS.1_BUD.1_LOK", street=None),
        nieruchomosc("N1", "L1"),
        transakcja("TX1", "D1", "N1"),
    )
    index, _ = parse_street_index(path)
    assert "NO-ADDRESS.1_BUD.1_LOK" not in index


def test_lokal_without_a_transaction_still_carries_its_address(tmp_path):
    """4 193 orphans in the real 2021-2025 export. The column needs the address; the date
    only serves diagnostics, so an orphan is kept rather than dropped."""
    path = write_gml(
        tmp_path, lokal("L9", "ORPHAN.1_BUD.1_LOK", street="os. Zwycięstwa", number="12")
    )
    index, _ = parse_street_index(path)
    assert index["ORPHAN.1_BUD.1_LOK"]["ulica"] == "os. Zwycięstwa"


def test_one_act_with_several_lokale_indexes_every_one(tmp_path):
    """Heweliusza 3/43 is exactly this shape — 16 lokale under one act. Dedup by
    transaction alone would collapse them; the index is keyed by lokalId."""
    path = write_gml(
        tmp_path,
        dokument("D1", "2026-07-01"),
        lokal("L1", "SAME.1_BUD.1_LOK", number="3"),
        lokal("L2", "SAME.1_BUD.2_LOK", number="3"),
        nieruchomosc("N1", "L1"),
        nieruchomosc("N2", "L2"),
        transakcja("TX1", "D1", "N1"),
        transakcja("TX1b", "D1", "N2"),
    )
    index, _ = parse_street_index(path)
    assert set(index) == {"SAME.1_BUD.1_LOK", "SAME.1_BUD.2_LOK"}


def test_typo_date_from_the_future_does_not_move_the_cutoff(tmp_path):
    """RCN carries typo dates (the WFS pool has 2070-9200). One of them would push the
    cut-off decades ahead and silence the "newer than the export" badge for good."""
    path = write_gml(
        tmp_path,
        dokument("D1", "2026-08-13"),
        dokument("D2", "9200-04-01"),
        lokal("L1", "A.1_BUD.1_LOK"),
    )
    _, cutoff = parse_street_index(path)
    assert cutoff == "2026-08-13"


# --------------------------------------------------------------- pobranie i cache
# I/O przez wstrzykiwany `fetch`, jak `rcn.fetch_pool(fetch=...)` — testy zostają offline.

from app.street_index import (  # noqa: E402
    build_snapshot,
    load_cached,
    remote_signature,
    save_cached,
)


def zipped(gml: str) -> bytes:
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("export.gml", gml)
    return buf.getvalue()


def fake_source(tmp_path, signature="sig-1"):
    """Zwraca (fetch, head, licznik pobrań)."""
    gml = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n<gml:FeatureCollection {NS}>\n'
        + dokument("D1", "2026-08-13")
        + lokal("L1", "306401_1.0021.AR_10.27.2_BUD.5_LOK")
        + "\n</gml:FeatureCollection>"
    )
    calls = {"fetch": 0, "head": 0}

    def fetch(url: str) -> bytes:
        calls["fetch"] += 1
        return zipped(gml)

    def head(url: str) -> str:
        calls["head"] += 1
        return signature

    return fetch, head, calls


def test_snapshot_carries_index_cutoff_and_signature(tmp_path):
    fetch, head, calls = fake_source(tmp_path)
    snap = build_snapshot(cache_dir=tmp_path, fetch=fetch, head=head)

    assert snap.streets["306401_1.0021.AR_10.27.2_BUD.5_LOK"]["ulica"] == "ul. Kościelna"
    assert snap.cutoff == "2026-08-13"
    assert snap.signature  # z Last-Modified/ETag obu paczek — po tym wykrywamy nowy miesiąc
    assert calls["fetch"] == 2  # paczka roku bieżącego + archiwalna


def test_unchanged_signature_serves_the_cache_without_downloading(tmp_path):
    """Pełne pobranie ma się zdarzać raz na miesiąc, nie raz na restart."""
    fetch, head, calls = fake_source(tmp_path)
    first = build_snapshot(cache_dir=tmp_path, fetch=fetch, head=head)
    save_cached(tmp_path, first)

    cached = load_cached(tmp_path, expected_signature=remote_signature(head))
    assert cached is not None
    assert cached.cutoff == first.cutoff
    assert cached.streets == first.streets
    assert calls["fetch"] == 2  # ani jednego pobrania więcej


def test_new_month_invalidates_the_cache(tmp_path):
    fetch, head, _ = fake_source(tmp_path, signature="sig-1")
    save_cached(tmp_path, build_snapshot(cache_dir=tmp_path, fetch=fetch, head=head))

    assert load_cached(tmp_path, expected_signature="sig-2-nowy-miesiac") is None


def test_missing_cache_is_not_an_error(tmp_path):
    assert load_cached(tmp_path, expected_signature="cokolwiek") is None
