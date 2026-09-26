"""PII on the transcription path (operat-bugfix KW.4, F-9/F-13). The full content
keeps persons' data on purpose (ADR-018 "Zmiana 15.09"), so no value of it may
reach a log line or an error answer — only counters and error classes.

Forbidden strings are taken from the synthetic book at runtime (never literals
here: this file is scanned by check-no-pii.sh like any other)."""

import hashlib
import hmac
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main
from app.kw_transcribe import KsiegaTresc
from app.llm import AnthropicAdapter, LlmResult
from tests.fake_llm import FakeLlmClient
from tests.test_llm import message, sdk_streaming

SECRET = "test-secret"
FIXTURE = Path(__file__).parent / "fixtures" / "kw_transcribe_sample.json"
client = TestClient(main.app)


def sample_tresc() -> dict:
    doc = json.loads(FIXTURE.read_text())
    doc.pop("walidacja")
    doc.pop("zakres")  # set by the worker from the card, not a value of the book
    return doc


LABEL_KEYS = ("nazwa", "kod", "tytul", "dokumentOpisPol", "wniosekOpisPol")


def book_values(node) -> set[str]:
    """Every value of the book long enough to be identifying: names, PESELs, KW
    numbers, Rep. A, addresses, document lines. Labels, titles, table headers and
    field descriptions are eKW boilerplate, not values ("Lokal" is also a substring
    of the error class `pole_niezgodne:numerLokalu`)."""
    if isinstance(node, dict):
        return {
            v
            for k, child in node.items()
            if k not in LABEL_KEYS and not (k == "naglowek" and isinstance(child, str))
            for v in book_values(child)
        }
    if isinstance(node, list):
        return {v for child in node for v in book_values(child)}
    if isinstance(node, str) and len(node) >= 5:
        # Each comma-separated part too: a person rubric is "IMIĘ, IMIĘ, NAZWISKO, …, PESEL".
        return {node} | {part.strip() for part in node.split(",") if len(part.strip()) >= 5}
    return set()


# The unit's keys the land card sends (ADR-024) — values of the book too, and
# the prompt names them. The unit number is short ("24" is also a substring of
# timestamps), so it is forbidden as a JSON value, never as a substring.
KW_TEST = sample_tresc()["naglowek"]["numerKsiegi"]
NR_TEST = sample_tresc()["polaDodatkowe"]["numerLokalu"]
FORBIDDEN = book_values(sample_tresc()) | {KW_TEST, f'"{NR_TEST}"'}
KLUCZE = {"karta": "grunt", "kw_lokalu": KW_TEST, "nr_lokalu": NR_TEST}


def mint() -> str:
    exp = int(time.time()) + 300
    sig = hmac.new(SECRET.encode(), f"{exp}.n0nce".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.n0nce.{sig}"


@pytest.fixture(autouse=True)
def secret_env(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)


def post(**form: str):
    """The land card with both keys unless `form` says otherwise — the request
    that carries the most values."""
    return client.post(
        "/kw-transcribe",
        data={"token": mint(), **KLUCZE, **form},
        files={"file": ("kw.pdf", b"%PDF-1.4 ksiega", "application/pdf")},
    )


def log_text(captured: str) -> str:
    """Log lines decoded (JSONRenderer escapes non-ASCII) and re-rendered verbatim."""
    lines = [json.loads(line) for line in captured.splitlines() if line.strip()]
    assert lines, "no log line captured — the test would be blind"
    return "\n".join(json.dumps(line, ensure_ascii=False) for line in lines)


def leaked(text: str) -> list[str]:
    return sorted(v for v in FORBIDDEN if v in text)


def test_forbidden_set_covers_persons_pesels_kw_numbers_and_rep_a():
    tresc = sample_tresc()
    pola = tresc["polaDodatkowe"]
    assert {pola["kwLokalu"], pola["kwGruntu"], pola["podstawaNabycia"]["repA"]} <= FORBIDDEN
    osoby = [
        part.strip()
        for d in tresc["dzialy"]
        for t in d["tabele"]
        for w in t["wpisy"]
        for r in w["rubryki"]
        if r["nazwa"].startswith("Osoba fizyczna")
        for v in r["wartosci"]
        for part in v.split(",")
    ]
    assert len(osoby) == 18  # 3 persons x (2 names, surname, 2 parents, PESEL)
    assert {p for p in osoby if len(p) >= 5} <= FORBIDDEN


def test_forbidden_set_covers_the_keys():
    assert {KW_TEST, f'"{NR_TEST}"'} <= FORBIDDEN


def test_successful_transcription_logs_counters_only(monkeypatch, capsys):
    tresc = KsiegaTresc.model_validate(sample_tresc())
    tresc.polaDodatkowe.numerLokalu = "0" + (tresc.polaDodatkowe.numerLokalu or "")  # verdict fails
    fake = FakeLlmClient(LlmResult(tresc, "end_turn", 14440, 4909))
    monkeypatch.setattr(main, "kw_llm", lambda: fake)

    # The unit's book on its own card; the keys ride along and are ignored there.
    assert post(karta="lokal").status_code == 200

    text = log_text(capsys.readouterr().out)
    assert leaked(text) == []
    done = [json.loads(line) for line in text.splitlines() if '"kw_transcribe_done"' in line]
    assert len(done) == 1
    assert done[0]["dzialy"] == 5
    assert done[0]["walidacja_ok"] is False
    assert done[0]["walidacja_bledy"] == [{"klasa": "pole_niezgodne:numerLokalu", "dzial": "I-O"}]


@pytest.mark.parametrize(
    ("form", "karta", "zakres", "klucze"),
    [
        ({}, "grunt", "przedmiotowy_lokal", "kw+nr"),
        ({"nr_lokalu": ""}, "grunt", "przedmiotowy_lokal", "kw"),
        ({"kw_lokalu": "", "nr_lokalu": ""}, "grunt", "przedmiotowy_lokal", "brak"),
        ({"karta": "lokal"}, "lokal", "pelna", "brak"),
    ],
)
def test_done_line_names_the_card_scope_and_which_keys(
    monkeypatch, capsys, form, karta, zakres, klucze
):
    fake = FakeLlmClient(LlmResult(KsiegaTresc.model_validate(sample_tresc()), "end_turn", 1, 1))
    monkeypatch.setattr(main, "kw_llm", lambda: fake)

    assert post(**form).status_code == 200

    log = log_text(capsys.readouterr().out)
    assert leaked(log) == []
    (done,) = [json.loads(line) for line in log.splitlines() if '"kw_transcribe_done"' in line]
    assert (done["karta"], done["zakres"], done["klucze"]) == (karta, zakres, klucze)


def test_failed_line_names_the_card_and_which_keys(monkeypatch, capsys):
    fake = FakeLlmClient(LlmResult(None, "max_tokens", 1, 24000))
    monkeypatch.setattr(main, "kw_llm", lambda: fake)

    assert post().status_code == 422

    log = log_text(capsys.readouterr().out)
    assert leaked(log) == []
    (failed,) = [json.loads(line) for line in log.splitlines() if '"kw_transcribe_failed"' in line]
    assert (failed["karta"], failed["klucze"]) == ("grunt", "kw+nr")


@pytest.mark.parametrize("stop_reason", ["max_tokens", "end_turn"])
def test_model_answer_failing_schema_validation_leaks_nothing(monkeypatch, capsys, stop_reason):
    """Half the book as the model's text — with its persons. Cut at max_tokens it
    is reported as a truncation without being parsed; ended normally, pydantic's
    ValidationError quotes it, and the adapter must swallow that unquoted."""
    book = json.dumps(sample_tresc(), ensure_ascii=False)
    cut = message([{"type": "text", "text": book[: len(book) * 2 // 3]}], stop_reason=stop_reason)
    assert leaked(cut["content"][0]["text"])  # the answer really carries the values
    monkeypatch.setattr(main, "kw_llm", lambda: AnthropicAdapter(sdk_streaming(cut)))

    resp = post()

    assert resp.status_code == 422
    assert leaked(resp.text) == []
    assert leaked(log_text(capsys.readouterr().out)) == []


def test_exception_quoting_the_content_leaks_nothing(monkeypatch, capsys):
    value = sorted(FORBIDDEN)[0]

    class Quoting:
        def parse(self, **kwargs):
            raise ValueError(f"nie pasuje: {value}")

    monkeypatch.setattr(main, "kw_llm", lambda: Quoting())

    resp = post()

    assert resp.status_code == 502
    assert leaked(resp.text) == []
    assert leaked(log_text(capsys.readouterr().out)) == []


# --- the pasted book is content too: never in a log, never in an error body ----------


def pasted_book() -> str:
    """The synthetic book as the eKW tabs paste it: label | values | basis per row,
    so every forbidden value is in the text."""
    tresc = sample_tresc()
    lines = [f"TREŚĆ KSIĘGI WIECZYSTEJ NR {tresc['naglowek']['numerKsiegi']}"]
    for d in tresc["dzialy"]:
        lines.append(d["tytul"])
        for t in d["tabele"]:
            for w in t["wpisy"]:
                for r in w["rubryki"]:
                    wartosci = " | ".join(r["wartosci"])
                    lines.append(f"{r['nazwa']} | {wartosci} | {w['nrPodstawyWpisu'] or ''}")
    return "\n".join(lines)


def post_text(text: str):
    return client.post("/kw-transcribe", data={"token": mint(), "tekst": text, **KLUCZE})


def test_the_paste_carries_the_forbidden_values():
    assert len(leaked(pasted_book())) >= 20


def test_pasted_text_never_reaches_a_log_only_its_counters_do(monkeypatch, capsys):
    text = pasted_book()
    fake = FakeLlmClient(
        LlmResult(KsiegaTresc.model_validate(sample_tresc()), "end_turn", 7807, 2911)
    )
    monkeypatch.setattr(main, "kw_llm", lambda: fake)

    assert post_text(text).status_code == 200

    log = log_text(capsys.readouterr().out)
    assert leaked(log) == []
    (done,) = [json.loads(line) for line in log.splitlines() if '"kw_transcribe_done"' in line]
    assert done["kanal"] == "tekst"
    assert done["plikow"] == 0
    assert done["bytes"] == 0
    assert done["tekst_bajtow"] == len(text.encode("utf-8"))
    assert done["dzialy"] == 5


def test_a_failing_model_call_on_a_paste_leaks_nothing(monkeypatch, capsys):
    value = sorted(FORBIDDEN)[0]

    class Quoting:
        def parse(self, **kwargs):
            raise ValueError(f"nie pasuje: {value}")

    monkeypatch.setattr(main, "kw_llm", lambda: Quoting())

    resp = post_text(pasted_book())

    assert resp.status_code == 502
    assert leaked(resp.text) == []
    log = log_text(capsys.readouterr().out)
    assert leaked(log) == []
    (failed,) = [json.loads(line) for line in log.splitlines() if '"kw_transcribe_failed"' in line]
    assert failed["kanal"] == "tekst" and failed["plikow"] == 0


def test_a_too_long_paste_is_refused_without_quoting_it(monkeypatch, capsys):
    monkeypatch.setattr(main, "kw_max_text_bytes", lambda: 64)

    resp = post_text(pasted_book())

    assert resp.status_code == 413
    assert leaked(resp.text) == []
    assert leaked(log_text(capsys.readouterr().out)) == []


def test_pdf_and_paste_together_log_the_mixed_channel(monkeypatch, capsys):
    fake = FakeLlmClient(LlmResult(KsiegaTresc.model_validate(sample_tresc()), "end_turn", 1, 1))
    monkeypatch.setattr(main, "kw_llm", lambda: fake)
    pdf = b"%PDF-1.4 ksiega"

    resp = client.post(
        "/kw-transcribe",
        data={"token": mint(), "tekst": pasted_book(), **KLUCZE},
        files=[("files", ("kw.pdf", pdf, "application/pdf"))],
    )

    assert resp.status_code == 200
    log = log_text(capsys.readouterr().out)
    assert leaked(log) == []
    (done,) = [json.loads(line) for line in log.splitlines() if '"kw_transcribe_done"' in line]
    assert done["kanal"] == "pdf+tekst"
    assert done["plikow"] == 1
    assert done["bytes"] == len(pdf)
