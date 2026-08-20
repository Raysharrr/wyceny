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


def test_street_suggestions_have_canonical_label_and_coverage(streets_io):
    r = client.post("/address-suggest", json={"query": "Poznań, Siel"})
    assert r.status_code == 200
    suggestions = r.json()["suggestions"]
    assert [s["label"] for s in suggestions] == ["Poznań, Sielawy", "Poznań, Sielska"]
    assert all(s["inCoverage"] for s in suggestions)


def test_address_suggestion_appends_number_to_label(monkeypatch):
    monkeypatch.setattr(
        subject,
        "suggest_addresses",
        lambda query: [{"city": "Poznań", "street": "Sielawy", "number": "21F", "teryt": "306401"}],
    )
    r = client.post("/address-suggest", json={"query": "Poznań, Sielawy 21F"})
    assert r.status_code == 200
    assert r.json()["suggestions"][0]["label"] == "Poznań, Sielawy 21F"


def test_out_of_coverage_teryt_is_flagged(monkeypatch):
    monkeypatch.setattr(
        subject,
        "suggest_addresses",
        lambda query: [
            {"city": "Warszawa", "street": "Marszałkowska", "number": None, "teryt": "146501"}
        ],
    )
    r = client.post("/address-suggest", json={"query": "Warszawa, Marsz"})
    assert r.status_code == 200
    assert r.json()["suggestions"][0]["inCoverage"] is False


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
