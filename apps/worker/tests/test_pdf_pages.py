"""/pdf-pages (operat-bugfix KW.5): pages of the insurance policy PDF as JPEG images
for Załącznik nr 1 (user decision 15.09: policy only as PDF). PDFs are generated
here with Pillow — no binary fixture."""

import base64
import hashlib
import hmac
import subprocess
import sys
import tempfile
import time
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app import pdf_pages as pdf_pages_core

SECRET = "test-secret"
client = TestClient(main.app)
UNREADABLE = "Nie udało się odczytać pliku PDF polisy — wgraj plik PDF."


def mint(exp_offset: int = 300) -> str:
    exp = int(time.time()) + exp_offset
    sig = hmac.new(SECRET.encode(), f"{exp}.n0nce".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.n0nce.{sig}"


@pytest.fixture(autouse=True)
def secret_env(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)


def pdf(*pages: tuple[tuple[int, int], tuple[int, int, int]]) -> bytes:
    """PDF with one page per (size in points, colour) — Pillow writes 72 dpi."""
    images = [Image.new("RGB", size, colour) for size, colour in pages]
    out = BytesIO()
    images[0].save(out, format="PDF", save_all=True, append_images=images[1:], resolution=72)
    return out.getvalue()


def record_upload_reads(monkeypatch) -> list:
    """Sizes the endpoint asks for when reading the uploaded file (Starlette spools
    uploads into a SpooledTemporaryFile). A bare `read()` shows up as -1."""
    sizes: list = []
    original = tempfile.SpooledTemporaryFile.read

    def read(self, size=-1):
        sizes.append(size)
        return original(self, size)

    monkeypatch.setattr(tempfile.SpooledTemporaryFile, "read", read)
    return sizes


RED = (220, 20, 20)
BLUE = (20, 20, 220)


def post(data: bytes, token: str, mime: str = "application/pdf"):
    return client.post(
        "/pdf-pages", data={"token": token}, files={"file": ("polisa.pdf", data, mime)}
    )


def decode(page: dict) -> Image.Image:
    raw = base64.standard_b64decode(page["image"])
    assert raw[:3] == b"\xff\xd8\xff"  # JPEG
    image = Image.open(BytesIO(raw))
    assert image.size == (page["width"], page["height"])
    return image


def test_two_pages_come_back_as_two_jpegs_in_order_at_150_dpi():
    resp = post(pdf(((200, 100), RED), ((100, 300), BLUE)), mint())
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"pages"}
    first, second = body["pages"]
    assert set(first) == {"image", "width", "height"}
    # 150/72 of the page size in points, rounded up by PDFium
    assert (first["width"], first["height"]) == (417, 209)
    assert (second["width"], second["height"]) == (209, 625)
    r, g, b = decode(first).getpixel((first["width"] // 2, first["height"] // 2))
    assert r > 150 and b < 100
    r, g, b = decode(second).getpixel((second["width"] // 2, second["height"] // 2))
    assert b > 150 and r < 100


def test_a_huge_page_is_capped_not_rendered_at_full_size():
    side = pdf_pages_core.MAX_SIDE_PX
    resp = post(pdf(((side * 2, side), RED)), mint())
    assert resp.status_code == 200
    (page,) = resp.json()["pages"]
    assert max(page["width"], page["height"]) <= side


def test_png_is_415():
    out = BytesIO()
    Image.new("RGB", (10, 10), RED).save(out, format="PNG")
    resp = post(out.getvalue(), mint(), "image/png")
    assert resp.status_code == 415
    assert resp.json()["detail"] == UNREADABLE


def test_unreadable_pdf_is_415():
    resp = post(b"%PDF-1.4 to nie jest pdf", mint())
    assert resp.status_code == 415
    assert resp.json()["detail"] == UNREADABLE


def test_too_large_file_is_413(monkeypatch):
    monkeypatch.setattr(pdf_pages_core, "MAX_PDF_BYTES", 100)
    resp = post(pdf(((200, 100), RED)), mint())
    assert resp.status_code == 413
    assert "10 MB" in resp.json()["detail"]


def test_an_oversize_upload_is_read_only_up_to_the_limit(monkeypatch):
    """413 must not cost reading the whole upload into memory first."""
    monkeypatch.setattr(pdf_pages_core, "MAX_PDF_BYTES", 100)
    sizes = record_upload_reads(monkeypatch)
    assert post(pdf(((200, 100), RED)), mint()).status_code == 413
    assert sizes == [101]


def test_too_many_pages_is_413(monkeypatch):
    monkeypatch.setattr(pdf_pages_core, "MAX_PAGES", 2)
    resp = post(pdf(*[((50, 50), RED)] * 3), mint())
    assert resp.status_code == 413
    assert "stron" in resp.json()["detail"]


STRESS_SCRIPT = """
import sys
from concurrent.futures import ThreadPoolExecutor
from app.pdf_pages import render_pages

data = sys.stdin.buffer.read()
with ThreadPoolExecutor(max_workers=16) as pool:
    for _ in range(40):
        results = list(pool.map(lambda _: render_pages(data), range(16)))
        assert all(len(pages) == 3 for pages in results)
"""


def test_parallel_renders_do_not_crash_the_process():
    """PDFium is not thread-safe and sync handlers run in Starlette's threadpool:
    without a lock, parallel uploads kill the whole worker (SIGBUS/SIGSEGV) — so
    the stress runs in a subprocess, where a crash is a returncode, not a dead pytest."""
    result = subprocess.run(
        [sys.executable, "-c", STRESS_SCRIPT],
        # Small pages, many documents: measured without the lock this fails
        # (PdfiumError, ObjectTracker errors, SIGSEGV) in 5 runs out of 5.
        input=pdf(((50, 50), RED), ((50, 50), BLUE), ((50, 50), RED)),
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")[-500:]


def test_bad_token_is_401():
    data = pdf(((200, 100), RED))
    assert post(data, "1.2.deadbeef").status_code == 401
    assert post(data, mint(exp_offset=-10)).status_code == 401
