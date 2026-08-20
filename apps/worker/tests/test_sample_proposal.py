import json

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


def test_wfs_failure_returns_polish_502_and_logs_cause(monkeypatch, capsys):
    monkeypatch.setattr(rcn, "geocode", lambda address: (52.4, 16.9))

    def boom(bbox):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(rcn, "fetch_rcn", boom)
    r = client.post("/sample-proposal", json={"address": "x", "area": 70.0})
    assert r.status_code == 502
    assert "Nie udało się pobrać próby z RCN" in r.json()["detail"]
    out = capsys.readouterr().out
    assert "sample_proposal_failed" in out
    assert "connection reset" in out


def test_geocode_failure_is_502_and_logs_cause(monkeypatch, capsys):
    """Production (kod: 3d23717d): an address with a postal code geocoded to
    nothing and the bare except swallowed the cause — Railway showed only
    status=502. The handler must log what it swallows, or the traceId on the
    user's screen leads to a log line that says nothing."""

    def boom(address):
        raise RuntimeError(f"Nominatim nic nie znalazł (struct ani q): {address}")

    monkeypatch.setattr(rcn, "geocode", boom)
    r = client.post(
        "/sample-proposal", json={"address": "ul. Sielawy 21F/17, 61-619 Poznań", "area": 92.34}
    )
    assert r.status_code == 502
    lines = [json.loads(ln) for ln in capsys.readouterr().out.splitlines() if ln.strip()]
    failed = [ln for ln in lines if ln.get("event") == "sample_proposal_failed"]
    assert failed, lines
    assert "Nominatim nic nie znalazł" in failed[0]["err"]
    assert failed[0]["err_type"] == "RuntimeError"


def test_invalid_body_is_422():
    r = client.post("/sample-proposal", json={"address": "x"})
    assert r.status_code == 422
