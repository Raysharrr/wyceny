"""GEOCODER_STUB=1 — deterministic offline geocoder for CI / E2E (no network)."""

import pytest

from app import main


@pytest.fixture(autouse=True)
def stub_env(monkeypatch):
    monkeypatch.setenv("GEOCODER_STUB", "1")


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
    assert main.resolve_point("ul. Zmyślona 1, Poznań", None)[2] == "uug"


def test_step_one_point_still_wins():
    point = main.SamplePoint(x=1.0, y=2.0, srid=2180)
    assert main.resolve_point("cokolwiek", point) == (1.0, 2.0, "subject")
