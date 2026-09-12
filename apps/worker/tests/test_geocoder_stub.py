"""GEOCODER_STUB=1 — deterministic offline geocoder for CI / E2E (no network)."""

import json
from pathlib import Path

import pytest

from app import main, subject


@pytest.fixture(autouse=True)
def stub_env(monkeypatch):
    monkeypatch.setenv("GEOCODER_STUB", "1")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    monkeypatch.delenv("VERCEL_ENV", raising=False)


def test_stub_is_deterministic_and_close_to_one_centre():
    a = main.resolve_point("os. Piastowskie 20, Poznań", None)
    b = main.resolve_point("os. Piastowskie 20, Poznań", None)
    c = main.resolve_point("os. Jagiellońskie 10, Poznań", None)
    assert a == b
    assert a != c
    for x, y, source in (a, c):
        assert abs(x - 360_000) <= 700 and abs(y - 504_000) <= 700
        assert source == "uug"


def test_stub_never_touches_the_network(monkeypatch):
    def boom(*_a, **_k):
        raise AssertionError("network call under GEOCODER_STUB")

    monkeypatch.setattr(main.subject, "geocode_address", boom)
    monkeypatch.setattr(main.rcn, "geocode", boom)
    assert main.resolve_point("ul. Bukowa 1, Poznań", None)[2] == "uug"


def test_sentinel_address_is_refused_like_a_real_miss():
    with pytest.raises(subject.AddressNotFound):
        main.resolve_point("Poznań, os. Zmyślona Nieistniejąca 99", None)


def test_step_one_point_still_wins():
    point = main.SamplePoint(x=1.0, y=2.0, srid=2180)
    assert main.resolve_point("cokolwiek", point) == (1.0, 2.0, "subject")


@pytest.mark.parametrize("marker", ["RAILWAY_ENVIRONMENT", "VERCEL_ENV"])
def test_stub_refuses_to_run_next_to_a_hosting_marker(monkeypatch, marker):
    monkeypatch.setenv(marker, "production")
    with pytest.raises(RuntimeError, match="GEOCODER_STUB"):
        main.geocoder_stub_enabled()


def test_worker_does_not_start_with_stub_next_to_hosting_marker():
    """The guard runs at import time (MINOR-1 review 2): a worker deployed with
    GEOCODER_STUB=1 next to RAILWAY_ENVIRONMENT must fail to boot, not serve hashes."""
    import os
    import subprocess
    import sys

    env = {**os.environ, "GEOCODER_STUB": "1", "RAILWAY_ENVIRONMENT": "production"}
    proc = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode != 0
    assert "GEOCODER_STUB" in proc.stderr


def test_stub_off_by_default(monkeypatch):
    monkeypatch.delenv("GEOCODER_STUB")
    assert main.geocoder_stub_enabled() is False


def test_ownership_phrases_match_the_e2e_copy():
    """The E2E spec asserts the operat PDF against a COPY of `OWNERSHIP_PHRASES`
    (it cannot import Python) — this pins the two lists together."""
    copy = (
        Path(__file__).resolve().parents[2] / "web" / "e2e" / "fixtures" / "ownership-phrases.json"
    )
    assert json.loads(copy.read_text(encoding="utf-8")) == list(main.prose_core.OWNERSHIP_PHRASES)
