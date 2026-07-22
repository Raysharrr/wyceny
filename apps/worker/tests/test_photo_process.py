import base64
import hashlib
import hmac
import time
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)
SECRET = "test-secret"


def make_token(secret: str = SECRET, exp_delta: int = 300) -> str:
    exp = int(time.time()) + exp_delta
    sig = hmac.new(secret.encode(), f"{exp}.n0nce".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.n0nce.{sig}"


def jpeg_bytes(w: int = 20, h: int = 10) -> bytes:
    out = BytesIO()
    Image.new("RGB", (w, h), (10, 20, 30)).save(out, format="JPEG")
    return out.getvalue()


def post_photo(data: bytes, token: str, content_type: str = "image/jpeg"):
    return client.post(
        "/photo-process",
        files={"file": ("p.jpg", data, content_type)},
        data={"token": token},
    )


def test_valid_upload_returns_processed_base64(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    r = post_photo(jpeg_bytes(2400, 1200), make_token())
    assert r.status_code == 200
    body = r.json()
    assert (body["width"], body["height"]) == (1200, 600)
    out = base64.standard_b64decode(body["photo"])
    assert out[:3] == b"\xff\xd8\xff"
    assert set(body) == {"photo", "width", "height"}  # F-11: nothing else


def test_bad_token_401(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    assert post_photo(jpeg_bytes(), "1.2.deadbeef").status_code == 401


def test_expired_token_401(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    assert post_photo(jpeg_bytes(), make_token(exp_delta=-10)).status_code == 401


def test_wrong_content_type_415(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    assert post_photo(b"%PDF-1.4", make_token(), "application/pdf").status_code == 415


def test_unreadable_image_415(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    assert post_photo(b"garbage-bytes", make_token()).status_code == 415


def test_oversize_413(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    big = jpeg_bytes() + b"\x00" * (10 * 1024 * 1024)
    assert post_photo(big, make_token()).status_code == 413
