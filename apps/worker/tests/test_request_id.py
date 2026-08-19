import json

from fastapi.testclient import TestClient

import app.main as worker_main
from app.convert import ConversionError
from app.main import app

client = TestClient(app)

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def test_incoming_request_id_is_echoed_back():
    r = client.get("/health", headers={"X-Request-Id": "a3f1c2d9"})
    assert r.status_code == 200
    assert r.headers["x-request-id"] == "a3f1c2d9"


def test_missing_request_id_gets_one_minted():
    r = client.get("/health")
    assert len(r.headers["x-request-id"]) == 8


def test_request_id_reaches_the_log_line(capsys):
    client.get("/health", headers={"X-Request-Id": "beefcafe"})
    assert "beefcafe" in capsys.readouterr().out


def test_trace_id_reaches_a_sync_handler_in_the_threadpool(monkeypatch, capsys):
    """Every handler in this service is a sync `def`, which Starlette runs in a
    threadpool. The binding is only worth anything if anyio's context copy
    carries it across that hop, so this asserts on a line written from INSIDE
    the handler — not on the middleware's own line, which never leaves the
    event loop and would give a false green."""

    def fake_docx_to_pdf(docx: bytes) -> bytes:
        raise ConversionError("soffice failed: exit 77; stderr: b'fake-soffice-boom'")

    monkeypatch.setattr(worker_main, "docx_to_pdf", fake_docx_to_pdf)
    r = client.post(
        "/convert-to-pdf",
        content=b"PK-fake",
        headers={"Content-Type": DOCX_MIME, "X-Request-Id": "d0cf11e0"},
    )
    assert r.status_code == 502

    lines = [json.loads(ln) for ln in capsys.readouterr().out.splitlines() if ln.strip()]
    from_handler = [ln for ln in lines if ln["event"] == "convert_to_pdf_failed"]
    assert len(from_handler) == 1
    assert from_handler[0]["trace_id"] == "d0cf11e0"
