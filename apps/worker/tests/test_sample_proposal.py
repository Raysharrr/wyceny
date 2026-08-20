import json

import pytest
from fastapi.testclient import TestClient

import app.subject as subject
from app import rcn
from app.main import app
from tests.test_rcn_core import make_member, wrap

client = TestClient(app)
POINT = {"x": 355300.15, "y": 505330.31, "srid": 2180}


def _gml(n=3):
    return wrap(
        [
            make_member(tid=f"T{i}", lokal_id=f"306401_1.0039.AR_22.13/24.1_BUD.{i}_LOK")
            for i in range(n)
        ],
        returned=n,
    )


@pytest.fixture
def wfs_ok(monkeypatch):
    monkeypatch.setattr(rcn, "fetch_rcn", lambda bbox, count=5000, sort=None, start_index=0: _gml())


def test_point_from_request_skips_geocoding_and_returns_pool_never_wr(wfs_ok, monkeypatch):
    monkeypatch.setattr(
        subject,
        "geocode_address",
        lambda a: (_ for _ in ()).throw(AssertionError("must not geocode")),
    )
    r = client.post(
        "/sample-proposal", json={"address": "Poznań, Heweliusza 3", "area": 50, "point": POINT}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["point"] == {"x": POINT["x"], "y": POINT["y"], "source": "subject"}
    assert body["maxRadiusM"] == 3000
    assert len(body["candidates"]) == 3
    c = body["candidates"][0]
    assert set(c) == {
        "transactionId",
        "date",
        "area",
        "pricePerM2",
        "priceTotal",
        "egib",
        "lokalId",
        "distanceM",
        "floor",
        "rooms",
        "market",
        "share",
        "transType",
        "function",
        "seller",
        "pos",
    }
    assert "versionId" not in c
    assert body["counts"] == {"fetched": 3, "deduped": 0, "noPos": 0}
    assert body["query"]["sort"] == "dok_data D,tran_lokalny_id_iip D"
    assert (
        body["query"]["count"] == 5000
        and body["query"]["pages"] == 1
        and body["query"]["truncated"] is False
    )
    assert len(body["query"]["bbox"]) == 4 and body["source"] == "rcn-wfs-gugik"
    # F-11
    assert '"wr"' not in r.text.lower() and "marketvalue" not in r.text.lower()


def test_without_point_uses_uug(wfs_ok, monkeypatch):
    monkeypatch.setattr(
        subject, "geocode_address", lambda a: {"x": 1.0, "y": 2.0, "teryt": "306401"}
    )
    r = client.post("/sample-proposal", json={"address": "Poznań, Heweliusza 3", "area": 50})
    assert r.status_code == 200
    assert r.json()["point"] == {"x": 1.0, "y": 2.0, "source": "uug"}


def test_uug_miss_falls_back_to_nominatim_and_logs_geocoder(wfs_ok, monkeypatch, capsys):
    def miss(a):
        raise subject.AddressNotFound("brak")

    monkeypatch.setattr(subject, "geocode_address", miss)
    monkeypatch.setattr(rcn, "geocode", lambda a: (52.41, 16.90))
    monkeypatch.setattr(subject, "nominatim_to_2180", lambda lat, lon: (3.0, 4.0))
    r = client.post("/sample-proposal", json={"address": "ul. Dziwna 1, Poznań", "area": 50})
    assert r.status_code == 200
    assert r.json()["point"] == {"x": 3.0, "y": 4.0, "source": "nominatim"}
    lines = [json.loads(ln) for ln in capsys.readouterr().out.splitlines() if ln.strip()]
    assert any(ln.get("event") == "sample_proposal_geocoder_fallback" for ln in lines)


def test_both_geocoders_miss_is_422(monkeypatch):
    def miss(a):
        raise subject.AddressNotFound("brak")

    monkeypatch.setattr(subject, "geocode_address", miss)
    monkeypatch.setattr(
        rcn, "geocode", lambda a: (_ for _ in ()).throw(RuntimeError("Nominatim nic nie znalazł"))
    )
    r = client.post("/sample-proposal", json={"address": "x", "area": 50})
    assert r.status_code == 422


def test_uug_generic_failure_is_502_and_logs_cause(monkeypatch, capsys):
    """Incydent 3d23717d class: UUG answering plain text (or any other non-
    AddressNotFound failure, e.g. an ULDK/Nominatim outage) must not escape as
    an unlogged 500 — resolve_point only swallows AddressNotFound, so anything
    else is a 502 with the cause logged, mirroring subject_proposal."""

    def boom(a):
        raise RuntimeError("UUG plain text")

    monkeypatch.setattr(subject, "geocode_address", boom)
    r = client.post("/sample-proposal", json={"address": "x", "area": 50})
    assert r.status_code == 502
    lines = [json.loads(ln) for ln in capsys.readouterr().out.splitlines() if ln.strip()]
    failed = [ln for ln in lines if ln.get("event") == "sample_proposal_failed"]
    assert failed, lines
    assert "UUG plain text" in failed[0]["err"]
    assert failed[0]["err_type"] == "RuntimeError"


def test_radius_m_overrides_bbox_and_max_radius(monkeypatch):
    seen = {}

    def fake(bbox, count=5000, sort=None, start_index=0):
        seen["bbox"] = bbox
        return _gml(1)

    monkeypatch.setattr(rcn, "fetch_rcn", fake)
    r = client.post(
        "/sample-proposal", json={"address": "a", "area": 50, "point": POINT, "radiusM": 1000}
    )
    assert r.json()["maxRadiusM"] == 1000
    assert seen["bbox"] == rcn.bbox_for(POINT["x"], POINT["y"], 1000)


def test_dedup_and_no_pos_are_counted_not_returned(monkeypatch):
    gml = wrap(
        [
            make_member(tid="A", lokal_id="L1", version="2015-01-01T00:00:00"),
            make_member(tid="A", lokal_id="L1", version="2016-01-01T00:00:00"),
            make_member(tid="B", pos=""),
        ],
        returned=3,
    )
    monkeypatch.setattr(rcn, "fetch_rcn", lambda bbox, count=5000, sort=None, start_index=0: gml)
    body = client.post("/sample-proposal", json={"address": "a", "area": 50, "point": POINT}).json()
    assert body["counts"] == {"fetched": 3, "deduped": 1, "noPos": 1}
    assert [c["transactionId"] for c in body["candidates"]] == ["A"]


def test_wfs_failure_returns_polish_502_and_logs_cause(monkeypatch, capsys):
    def boom(bbox, count=5000, sort=None, start_index=0):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(rcn, "fetch_rcn", boom)
    r = client.post("/sample-proposal", json={"address": "x", "area": 70.0, "point": POINT})
    assert r.status_code == 502
    assert "Nie udało się pobrać próby z RCN" in r.json()["detail"]
    out = capsys.readouterr().out
    assert "sample_proposal_failed" in out and "connection reset" in out


def test_empty_pool_is_200_with_zero_candidates(monkeypatch):
    monkeypatch.setattr(
        rcn, "fetch_rcn", lambda bbox, count=5000, sort=None, start_index=0: wrap([], returned=0)
    )
    r = client.post("/sample-proposal", json={"address": "x", "area": 70.0, "point": POINT})
    assert r.status_code == 200 and r.json()["candidates"] == []


def test_invalid_body_is_422():
    assert client.post("/sample-proposal", json={"address": "x"}).status_code == 422
    assert (
        client.post(
            "/sample-proposal",
            json={"address": "x", "area": 1, "point": {"x": 1, "y": 2, "srid": 4326}},
        ).status_code
        == 422
    )
    assert (
        client.post("/sample-proposal", json={"address": "x", "area": 1, "radiusM": 0}).status_code
        == 422
    )
    assert (
        client.post("/sample-proposal", json={"address": "x", "area": 1, "radiusM": -5}).status_code
        == 422
    )
