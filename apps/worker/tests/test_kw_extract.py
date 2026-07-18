"""/kw-extract endpoint tests (Slice 6 Task 3). The anthropic call is always
monkeypatched (`main._extract_kw_payload`) — no network/LLM in CI. Fixtures
synthetic; KW-number shapes broken per F-9 (no [A-Z]{2}\\d[A-Z]/\\d{8}/\\d)."""

import hashlib
import hmac
import time

import pytest
from fastapi.testclient import TestClient

from app import main
from app.kw import KwDzial, KwExtractPayload

# F-9: runtime-built PESEL (no 11-digit run in the committed file).
PESEL_A = "85010" + "112345"

client = TestClient(main.app)

SECRET = "test-secret"


def mint(exp_offset: int = 300) -> str:
    exp = int(time.time()) + exp_offset
    nonce = "cafe0123"
    sig = hmac.new(SECRET.encode(), f"{exp}.{nonce}".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{nonce}.{sig}"


def fake_payload(**overrides) -> KwExtractPayload:
    base = dict(
        docType="akt",
        kwLokalu="AB1C/1/9",  # F-9-safe synthetic shape? NO — see note below
        kwGruntu=None,
        kwInne=[],
        deweloperski=False,
        powUzytkowaKw=69.56,
        powPrzezOdwolanie=False,
        udzial="1234/56789",
        sad="Sąd Rejonowy Poznań — Stare Miasto",
        wydzial="VI Wydział Ksiąg Wieczystych",
        dataDokumentu="2026-05-11",
        dzial3=None,
        dzial4=None,
    )
    base.update(overrides)
    return KwExtractPayload(**base)


@pytest.fixture(autouse=True)
def secret_env(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)


def post(token: str, content: bytes = b"%PDF-1.4 test", expected_type: str = "akt"):
    return client.post(
        "/kw-extract",
        data={"token": token, "expected_type": expected_type},
        files={"file": ("akt.pdf", content, "application/pdf")},
    )


def test_happy_path_scrubs_and_returns_extract(monkeypatch):
    dz3 = KwDzial(wpisy=True, tresc=[f"roszczenie, PESEL {PESEL_A}, o wpis"])
    monkeypatch.setattr(main, "_extract_kw_payload", lambda pdf_b64: fake_payload(dzial3=dz3))
    resp = post(mint())
    assert resp.status_code == 200
    body = resp.json()
    assert body["docTypeDetected"] == "akt"
    assert body["typeMismatch"] is False
    assert body["extract"]["powUzytkowaKw"] == 69.56
    # scrub ran inside the endpoint: PESEL never leaves the worker
    assert PESEL_A not in body["extract"]["dzial3"]["tresc"][0]


def test_invalid_token_401():
    assert post("1.2.3").status_code == 401


def test_expired_token_401():
    assert post(mint(exp_offset=-10)).status_code == 401


def test_non_pdf_415(monkeypatch):
    monkeypatch.setattr(main, "_extract_kw_payload", lambda pdf_b64: fake_payload())
    resp = client.post(
        "/kw-extract",
        data={"token": mint(), "expected_type": "akt"},
        files={"file": ("kot.jpg", b"\xff\xd8\xff", "image/jpeg")},
    )
    assert resp.status_code == 415


def test_oversize_413(monkeypatch):
    monkeypatch.setattr(main, "kw_max_bytes", lambda: 10)  # shrink limit for the test
    assert post(mint(), content=b"%PDF" + b"x" * 20).status_code == 413


def test_unknown_doc_422_non_retryable(monkeypatch):
    monkeypatch.setattr(
        main, "_extract_kw_payload", lambda pdf_b64: fake_payload(docType="nieznany")
    )
    resp = post(mint())
    assert resp.status_code == 422
    assert "nie wygląda" in resp.json()["detail"]


def test_upstream_error_502_polish_detail(monkeypatch):
    def boom(pdf_b64):
        raise RuntimeError("anthropic down")

    monkeypatch.setattr(main, "_extract_kw_payload", boom)
    resp = post(mint())
    assert resp.status_code == 502
    assert "spróbuj ponownie" in resp.json()["detail"].lower()


def test_type_mismatch_flagged_not_errored(monkeypatch):
    monkeypatch.setattr(
        main, "_extract_kw_payload", lambda pdf_b64: fake_payload(docType="odpis_kw")
    )
    resp = post(mint(), expected_type="akt")
    assert resp.status_code == 200
    assert resp.json()["typeMismatch"] is True


def test_developer_variant_forced_when_akt_without_kw_lokalu(monkeypatch):
    monkeypatch.setattr(
        main,
        "_extract_kw_payload",
        lambda pdf_b64: fake_payload(kwLokalu=None, deweloperski=False),
    )
    body = post(mint()).json()
    assert body["extract"]["deweloperski"] is True
