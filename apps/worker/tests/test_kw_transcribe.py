"""/kw-transcribe (operat-bugfix KW.2): full content of a unit's book through the
`LlmClient` port. The model is always `FakeLlmClient` — no SDK, no network.
Fixture = the synthetic book (fictional people and numbers) from the models spike."""

import base64
import hashlib
import hmac
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import kw_transcribe, main
from app.kw_transcribe import KsiegaTresc
from app.llm import INVALID_OUTPUT, AnthropicAdapter, LlmResult
from tests.fake_llm import FakeLlmClient
from tests.test_llm import anthropic_imports, message, sdk_answering
from tests.test_pdf_pages import record_upload_reads

SECRET = "test-secret"
FIXTURE = Path(__file__).parent / "fixtures" / "kw_transcribe_sample.json"
APP = Path(__file__).resolve().parents[1] / "app"
client = TestClient(main.app)


def sample() -> dict:
    return json.loads(FIXTURE.read_text())


def sample_tresc() -> KsiegaTresc:
    return KsiegaTresc.model_validate({k: v for k, v in sample().items() if k != "walidacja"})


def mint(exp_offset: int = 300) -> str:
    exp = int(time.time()) + exp_offset
    sig = hmac.new(SECRET.encode(), f"{exp}.n0nce".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.n0nce.{sig}"


@pytest.fixture(autouse=True)
def secret_env(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)


def use_llm(monkeypatch, result: LlmResult) -> FakeLlmClient:
    fake = FakeLlmClient(result)
    monkeypatch.setattr(main, "kw_llm", lambda: fake)
    return fake


def post(token: str, content: bytes = b"%PDF-1.4 ksiega", mime: str = "application/pdf"):
    return client.post(
        "/kw-transcribe",
        data={"token": token},
        files={"file": ("kw.pdf", content, mime)},
    )


def ok_result() -> LlmResult:
    return LlmResult(
        parsed=sample_tresc(), stop_reason="end_turn", input_tokens=14440, output_tokens=4909
    )


def test_transcription_of_the_synthetic_book_comes_back_verbatim(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    pdf = b"%PDF-1.4 ksiega"
    resp = post(mint(), pdf)
    assert resp.status_code == 200
    # The wire shape IS the fixture: KsiegaTresc + walidacja (web contract test reads it).
    assert resp.json() == sample()
    assert fake.calls == [
        dict(
            model="claude-opus-5",
            documents=[base64.standard_b64encode(pdf).decode()],
            text=None,
            prompt=kw_transcribe.PROMPT,
            schema=KsiegaTresc,
            max_tokens=16000,
            thinking={"type": "adaptive"},
        )
    ]


def test_a_transcription_failing_validation_is_returned_with_the_verdict(monkeypatch):
    """Validation judges, the endpoint does not reject: web decides (stores only `ok`)."""
    tresc = sample_tresc()
    tresc.polaDodatkowe.numerLokalu = (tresc.polaDodatkowe.numerLokalu or "") + "1"
    use_llm(monkeypatch, LlmResult(tresc, "end_turn", 1, 1))
    resp = post(mint())
    assert resp.status_code == 200
    assert resp.json()["walidacja"] == {
        "ok": False,
        "bledy": [{"klasa": "pole_niezgodne:numerLokalu", "dzial": "I-O"}],
    }
    assert resp.json()["polaDodatkowe"]["numerLokalu"] == tresc.polaDodatkowe.numerLokalu


def test_persons_are_not_scrubbed(monkeypatch):
    """Runda 3 / ADR-018 "Zmiana 15.09": the full content keeps persons' data."""
    use_llm(monkeypatch, ok_result())
    body = post(mint()).json()
    dzial_ii = next(d for d in body["dzialy"] if d["kod"] == "II")
    osoby = [
        v
        for w in dzial_ii["tabele"][0]["wpisy"]
        for r in w["rubryki"]
        if r["nazwa"].startswith("Osoba fizyczna")
        for v in r["wartosci"]
    ]
    expected = [
        v
        for w in sample_tresc().dzialy[2].tabele[0].wpisy
        for r in w.rubryki
        if r.nazwa.startswith("Osoba fizyczna")
        for v in r.wartosci
    ]
    assert osoby == expected and len(osoby) == 2


@pytest.mark.parametrize(
    ("stop_reason", "status", "code"),
    [
        ("max_tokens", 422, "kw_transkrypcja_ucieta"),
        (INVALID_OUTPUT, 422, "kw_transkrypcja_nieczytelna"),
        ("refusal", 422, "kw_transkrypcja_nieczytelna"),
        ("end_turn", 502, "kw_transkrypcja_blad"),
    ],
)
def test_no_parsed_output_is_an_error_with_a_code_never_partial_content(
    monkeypatch, stop_reason, status, code
):
    use_llm(monkeypatch, LlmResult(None, stop_reason, 14440, 16000))
    resp = post(mint())
    assert resp.status_code == status
    body = resp.json()
    assert set(body) == {"detail", "code"}
    assert body["code"] == code
    assert "ręcznie" in body["detail"]


def test_only_a_real_truncation_is_called_too_large(monkeypatch):
    """A refusal written as plain text fails the SDK's schema validation and comes
    back as INVALID_OUTPUT — it must not tell the appraiser the book is too large."""
    refusal = message([{"type": "text", "text": "Nie mogę pomóc."}], stop_reason="refusal")
    monkeypatch.setattr(main, "kw_llm", lambda: AnthropicAdapter(sdk_answering(refusal)))
    resp = post(mint())
    assert resp.status_code == 422
    assert resp.json()["code"] == "kw_transkrypcja_nieczytelna"
    assert "obszerna" not in resp.json()["detail"]

    use_llm(monkeypatch, LlmResult(None, "max_tokens", 14440, 16000))
    resp = post(mint())
    assert resp.json()["code"] == "kw_transkrypcja_ucieta"
    assert "obszerna" in resp.json()["detail"]


def test_a_failing_model_call_is_a_retryable_502(monkeypatch):
    class Boom:
        def parse(self, **kwargs):
            raise ConnectionError("upstream down")

    monkeypatch.setattr(main, "kw_llm", lambda: Boom())
    resp = post(mint())
    assert resp.status_code == 502
    assert resp.json()["code"] == "kw_transkrypcja_blad"
    assert "spróbuj ponownie" in resp.json()["detail"]


def test_invalid_token_401(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    assert post("1.2.3").status_code == 401
    assert post(mint(exp_offset=-10)).status_code == 401
    assert fake.calls == []


def test_non_pdf_415(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    assert post(mint(), b"\xff\xd8\xff", "image/jpeg").status_code == 415
    assert fake.calls == []


def test_oversize_413_same_limit_as_kw_extract(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    monkeypatch.setattr(main, "kw_max_bytes", lambda: 10)
    assert post(mint(), b"%PDF" + b"x" * 20).status_code == 413
    assert fake.calls == []


def test_an_oversize_upload_is_read_only_up_to_the_limit(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    monkeypatch.setattr(main, "kw_max_bytes", lambda: 10)
    sizes = record_upload_reads(monkeypatch)
    assert post(mint(), b"%PDF" + b"x" * 20).status_code == 413
    assert sizes == [11]
    assert fake.calls == []


def test_transcription_code_does_not_import_anthropic():
    assert anthropic_imports(APP / "kw_transcribe.py") == []


def test_prompt_excludes_separator_rows_and_never_asks_to_omit_persons():
    assert '["---"]' in kw_transcribe.PROMPT
    assert "bez pomijania osób fizycznych" in kw_transcribe.PROMPT
    assert "POMIJAJ" not in kw_transcribe.PROMPT


# --- transcribe: PDFs and/or a pasted book through one prompt (ADR-021) -----------


def test_transcribe_forwards_documents_and_text_to_the_port_unchanged():
    fake = FakeLlmClient(ok_result())
    result = kw_transcribe.transcribe(
        fake, ["JVBERg==", "JVBERi0x"], "DZIAŁ I-O\nNumer działki | 217/4 | 1"
    )
    assert result is fake.result
    assert fake.calls == [
        dict(
            model="claude-opus-5",
            documents=["JVBERg==", "JVBERi0x"],
            text="DZIAŁ I-O\nNumer działki | 217/4 | 1",
            prompt=kw_transcribe.PROMPT,
            schema=KsiegaTresc,
            max_tokens=16000,
            thinking={"type": "adaptive"},
        )
    ]


def test_transcribe_with_text_only_sends_no_documents():
    fake = FakeLlmClient(ok_result())
    kw_transcribe.transcribe(fake, [], "DZIAŁ IV\nBRAK WPISÓW")
    (call,) = fake.calls
    assert call["documents"] == []
    assert call["text"] == "DZIAŁ IV\nBRAK WPISÓW"


def test_transcribe_without_a_parsed_answer_raises_with_the_code():
    fake = FakeLlmClient(LlmResult(None, "max_tokens", 1, 16000))
    with pytest.raises(kw_transcribe.TranscriptionFailed) as failed:
        kw_transcribe.transcribe(fake, ["JVBERg=="], None)
    assert failed.value.code == "kw_transkrypcja_ucieta"


def test_prompt_is_neutral_about_the_carrier_and_explains_pipe_rows():
    first_line = kw_transcribe.PROMPT.splitlines()[0]
    assert first_line.startswith("Załączone dokumenty lub tekst to treść księgi wieczystej")
    assert "PDF" not in first_line
    assert "TREŚĆ KSIĘGI WIECZYSTEJ NR" in first_line
    assert "etykieta | wartość | nr podstawy" in kw_transcribe.PROMPT
    # The rules below the first paragraph are the spike's, unchanged.
    assert "- polaDodatkowe: numerLokalu (dział I-O)" in kw_transcribe.PROMPT


def test_limits_of_the_channels():
    assert kw_transcribe.MAX_FILES == 5
    assert kw_transcribe.MAX_TEXT_BYTES == 200 * 1024
