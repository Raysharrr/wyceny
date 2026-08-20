"""Offline tests for the RCN pure core. NO network — GML is built in-test."""

from app.rcn import (
    AREA_BAND_PCT,
    POOL_N,
    dedupe_pair,
    floor_month,
    number_returned,
    parse_candidates,
    parse_gml,
    parse_lokal_id,
    select_sample,
)

SUBJECT = (355300.15, 505330.31)  # easting, northing (EPSG:2180)


def make_member(
    price="700000",
    area="55.5",
    date="2026-04-15T00:00:00",
    function="mieszkalna",
    tid="T1",
    version="2026-04-20T10:00:00",
    lokal_id="306401_1.0039.AR_22.13/24.1_BUD.7_LOK",
    market="",
    share="1/1",
    trans="wolnyRynek",
    seller="osobaFizyczna",
    floor="2",
    rooms="3",
    pos="505330.31 355400.15",  # northing easting — as the WFS returns it
):
    return f"""<wfs:member><ms:lokale>
      <ms:tran_lokalny_id_iip>{tid}</ms:tran_lokalny_id_iip>
      <ms:tran_wersja_id>{version}</ms:tran_wersja_id>
      <ms:lok_id_lokalu>{lokal_id}</ms:lok_id_lokalu>
      <ms:lok_cena_brutto>{price}</ms:lok_cena_brutto>
      <ms:lok_pow_uzyt>{area}</ms:lok_pow_uzyt>
      <ms:dok_data>{date}</ms:dok_data>
      <ms:lok_funkcja>{function}</ms:lok_funkcja>
      <ms:tran_rodzaj_trans>{trans}</ms:tran_rodzaj_trans>
      <ms:tran_rodzaj_rynku>{market}</ms:tran_rodzaj_rynku>
      <ms:nier_udzial>{share}</ms:nier_udzial>
      <ms:tran_sprzedajacy>{seller}</ms:tran_sprzedajacy>
      <ms:lok_nr_kond>{floor}</ms:lok_nr_kond>
      <ms:lok_liczba_izb>{rooms}</ms:lok_liczba_izb>
      <gml:pos>{pos}</gml:pos>
    </ms:lokale></wfs:member>"""


def wrap(members, returned=None):
    n = len(members) if returned is None else returned
    return (
        f'<wfs:FeatureCollection numberMatched="unknown" numberReturned="{n}">'
        f"{''.join(members)}</wfs:FeatureCollection>"
    )


def test_parse_lokal_id_both_formats():
    assert parse_lokal_id("306401_1.0021.AR_04.27.2_BUD.11_LOK") == {
        "teryt": "306401_1",
        "obreb": "0021",
        "arkusz": "4",
        "dzialka": "27",
        "budynek": "2",
        "lokal": "11",
    }
    assert parse_lokal_id("302104_2.0006.103/18.1_BUD.29_LOK") == {
        "teryt": "302104_2",
        "obreb": "0006",
        "arkusz": "",
        "dzialka": "103/18",
        "budynek": "1",
        "lokal": "29",
    }
    assert parse_lokal_id("306401_1.21.AR_10.27.2_BUD.11_LOK")["obreb"] == "0021"
    assert parse_lokal_id("") is None
    assert parse_lokal_id("306401_1.0021.AR_10.27") is None


def test_parse_candidates_reads_every_field_and_normalises_pos_and_distance():
    out = parse_candidates(wrap([make_member()]), SUBJECT)
    assert len(out) == 1
    t = out[0]
    assert t["transactionId"] == "T1"
    assert t["versionId"] == "2026-04-20T10:00:00"
    assert t["date"] == "2026-04-15"
    assert t["area"] == 55.5 and t["priceTotal"] == 700000.0
    assert round(t["pricePerM2"], 2) == 12612.61
    assert t["egib"]["dzialka"] == "13/24" and t["egib"]["budynek"] == "1"
    assert t["pos"] == {"x": 355400.15, "y": 505330.31}
    assert round(t["distanceM"], 2) == 100.0
    assert t["floor"] == 2 and t["rooms"] == 3
    assert t["market"] is None and t["share"] == "1/1" and t["transType"] == "wolnyRynek"
    assert t["seller"] == "osobaFizyczna" and t["function"] == "mieszkalna"


def test_parse_candidates_keeps_records_without_price_and_maps_market_values():
    gml = wrap(
        [
            make_member(tid="A", price="", area=""),
            make_member(tid="B", market="wtorny"),
            make_member(tid="C", market="pierwotny"),
            make_member(tid="D", market="cokolwiek", pos=""),
        ]
    )
    out = parse_candidates(gml, SUBJECT)
    assert [t["transactionId"] for t in out] == ["A", "B", "C", "D"]
    assert out[0]["pricePerM2"] == 0 and out[0]["area"] == 0 and out[0]["priceTotal"] == 0
    assert [t["market"] for t in out] == [None, "wtorny", "pierwotny", None]
    assert out[3]["pos"] is None and out[3]["distanceM"] == float("inf")


def test_parse_candidates_egib_is_none_for_unparsable_id_and_missing_fields_are_none():
    t = parse_candidates(
        wrap([make_member(lokal_id="garbage", floor="", rooms="", seller="")]), SUBJECT
    )[0]
    assert t["egib"] is None and t["lokalId"] == "garbage"
    assert t["floor"] is None and t["rooms"] is None and t["seller"] is None


def test_dedupe_pair_keeps_highest_version_per_transaction_and_lokal():
    # A fourth L1 record with an OLDER version arrives last — a "last record wins"
    # implementation would wrongly keep it (300000.0). Correct behaviour keeps the
    # highest tran_wersja_id (2016, 200000.0) regardless of arrival order.
    recs = parse_candidates(
        wrap(
            [
                make_member(tid="A", lokal_id="L1", version="2015-01-01T00:00:00", price="100000"),
                make_member(tid="A", lokal_id="L1", version="2016-01-01T00:00:00", price="200000"),
                make_member(tid="A", lokal_id="L2", version="2015-01-01T00:00:00"),
                make_member(tid="A", lokal_id="L1", version="2014-01-01T00:00:00", price="300000"),
            ]
        ),
        SUBJECT,
    )
    kept, dropped = dedupe_pair(recs)
    assert dropped == 2
    assert sorted((k["lokalId"], k["priceTotal"]) for k in kept) == [
        ("L1", 200000.0),
        ("L2", 700000.0),
    ]


def test_number_returned_and_floor_month():
    assert number_returned(wrap([], returned=5000)) == 5000
    assert number_returned("<x/>") == 0
    assert floor_month("2026-03", 24) == "2024-03"
    assert floor_month("2026-01", 1) == "2025-12"


def test_parse_candidates_treats_non_finite_numeric_strings_as_missing():
    t = parse_candidates(wrap([make_member(floor="inf", price="nan")]), SUBJECT)[0]
    assert t["floor"] is None
    assert t["priceTotal"] == 0.0 and t["pricePerM2"] == 0.0


def test_parse_gml_extracts_fields_and_skips_invalid():
    gml = wrap(
        [
            make_member(price=650000, area=50.0, tid="A"),
            make_member(price=0, tid="B"),  # invalid price -> skipped
            "<wfs:member><ms:lokale></ms:lokale></wfs:member>",  # empty -> skipped
        ]
    )
    out = parse_gml(gml)
    assert len(out) == 1
    t = out[0]
    assert t["transaction_id"] == "A"
    assert t["price_per_m2"] == 13000.0
    assert t["date_month"] == "2026-04"
    assert t["function"] == "mieszkalna"


def _valid_pool(n, price=13000.0, area=70.0, months=("2026-01", "2026-02", "2026-03")):
    return [
        {
            "transaction_id": f"T{i}",
            "price_per_m2": price + i,  # slight spread, no outliers
            "area": area,
            "date": f"{months[i % len(months)]}-1{i % 9}",
            "date_month": months[i % len(months)],
            "function": "mieszkalna",
        }
        for i in range(n)
    ]


def test_select_rejects_garbage_future_dates():
    pool = _valid_pool(14)
    pool.append(
        {**pool[0], "transaction_id": "GARBAGE", "date": "5201-07-01", "date_month": "5201-07"}
    )
    sel = select_sample(pool, subject_area=70.0, today_month="2026-07")
    assert all(t["transaction_id"] != "GARBAGE" for t in sel)


def test_select_rejects_stale_nonresidential_and_out_of_band():
    pool = _valid_pool(14)
    pool.append({**pool[0], "transaction_id": "OLD", "date_month": "2023-01"})
    pool.append({**pool[1], "transaction_id": "SHOP", "function": "usługowa"})
    pool.append({**pool[2], "transaction_id": "HUGE", "area": 70.0 * (1 + AREA_BAND_PCT) + 1})
    sel = select_sample(pool, subject_area=70.0, today_month="2026-07")
    ids = {t["transaction_id"] for t in sel}
    assert not ids & {"OLD", "SHOP", "HUGE"}


def test_select_iqr_trims_price_outliers():
    pool = _valid_pool(14)
    pool.append({**pool[0], "transaction_id": "SPIKE_PRICE", "price_per_m2": 99000.0})
    sel = select_sample(pool, subject_area=70.0, today_month="2026-07")
    assert all(t["transaction_id"] != "SPIKE_PRICE" for t in sel)


def test_select_returns_newest_pool_capped_at_pool_n():
    pool = _valid_pool(30)
    sel = select_sample(pool, subject_area=70.0, today_month="2026-07")
    assert len(sel) == POOL_N
    dates = [t["date"] for t in sel]
    assert dates == sorted(dates, reverse=True)


def test_select_is_deterministic():
    pool = _valid_pool(20)
    a = select_sample(pool, subject_area=70.0, today_month="2026-07")
    b = select_sample(list(pool), subject_area=70.0, today_month="2026-07")
    assert a == b


def test_parse_address_city_first():
    from app.rcn import parse_address

    assert parse_address("Poznań, ul. Kościelna 33A") == ("Poznań", "Kościelna 33A")


def test_parse_address_street_first():
    from app.rcn import parse_address

    assert parse_address("ul. Kościelna 33A, Poznań") == ("Poznań", "Kościelna 33A")


def test_parse_address_street_first_without_prefix():
    from app.rcn import parse_address

    assert parse_address("Kościelna 33A, Poznań") == ("Poznań", "Kościelna 33A")


def test_parse_address_no_comma_defaults_to_poznan():
    from app.rcn import parse_address

    assert parse_address("ul. Kościelna 33A") == ("Poznań", "Kościelna 33A")


def test_parse_address_postal_code_does_not_flip_the_city():
    """Incydent 3d23717d: digits in "61-619 Poznań" made looks_like_street
    treat the city part as a street, so the halves never swapped and both
    geocoders got an inverted query. The postal code carries nothing either
    geocoder needs — parse_address must drop it before the heuristic."""
    from app.rcn import parse_address

    assert parse_address("ul. Sielawy 21F/17, 61-619 Poznań") == ("Poznań", "Sielawy 21F/17")


def test_parse_address_postal_code_city_first():
    from app.rcn import parse_address

    assert parse_address("61-619 Poznań, ul. Sielawy 21F") == ("Poznań", "Sielawy 21F")


def test_parse_address_building_range_is_not_a_postal_code():
    from app.rcn import parse_address

    assert parse_address("ul. Półwiejska 21-23, Poznań") == ("Poznań", "Półwiejska 21-23")
