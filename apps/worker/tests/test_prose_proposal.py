"""/prose-proposal endpoint tests (prose slice, task T3). The anthropic call is
always monkeypatched (`main._generate_prose_section`) — zero network, zero LLM,
zero API key in CI. Fixtures are fictional (ul. Klonowa, m. Nowogród — F-9)."""

import hashlib
import hmac
import inspect
import sys
import threading
import time
from types import ModuleType, SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import main
from app import prose as prose_core

client = TestClient(main.app)

SECRET = "test-secret"

# Facts exactly as the web side is contracted to send them: every number is a
# PL-formatted string, the only numeric leaf is proba.liczba_transakcji (int).
FAKTY = {
    "adres": "ul. Klonowa 14/3, Nowogród",
    "dzielnica": "Zarzecze",
    "obreb": "0007 Zarzecze",
    "pow_uzytkowa": "71,63",
    "rynek": "wtórny, lokale mieszkalne, Nowogród",
    "notatka_uklad": "pokój dzienny z aneksem kuchennym, 2 pokoje, łazienka z wc, przedpokój",
    "proba": {
        "liczba_transakcji": 14,
        "zakres_dat": "03-2024 – 11-2025",
        "cena_min_zl_m2": "9 240,00",
        "cena_srednia_zl_m2": "10 815,00",
        "cena_max_zl_m2": "12 480,00",
    },
    "pozycja_wyniku": "w przedziale cen próby, powyżej średniej",
}


def mint(exp_offset: int = 300) -> str:
    exp = int(time.time()) + exp_offset
    nonce = "cafe0123"
    sig = hmac.new(SECRET.encode(), f"{exp}.{nonce}".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{nonce}.{sig}"


@pytest.fixture(autouse=True)
def secret_env(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)


def post(token: str, sekcje=("opis_lokalu",), fakty=None, transakcje=None):
    return client.post(
        "/prose-proposal",
        json={
            "token": token,
            "sekcje": list(sekcje),
            "fakty": FAKTY if fakty is None else fakty,
            "transakcje": list(transakcje or []),
        },
    )


# Guard-clean: "71,63" is a fact and the digit in "m2" is not a number (style rule).
CLEAN = "Lokal o powierzchni użytkowej 71,63 m2 położony w zabudowie wielorodzinnej."
# "99,90" and "1998" appear nowhere in FAKTY — the guard must catch both.
DIRTY = "Lokal o powierzchni 99,90 m2 w budynku wzniesionym w 1998 roku."


class FakeLlm:
    """Stand-in for `main._generate_prose_section` — the sole anthropic seam.

    Scripted per section: `replies["opis_lokalu"] = [DIRTY, CLEAN]` returns DIRTY
    on the first call and CLEAN on the retry (the last entry repeats). Sections
    are generated in parallel threads, hence the lock around the call log.
    """

    def __init__(self, replies: dict[str, list[str]], default: str = CLEAN):
        self.replies = replies
        self.default = default
        self.calls: list[tuple[str, str, str | None]] = []
        self._lock = threading.Lock()

    def __call__(self, section: str, prompt: str, correction: str | None = None):
        with self._lock:
            attempt = sum(1 for call in self.calls if call[0] == section)
            self.calls.append((section, prompt, correction))
        scripted = self.replies.get(section)
        text = scripted[min(attempt, len(scripted) - 1)] if scripted else self.default
        return main.ProseCompletion(text=f"  {text}  ", input_tokens=100, output_tokens=10)

    def calls_for(self, section: str) -> list[tuple[str, str, str | None]]:
        return [call for call in self.calls if call[0] == section]


def test_invalid_token_401():
    assert post("1.2.3").status_code == 401


def test_expired_token_401():
    assert post(mint(exp_offset=-10)).status_code == 401


def test_no_secret_in_env_401(monkeypatch):
    monkeypatch.delenv("WORKER_SHARED_SECRET")
    assert post(mint()).status_code == 401


def test_unknown_section_400():
    resp = post(mint(), sekcje=["opis_lokalu", "wnioski_koncowe"])
    assert resp.status_code == 400
    assert "wnioski_koncowe" in resp.json()["detail"]


def test_empty_sections_400():
    resp = post(mint(), sekcje=[])
    assert resp.status_code == 400


def test_float_in_facts_400():
    """PL-formatted strings only: the guard compares written forms, so a raw
    float in the facts guarantees a format mismatch. Bounce it at the border."""
    fakty = {**FAKTY, "pow_uzytkowa": 71.63}
    resp = post(mint(), fakty=fakty)
    assert resp.status_code == 400
    assert "pow_uzytkowa" in resp.json()["detail"]


def test_nested_float_in_facts_400():
    fakty = {**FAKTY, "proba": {**FAKTY["proba"], "cena_srednia_zl_m2": 10815.5}}
    resp = post(mint(), fakty=fakty)
    assert resp.status_code == 400
    assert "cena_srednia_zl_m2" in resp.json()["detail"]


def test_happy_path_two_sections(monkeypatch):
    fake = FakeLlm({})
    monkeypatch.setattr(main, "_generate_prose_section", fake)
    resp = post(mint(), sekcje=["opis_lokalu", "otoczenie"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["sekcje"] == {"opis_lokalu": CLEAN, "otoczenie": CLEAN}  # .strip()ed
    assert body["odrzucone"] == {}
    assert body["model"] == "claude-sonnet-5"
    assert body["usage"] == {"input_tokens": 200, "output_tokens": 20}  # summed over calls
    assert len(fake.calls) == 2  # one call per section, no retries on clean text


def test_prompt_is_the_validated_assembly(monkeypatch):
    """The prompt must be exactly what `prose.build_prompt` produces — the layout
    the 18 empirical generations were validated against."""
    fake = FakeLlm({})
    monkeypatch.setattr(main, "_generate_prose_section", fake)
    assert post(mint(), sekcje=["opis_lokalu"]).status_code == 200
    section, prompt, correction = fake.calls[0]
    assert section == "opis_lokalu"
    assert prompt == prose_core.build_prompt("opis_lokalu", FAKTY)
    assert correction is None


# Rising sample; 9871 is deliberately a number that appears nowhere in FAKTY.
RISING = [
    {"data": "03-2024", "cena_m2": 8000.0},
    {"data": "07-2024", "cena_m2": 8100.0},
    {"data": "09-2025", "cena_m2": 9871.0},
    {"data": "11-2025", "cena_m2": 9950.0},
]


def test_transactions_become_trend_and_never_reach_the_prompt(monkeypatch):
    fake = FakeLlm({})
    monkeypatch.setattr(main, "_generate_prose_section", fake)
    resp = post(mint(), sekcje=["analiza_rynku"], transakcje=RISING)
    assert resp.status_code == 200

    expected_facts = {**FAKTY, "proba": {**FAKTY["proba"], "trend_cen": "wzrostowe"}}
    _, prompt, _ = fake.calls[0]
    assert prompt == prose_core.build_prompt("analiza_rynku", expected_facts)
    # Raw prices stay out: in the facts they would widen the guard's allowed set.
    assert "9871" not in prompt


def test_facts_without_proba_skip_the_trend(monkeypatch):
    fake = FakeLlm({})
    monkeypatch.setattr(main, "_generate_prose_section", fake)
    fakty = {k: v for k, v in FAKTY.items() if k != "proba"}
    resp = post(mint(), sekcje=["opis_lokalu"], fakty=fakty, transakcje=RISING)
    assert resp.status_code == 200
    assert fake.calls[0][1] == prose_core.build_prompt("opis_lokalu", fakty)


def test_malformed_transaction_date_400(monkeypatch):
    """`price_trend` raises on a date outside MM-RRRR; bounce it at the border
    instead of silently dropping the trend (T2 backlog p. 3)."""
    monkeypatch.setattr(main, "_generate_prose_section", FakeLlm({}))
    # Two transactions: with a single one `price_trend` returns "stabilne"
    # without ever parsing the date.
    transakcje = [{"data": "2024-03", "cena_m2": 8000.0}, {"data": "05-2024", "cena_m2": 9000.0}]
    resp = post(mint(), sekcje=["analiza_rynku"], transakcje=transakcje)
    assert resp.status_code == 400
    assert "MM-RRRR" in resp.json()["detail"]


def test_int_transaction_count_is_allowed(monkeypatch):
    """proba.liczba_transakcji is the documented numeric exception — an int in
    the facts must NOT be rejected (only floats are)."""
    monkeypatch.setattr(main, "_generate_prose_section", FakeLlm({}))
    assert post(mint()).status_code == 200


def test_violations_trigger_one_retry_then_accept(monkeypatch):
    fake = FakeLlm({"opis_lokalu": [DIRTY, CLEAN]})
    monkeypatch.setattr(main, "_generate_prose_section", fake)
    resp = post(mint(), sekcje=["opis_lokalu"])
    assert resp.status_code == 200
    assert resp.json()["sekcje"] == {"opis_lokalu": CLEAN}
    assert resp.json()["odrzucone"] == {}

    first, retry = fake.calls_for("opis_lokalu")
    assert len(fake.calls) == 2
    assert retry[1] == first[1]  # the validated prompt is NOT reshaped on retry
    assert first[2] is None
    assert "99,90" in retry[2] and "1998" in retry[2]  # correction names the offenders


def test_twice_dirty_section_is_rejected_while_the_rest_returns(monkeypatch):
    fake = FakeLlm({"otoczenie": [DIRTY]})  # dirty on every attempt
    monkeypatch.setattr(main, "_generate_prose_section", fake)
    resp = post(mint(), sekcje=["opis_lokalu", "otoczenie"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["sekcje"] == {"opis_lokalu": CLEAN}  # rejected section is absent, not empty
    assert body["odrzucone"] == {"otoczenie": ["99,90", "1998"]}
    assert len(fake.calls_for("otoczenie")) == 2  # one retry, not more
    assert body["usage"] == {"input_tokens": 300, "output_tokens": 30}  # 3 calls billed


def test_guard_rejecting_every_section_returns_200_with_the_reasons(monkeypatch):
    """T5b: "no section survived" meant "the run failed" only while a batch was
    always six sections. T3 made it one or two, so a single refused section
    turned the whole request into a 502 — and a 502 carries nothing but a
    sentence, so every reason the guard found was discarded in exactly the
    "redo this one section" case they are kept for. A refusal IS a verdict
    about that text: it comes back, and the section stays for the appraiser."""
    fake = FakeLlm({}, default=DIRTY)
    monkeypatch.setattr(main, "_generate_prose_section", fake)
    resp = post(mint(), sekcje=["opis_lokalu", "otoczenie"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["sekcje"] == {}
    assert body["odrzucone"] == {
        "opis_lokalu": ["99,90", "1998"],
        "otoczenie": ["99,90", "1998"],
    }
    # 2 sections x 2 attempts: spent money is reported like on any other run,
    # because the web side takes the cost it records from this very response.
    assert body["usage"] == {"input_tokens": 400, "output_tokens": 40}


def test_single_section_batch_that_never_landed_still_502(monkeypatch):
    """The other half of the T5b split. An EMPTY list in `odrzucone` says the
    call itself failed, i.e. we learned nothing about that section — so even in
    the ordinary T3 batch shape (one section) this stays an error. A 200 here
    would have the web side record an attempt and stop retrying by itself after
    an ordinary network blip."""

    def boom(section, prompt, correction=None):
        raise RuntimeError("timeout")

    monkeypatch.setattr(main, "_generate_prose_section", boom)
    resp = post(mint(), sekcje=["opis_lokalu"])
    assert resp.status_code == 502
    assert "spróbuj ponownie" in resp.json()["detail"].lower()


def test_mixed_batch_is_200_because_one_verdict_is_real(monkeypatch):
    """Nothing generated: one call that never landed, one text the guard refused
    twice. That refusal is something we learned about a real section, so the
    response is worth keeping — the batch falls on the 200 side even though half
    of it was transient."""
    dirty = FakeLlm({}, default=DIRTY)

    def flaky(section, prompt, correction=None):
        if section == "opis_lokalu":
            raise RuntimeError("429 rate limit")
        return dirty(section, prompt, correction)

    monkeypatch.setattr(main, "_generate_prose_section", flaky)
    resp = post(mint(), sekcje=["opis_lokalu", "otoczenie"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["sekcje"] == {}
    assert body["odrzucone"] == {"opis_lokalu": [], "otoczenie": ["99,90", "1998"]}


def test_anthropic_touchpoint_is_confined_to_the_llm_helper():
    """ADR-009: one injectable function touches `anthropic`, everything else is
    testable without it."""
    assert "import anthropic" in inspect.getsource(main._generate_prose_section)
    for fn in (main._prose_section, main.prose_proposal, main._facts_with_trend):
        assert "anthropic" not in inspect.getsource(fn)


def test_f11_no_market_value_on_either_side():
    """F-11: the worker neither accepts nor returns a market value or the unit
    value of the result. `pozycja_wyniku` is a categorical string computed in web."""
    assert set(main.ProseProposalRequest.model_fields) == {"token", "sekcje", "fakty", "transakcje"}
    assert set(main.ProseProposalResponse.model_fields) == {
        "sekcje",
        "odrzucone",
        "model",
        "usage",
    }
    fields = set(main.ProseProposalRequest.model_fields) | set(
        main.ProseProposalResponse.model_fields
    )
    assert not [f for f in fields if "wartos" in f.lower() or "wartoś" in f.lower()]


def test_returned_prose_carries_no_number_outside_the_facts(monkeypatch):
    fake = FakeLlm({"opis_lokalu": [DIRTY, CLEAN]})  # retried section included
    monkeypatch.setattr(main, "_generate_prose_section", fake)
    resp = post(mint(), sekcje=["opis_lokalu", "otoczenie"], transakcje=RISING)
    assert resp.status_code == 200
    facts_seen_by_model = {**FAKTY, "proba": {**FAKTY["proba"], "trend_cen": "wzrostowe"}}
    texts = resp.json()["sekcje"]
    assert len(texts) == 2
    for text in texts.values():
        assert prose_core.validate_numbers(text, facts_seen_by_model) == []


def test_transaction_price_is_not_an_allowed_number(monkeypatch):
    """Keeping the sample out of the facts is what keeps the guard tight: a price
    the model saw nowhere in DANE is a violation even though it is a real
    transaction from the request."""
    fake = FakeLlm({"analiza_rynku": ["Ceny w próbie sięgały 9 871,00 zł za 1 m2."]})
    monkeypatch.setattr(main, "_generate_prose_section", fake)
    resp = post(mint(), sekcje=["analiza_rynku", "opis_lokalu"], transakcje=RISING)
    assert resp.status_code == 200
    assert resp.json()["odrzucone"] == {"analiza_rynku": ["9 871,00"]}
    assert list(resp.json()["sekcje"]) == ["opis_lokalu"]


def test_api_failure_502(monkeypatch):
    def boom(section, prompt, correction=None):
        raise RuntimeError("anthropic down")

    monkeypatch.setattr(main, "_generate_prose_section", boom)
    resp = post(mint(), sekcje=["opis_lokalu", "otoczenie"])
    assert resp.status_code == 502
    assert "spróbuj ponownie" in resp.json()["detail"].lower()


def test_one_failing_section_does_not_discard_the_others(monkeypatch):
    """Review finding: six sections run in parallel, so a single failing call
    (a rate limit on one of them) must not throw away the five that already
    succeeded AND were already paid for. The failed section is reported with an
    EMPTY violation list, which is how the web side tells "the guard rejected
    this" apart from "the call never landed"."""
    ok = FakeLlm({})

    def flaky(section, prompt, correction=None):
        if section == "otoczenie":
            raise RuntimeError("429 rate limit")
        return ok(section, prompt, correction)

    monkeypatch.setattr(main, "_generate_prose_section", flaky)
    resp = post(mint(), sekcje=["opis_lokalu", "otoczenie", "analiza_rynku"])
    assert resp.status_code == 200
    body = resp.json()
    assert sorted(body["sekcje"]) == ["analiza_rynku", "opis_lokalu"]
    assert body["odrzucone"] == {"otoczenie": []}


# --- The interior of `_generate_prose_section`: the ONE place where a wrong SDK
# parameter would surface only in production. Every other test monkeypatches
# this function away, so without the stub below the model name, max_tokens,
# thinking flag, content-block order and the truncation guard are unverified.


def install_stub_anthropic(monkeypatch, *, text="Proza sekcji.", stop_reason="end_turn"):
    """Minimal stand-in for the anthropic SDK. Returns the list of kwargs each
    `messages.create` call received, so the test can assert what really went out."""
    calls: list[dict] = []

    def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            stop_reason=stop_reason,
            content=[SimpleNamespace(type="text", text=text)],
            usage=SimpleNamespace(input_tokens=123, output_tokens=45),
        )

    stub = ModuleType("anthropic")
    stub.Anthropic = lambda: SimpleNamespace(messages=SimpleNamespace(create=create))
    monkeypatch.setitem(sys.modules, "anthropic", stub)
    return calls


def test_llm_call_uses_the_validated_parameters(monkeypatch):
    calls = install_stub_anthropic(monkeypatch)
    completion = main._generate_prose_section("opis_lokalu", "PROMPT")

    assert completion == main.ProseCompletion("Proza sekcji.", 123, 45)
    assert len(calls) == 1
    sent = calls[0]
    assert sent["model"] == "claude-sonnet-5"
    # Literal on purpose: asserting against PROSE_MAX_TOKENS would compare the
    # constant with itself and stay green for ANY value, including one that
    # truncates every section. The measured cost of the longest validated
    # section was ~650 output tokens, and a truncation cannot be cleared by
    # retrying (same facts -> same length), so the floor is asserted too.
    assert sent["max_tokens"] == 2500
    assert main.PROSE_MAX_TOKENS >= 2000
    # The prompts were validated on this exact pairing — thinking enabled is a
    # different model configuration than the one the evidence covers.
    assert sent["thinking"] == {"type": "disabled"}
    assert sent["messages"] == [{"role": "user", "content": [{"type": "text", "text": "PROMPT"}]}]


def test_correction_block_precedes_the_prompt(monkeypatch):
    """The validated prompt ENDS at "TEKST SEKCJI:" — the slot the model writes
    into. A correction appended after it would land inside that slot, so it must
    come first, and the prompt block must stay byte-identical."""
    calls = install_stub_anthropic(monkeypatch)
    main._generate_prose_section("opis_lokalu", "PROMPT", "KOREKTA\n\n")

    assert calls[0]["messages"][0]["content"] == [
        {"type": "text", "text": "KOREKTA\n\n"},
        {"type": "text", "text": "PROMPT"},
    ]


def test_retry_instruction_ends_with_a_blank_line():
    """Nothing guarantees the API separates two adjacent text blocks; without
    the trailing break the model could read "…z DANE poniżej.Jesteś rzeczoznawcą…"
    — the validated layout mangled on its very first line."""
    assert main.PROSE_RETRY_INSTRUCTION.endswith("\n\n")


def test_truncated_response_is_refused(monkeypatch):
    """Identical facts produce an identically long text, so a truncation would
    repeat on every retry. It must be refused here, not shipped half-written."""
    install_stub_anthropic(monkeypatch, stop_reason="max_tokens")
    with pytest.raises(RuntimeError, match="ucięta"):
        main._generate_prose_section("opis_lokalu", "PROMPT")


def test_empty_response_is_refused(monkeypatch):
    install_stub_anthropic(monkeypatch, text="   ")
    with pytest.raises(RuntimeError, match="pusta"):
        main._generate_prose_section("opis_lokalu", "PROMPT")
