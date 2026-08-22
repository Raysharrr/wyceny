"""Street/city on the candidates returned by /sample-proposal (Slice 3d, T2).

The index lives in the worker (plan 2026-08-22): Python parses the GML with the stdlib,
the worker already owns the RCN integration, and attaching the address to the pool the
web already fetches costs no extra round trip — it also enriches the cached pool and the
frozen snapshot for free.

Contract rule that outranks everything else here: a missing index NEVER fails the
request. The sample must come back; the address is a bonus.
"""

import pytest
from fastapi.testclient import TestClient

from app import rcn, street_index
from app.main import app
from tests.test_rcn_core import make_member, wrap

client = TestClient(app)
POINT = {"x": 355300.15, "y": 505330.31, "srid": 2180}
IN_CITY = "306401_1.0039.AR_22.13/24.1_BUD.7_LOK"
OUTSIDE = "302107_2.0001.15/2.1_BUD.3_LOK"  # gmina ościenna — poza eksportem miejskim


@pytest.fixture
def wfs_two_candidates(monkeypatch):
    gml = wrap(
        [make_member(tid="T1", lokal_id=IN_CITY), make_member(tid="T2", lokal_id=OUTSIDE)],
        returned=2,
    )
    monkeypatch.setattr(rcn, "fetch_rcn", lambda bbox, count=5000, sort=None, start_index=0: gml)


@pytest.fixture
def index_ready(monkeypatch):
    monkeypatch.setattr(street_index, "status", lambda: "ready")
    monkeypatch.setattr(street_index, "cutoff", lambda: "2026-08-13")
    monkeypatch.setattr(street_index, "generated_at", lambda: "2026-08-22T10:00:00Z")
    monkeypatch.setattr(
        street_index,
        "lookup",
        lambda lokal_id: (
            {"ulica": "ul. Heweliusza", "nr": "3", "miejscowosc": "Poznań"}
            if lokal_id == IN_CITY
            else None
        ),
    )


def post():
    return client.post(
        "/sample-proposal", json={"address": "Poznań, Heweliusza 3", "area": 50, "point": POINT}
    )


def test_candidate_carries_street_number_and_city(wfs_two_candidates, index_ready):
    body = post().json()
    matched = next(c for c in body["candidates"] if c["lokalId"] == IN_CITY)

    assert matched["street"] == "ul. Heweliusza"
    assert matched["streetNumber"] == "3"
    assert matched["city"] == "Poznań"


def test_transaction_outside_poznan_gets_nulls_not_an_error(wfs_two_candidates, index_ready):
    """The city export covers TERYT 3064 only. Such rows are a dash in the UI — a known
    boundary of the source, never a failure (spike: 0/79 and 0/200, nearest 2 427 m)."""
    response = post()
    assert response.status_code == 200
    outside = next(c for c in response.json()["candidates"] if c["lokalId"] == OUTSIDE)
    assert outside["street"] is None
    assert outside["city"] is None


def test_pool_reports_index_state_so_the_ui_can_explain_the_dash(wfs_two_candidates, index_ready):
    body = post().json()
    assert body["streetIndex"] == {
        "status": "ready",
        "cutoff": "2026-08-13",
        "generatedAt": "2026-08-22T10:00:00Z",
    }


def test_index_still_building_returns_the_pool_without_streets(wfs_two_candidates, monkeypatch):
    """Never an error, never an empty response — the sample is what the appraiser came for."""
    monkeypatch.setattr(street_index, "status", lambda: "building")
    monkeypatch.setattr(street_index, "cutoff", lambda: None)
    monkeypatch.setattr(street_index, "generated_at", lambda: None)
    monkeypatch.setattr(street_index, "lookup", lambda lokal_id: None)

    response = post()
    assert response.status_code == 200
    body = response.json()
    assert body["streetIndex"]["status"] == "building"
    assert all(c["street"] is None for c in body["candidates"])


def test_event_carries_counts_only_never_an_address(wfs_two_candidates, index_ready, capsys):
    """F-13: the event log takes numbers and classes, never addresses."""
    post()
    logs = capsys.readouterr().out
    assert "streets_hit" in logs
    assert "Heweliusza" not in logs


def test_pool_request_kicks_off_the_index_build(wfs_two_candidates, monkeypatch):
    """A worker restarted mid-month must rebuild without waiting for a redeploy; the call
    is idempotent, so the request path can safely nudge it on every pool fetch."""
    started = []
    monkeypatch.setattr(street_index, "ensure_started", lambda *a, **k: started.append(True))
    monkeypatch.setattr(street_index, "status", lambda: "unavailable")
    monkeypatch.setattr(street_index, "cutoff", lambda: None)
    monkeypatch.setattr(street_index, "generated_at", lambda: None)

    assert post().status_code == 200
    assert started, "handler musi wywołać ensure_started()"
