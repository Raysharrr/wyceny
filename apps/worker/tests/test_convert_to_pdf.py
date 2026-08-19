import io
import os
import shutil

import pytest
from docx import Document
from fastapi.testclient import TestClient

import app.main as worker_main
from app.convert import ConversionError, resolve_soffice
from app.main import app

client = TestClient(app)

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _sample_docx() -> bytes:
    doc = Document()
    doc.add_paragraph("Zażółć gęślą jaźń — test polskich znaków.")
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# CI always has LibreOffice (asserted by a dedicated workflow step) — the skip
# is for local machines without soffice on PATH/SOFFICE only. Never skip in CI.
soffice_missing = resolve_soffice() is None and not os.environ.get("CI")


@pytest.mark.skipif(soffice_missing, reason="soffice not installed locally")
def test_convert_to_pdf_returns_pdf_bytes():
    r = client.post("/convert-to-pdf", content=_sample_docx(), headers={"Content-Type": DOCX_MIME})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-"
    # F-11: binary file response, never a JSON payload with computed values
    assert not r.headers["content-type"].startswith("application/json")


def test_convert_to_pdf_empty_body_is_400():
    r = client.post("/convert-to-pdf", content=b"", headers={"Content-Type": DOCX_MIME})
    assert r.status_code == 400


def test_convert_to_pdf_failure_is_502_and_logs_stderr(monkeypatch, capsys):
    """A handled HTTPException is never logged by FastAPI — the handler must
    log the ConversionError (which carries soffice stderr) itself, or Railway
    logs show nothing on conversion failures. Captured from stdout, not from
    caplog: the worker logs structured JSON through structlog, not stdlib."""

    def fake_docx_to_pdf(docx: bytes) -> bytes:
        raise ConversionError("soffice failed: exit 77; stderr: b'fake-soffice-boom'")

    monkeypatch.setattr(worker_main, "docx_to_pdf", fake_docx_to_pdf)
    r = client.post("/convert-to-pdf", content=b"PK-fake", headers={"Content-Type": DOCX_MIME})
    assert r.status_code == 502
    out = capsys.readouterr().out
    assert "convert_to_pdf_failed" in out
    assert "fake-soffice-boom" in out


def test_resolve_soffice_prefers_env(monkeypatch):
    monkeypatch.setenv("SOFFICE", "/nonexistent/soffice")
    assert resolve_soffice() is None or isinstance(resolve_soffice(), str)
    monkeypatch.delenv("SOFFICE")
    which = shutil.which("soffice")
    assert resolve_soffice() == which
