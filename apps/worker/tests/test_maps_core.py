"""Slice 9 maps core: BBOX math, WMS URL contract, retry. Spike: wiki tools/spike/2026-07-21-mapy-wms."""

import urllib.error
from unittest import mock

import pytest

from app import maps

# Synthetic 51x27 m parcel, EPSG:2180-shaped coords (WKT pairs = easting northing)
PARCEL_WKT = "POLYGON((357559 507618,357610 507618,357610 507645,357559 507645,357559 507618))"


def test_map_bboxes_geometry():
    bbox_ewid, bbox_orto = maps.map_bboxes(PARCEL_WKT)
    # center: E 357584.5, N 507631.5; span max 51 -> half_w = max(125, 1.5*51) = 125
    min_n, min_e, max_n, max_e = bbox_ewid
    assert max_e - min_e == pytest.approx(250.0)
    assert max_n - min_n == pytest.approx(250.0 * maps.HEIGHT / maps.WIDTH)  # 4:3
    assert (min_e + max_e) / 2 == pytest.approx(357584.5)
    assert (min_n + max_n) / 2 == pytest.approx(507631.5)
    # orto is 2x the ewid box, same center
    o_min_n, o_min_e, o_max_n, o_max_e = bbox_orto
    assert o_max_e - o_min_e == pytest.approx(500.0)
    assert (o_min_e + o_max_e) / 2 == pytest.approx(357584.5)


def test_getmap_url_axis_order_and_format_encoding():
    url = maps.getmap_url(
        maps.ORTO_URL, "Raster", (507443.9, 357334.4, 507818.9, 357834.4), "image/jpeg"
    )
    # WMS 1.3.0 + EPSG:2180: BBOX starts with min NORTHING (5xx), then min easting (3xx)
    assert "BBOX=507443.90,357334.40,507818.90,357834.40" in url
    assert "FORMAT=image%2Fjpeg" in url
    assert "CRS=EPSG:2180" in url
    assert f"WIDTH={maps.WIDTH}" in url and f"HEIGHT={maps.HEIGHT}" in url


def test_fetch_map_retries_on_404_then_succeeds(monkeypatch):
    png = b"\x89PNG\r\n\x1a\n" + b"x" * 10
    calls = {"n": 0}

    def fake_urlopen(req, timeout):
        calls["n"] += 1
        if calls["n"] < 3:
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", None, None)
        return mock.MagicMock(
            __enter__=lambda s: mock.MagicMock(read=lambda: png),
            __exit__=lambda s, *a: False,
        )

    monkeypatch.setattr(maps.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(maps.time, "sleep", lambda s: None)
    assert maps.fetch_map("http://example/wms", attempts=4) == png
    assert calls["n"] == 3


def test_fetch_map_rejects_non_image(monkeypatch):
    def fake_urlopen(req, timeout):
        return mock.MagicMock(
            __enter__=lambda s: mock.MagicMock(read=lambda: b"<html>error</html>"),
            __exit__=lambda s, *a: False,
        )

    monkeypatch.setattr(maps.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(maps.time, "sleep", lambda s: None)
    with pytest.raises(RuntimeError):
        maps.fetch_map("http://example/wms", attempts=2)
