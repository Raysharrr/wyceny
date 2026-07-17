import pytest
from fastapi.testclient import TestClient

import app.subject as subject
from app.main import app
from tests.test_subject_core import BUDYNEK_XML, DZIALKA_XML, EMPTY_XML

client = TestClient(app)


@pytest.fixture
def happy_io(monkeypatch):
    monkeypatch.setattr(
        subject,
        "geocode_address",
        lambda address: {"x": 357604.98, "y": 507623.88, "teryt": "306401"},
    )
    monkeypatch.setattr(
        subject, "fetch_parcel_by_xy", lambda x, y: {"parcel_id": "306401_1.0021.AR_10.161"}
    )
    monkeypatch.setattr(
        subject,
        "fetch_egib_xml",
        lambda layer, x, y: DZIALKA_XML if layer == "dzialki" else BUDYNEK_XML,
    )
    monkeypatch.setattr(
        subject, "fetch_parcel_wkt", lambda parcel_id, srid: "POLYGON((0 0,10 0,10 10,0 10,0 0))"
    )
    monkeypatch.setattr(subject, "fetch_mpzp_functions", lambda wkt: {"features": []})
    monkeypatch.setattr(
        subject,
        "pick_mpzp_function",
        lambda wkt, fns: {"symbol": "4MW/U", "grupa": "mieszkalnictwo"},
    )
    monkeypatch.setattr(subject, "centroid_4326", lambda wkt: (16.905, 52.416))
    monkeypatch.setattr(subject, "fetch_plans", lambda: {"features": []})
    monkeypatch.setattr(
        subject,
        "pick_plan",
        lambda lon, lat, plans: {
            "nazwa": "Testowo - Polnoc",
            "uchwala": "VII/84/VIII/2019",
            "data": "2019-02-26",
            "publ": "Rocznik 2019, poz. 2776",
        },
    )


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
    monkeypatch.setattr(
        subject,
        "fetch_egib_xml",
        lambda layer, x, y: DZIALKA_XML if layer == "dzialki" else EMPTY_XML,
    )
    r = client.post("/subject-proposal", json={"address": "Poznan, Koscielna 33"})
    assert r.status_code == 200
    assert r.json()["building"] is None


def test_outside_poznan_is_422_non_retryable(monkeypatch):
    monkeypatch.setattr(
        subject, "geocode_address", lambda address: {"x": 1.0, "y": 2.0, "teryt": "146501"}
    )
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
