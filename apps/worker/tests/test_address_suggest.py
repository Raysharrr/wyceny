import pytest
from fastapi.testclient import TestClient

from app import subject
from app.main import app

client = TestClient(app)

STREETS = [
    {"city": "Poznań", "street": "Sielawy", "number": None, "teryt": "306401"},
    {"city": "Poznań", "street": "Sielska", "number": None, "teryt": "306401"},
]


@pytest.fixture
def streets_io(monkeypatch):
    monkeypatch.setattr(subject, "suggest_addresses", lambda query: list(STREETS))


def test_street_suggestions_have_canonical_label(streets_io):
    r = client.post("/address-suggest", json={"query": "Poznań, Siel"})
    assert r.status_code == 200
    suggestions = r.json()["suggestions"]
    assert [s["label"] for s in suggestions] == ["Poznań, Sielawy", "Poznań, Sielska"]
    # Coverage is a filter now, not a flag — the field is gone from the contract.
    assert all("inCoverage" not in s for s in suggestions)


def test_address_suggestion_appends_number_to_label(monkeypatch):
    monkeypatch.setattr(
        subject,
        "suggest_addresses",
        lambda query: [{"city": "Poznań", "street": "Sielawy", "number": "21F", "teryt": "306401"}],
    )
    r = client.post("/address-suggest", json={"query": "Poznań, Sielawy 21F"})
    assert r.status_code == 200
    assert r.json()["suggestions"][0]["label"] == "Poznań, Sielawy 21F"


def test_out_of_coverage_candidates_are_dropped(monkeypatch):
    """Decision 2026-08-20: the list offers only addresses inside coverage (TERYT 3064*)."""
    monkeypatch.setattr(
        subject,
        "suggest_addresses",
        lambda query: [
            {"city": "Warszawa", "street": "Marszałkowska", "number": None, "teryt": "146501"},
            {"city": "Kórnik", "street": "Poznańska", "number": None, "teryt": "302109"},
            {"city": "Poznań", "street": "Poznańska", "number": None, "teryt": "306401"},
        ],
    )
    r = client.post("/address-suggest", json={"query": "Pozna"})
    assert r.status_code == 200
    assert [s["label"] for s in r.json()["suggestions"]] == ["Poznań, Poznańska"]


def test_coverage_filter_runs_before_the_cap(monkeypatch):
    outside = [
        {"city": "Kórnik", "street": f"Ulica{i}", "number": None, "teryt": "302109"}
        for i in range(8)
    ]
    inside = [
        {"city": "Poznań", "street": f"Ulica{i}", "number": None, "teryt": "306401"}
        for i in range(4)
    ]
    monkeypatch.setattr(subject, "suggest_addresses", lambda query: outside + inside)
    r = client.post("/address-suggest", json={"query": "Uli"})
    assert [s["city"] for s in r.json()["suggestions"]] == ["Poznań"] * 4


def test_suggestions_are_capped_at_eight(monkeypatch):
    many = [
        {"city": "Poznań", "street": f"Ulica{i}", "number": None, "teryt": "306401"}
        for i in range(12)
    ]
    monkeypatch.setattr(subject, "suggest_addresses", lambda query: many)
    r = client.post("/address-suggest", json={"query": "Poznań, Uli"})
    assert len(r.json()["suggestions"]) == 8


def test_failure_returns_empty_list_with_200_and_logs_cause(monkeypatch, capsys):
    """Suggestions are an enhancement: a broken geocoder must never break the
    form, so the endpoint answers 200 with an empty list — but the cause is
    logged (lesson from incident 3d23717d: a swallowed exception is a dead end)."""

    def boom(query):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(subject, "suggest_addresses", boom)
    r = client.post("/address-suggest", json={"query": "Poznań, Siel"})
    assert r.status_code == 200
    assert r.json()["suggestions"] == []
    out = capsys.readouterr().out
    assert "address_suggest_failed" in out
    assert "connection reset" in out


def test_invalid_body_is_422():
    r = client.post("/address-suggest", json={})
    assert r.status_code == 422


def test_query_longer_than_200_chars_is_422():
    r = client.post("/address-suggest", json={"query": "x" * 201})
    assert r.status_code == 422
