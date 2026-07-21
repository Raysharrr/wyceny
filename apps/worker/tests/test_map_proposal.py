"""Slice 9: /map-proposal endpoint — mocked subject/maps helpers, no network."""

import base64

from fastapi.testclient import TestClient

from app import main, maps, subject

client = TestClient(main.app)

PNG = b"\x89PNG\r\n\x1a\n" + b"e" * 8
JPG = b"\xff\xd8\xff\xe0" + b"o" * 8
WKT = "POLYGON((357559 507618,357610 507618,357610 507645,357559 507645,357559 507618))"


def _patch_happy(monkeypatch):
    monkeypatch.setattr(
        subject, "geocode_address", lambda a: {"x": 357605.0, "y": 507624.0, "teryt": "306401"}
    )
    monkeypatch.setattr(
        subject, "fetch_parcel_by_xy", lambda x, y: {"parcel_id": "3064_1.0021.161"}
    )
    monkeypatch.setattr(subject, "fetch_parcel_wkt", lambda pid, srid: WKT)
    monkeypatch.setattr(
        maps, "fetch_map", lambda url, attempts=4: PNG if "Ewidencji" in url else JPG
    )


def test_map_proposal_happy_path(monkeypatch):
    _patch_happy(monkeypatch)
    resp = client.post("/map-proposal", json={"address": "Poznań, Testowa 1"})
    assert resp.status_code == 200
    body = resp.json()
    assert base64.b64decode(body["ewidencyjna"]).startswith(b"\x89PNG")
    assert base64.b64decode(body["orto"]).startswith(b"\xff\xd8")
    assert body["parcelId"] == "3064_1.0021.161"
    assert body["fetchedAt"]


def test_map_proposal_out_of_coverage(monkeypatch):
    monkeypatch.setattr(
        subject, "geocode_address", lambda a: {"x": 1.0, "y": 2.0, "teryt": "146501"}
    )
    resp = client.post("/map-proposal", json={"address": "Warszawa, Testowa 1"})
    assert resp.status_code == 422
    assert "Pozna" in resp.json()["detail"]


def test_map_proposal_wms_failure_is_502(monkeypatch):
    _patch_happy(monkeypatch)

    def boom(url, attempts=4):
        raise RuntimeError("WMS down")

    monkeypatch.setattr(maps, "fetch_map", boom)
    resp = client.post("/map-proposal", json={"address": "Poznań, Testowa 1"})
    assert resp.status_code == 502
    assert resp.json()["detail"] == main.MAPS_FAILED_DETAIL
