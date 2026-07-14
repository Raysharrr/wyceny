import pytest
from fastapi.testclient import TestClient

from app import rcn
from app.main import app
from tests.test_rcn_core import _valid_pool

client = TestClient(app)


@pytest.fixture
def happy_io(monkeypatch):
    monkeypatch.setattr(rcn, "geocode", lambda address: (52.41614, 16.90455))
    monkeypatch.setattr(rcn, "fetch_rcn", lambda bbox: "<gml/>")
    monkeypatch.setattr(rcn, "parse_gml", lambda gml: _valid_pool(16))


def test_returns_transactions_with_meta_and_never_wr(happy_io):
    r = client.post(
        "/sample-proposal", json={"address": "Poznań, ul. Kościelna 33A", "area": 71.63}
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["transactions"]) >= 12
    t = body["transactions"][0]
    assert set(t) == {"date", "area", "pricePerM2", "transactionId"}
    assert body["meta"]["source"] == "rcn-wfs-gugik"
    assert body["meta"]["query"]["count"] == 5000
    assert "fetchedAt" in body["meta"]
    # F-11: no market-value key anywhere in the payload (worker must never compute WR)
    assert '"wr"' not in r.text.lower()
    assert "marketvalue" not in r.text.lower()


def test_too_few_candidates_returns_polish_502(monkeypatch):
    monkeypatch.setattr(rcn, "geocode", lambda address: (52.4, 16.9))
    monkeypatch.setattr(rcn, "fetch_rcn", lambda bbox: "<gml/>")
    monkeypatch.setattr(rcn, "parse_gml", lambda gml: _valid_pool(5))
    r = client.post("/sample-proposal", json={"address": "x", "area": 70.0})
    assert r.status_code == 502
    assert "Za mało transakcji" in r.json()["detail"]
    assert "5" in r.json()["detail"]


def test_wfs_failure_returns_polish_502(monkeypatch):
    monkeypatch.setattr(rcn, "geocode", lambda address: (52.4, 16.9))

    def boom(bbox):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(rcn, "fetch_rcn", boom)
    r = client.post("/sample-proposal", json={"address": "x", "area": 70.0})
    assert r.status_code == 502
    assert "Nie udało się pobrać próby z RCN" in r.json()["detail"]


def test_invalid_body_is_422():
    r = client.post("/sample-proposal", json={"address": "x"})
    assert r.status_code == 422
