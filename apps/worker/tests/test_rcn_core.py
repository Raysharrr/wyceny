"""Offline tests for the RCN pure core. NO network — GML is built in-test.

Pins the two spike discoveries that make or break production:
garbage future dates in RCN (5201-07) and IQR outlier rejection.
"""

from app.rcn import AREA_BAND_PCT, POOL_N, parse_gml, select_sample


def make_member(
    price=700000.0,
    area=55.5,
    date="2026-04-15",
    function="mieszkalna",
    tid="PL.X.123",
    pos="52.41 16.90",
):
    return f"""<wfs:member>
      <ms:lokale>
        <ms:tran_lokalny_id_iip>{tid}</ms:tran_lokalny_id_iip>
        <ms:teryt>306401_1</ms:teryt>
        <ms:lok_cena_brutto>{price}</ms:lok_cena_brutto>
        <ms:lok_pow_uzyt>{area}</ms:lok_pow_uzyt>
        <ms:dok_data>{date}T00:00:00</ms:dok_data>
        <ms:lok_funkcja>{function}</ms:lok_funkcja>
        <ms:tran_rodzaj_trans>sprzedaż</ms:tran_rodzaj_trans>
        <gml:pos>{pos}</gml:pos>
      </ms:lokale>
    </wfs:member>"""


def wrap(members):
    return f"<wfs:FeatureCollection>{''.join(members)}</wfs:FeatureCollection>"


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
