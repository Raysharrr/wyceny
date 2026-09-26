"""/kw-transcribe (operat-bugfix KW.2): full content of a unit's book through the
`LlmClient` port. The model is always `FakeLlmClient` — no SDK, no network.
Fixture = the synthetic book (fictional people and numbers) from the models spike."""

import base64
import hashlib
import hmac
import json
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import kw_transcribe, main
from app.kw_transcribe import KsiegaTresc
from app.llm import INVALID_OUTPUT, AnthropicAdapter, LlmResult
from tests.fake_llm import FakeLlmClient
from tests.test_llm import anthropic_imports, message, sdk_streaming
from tests.test_pdf_pages import record_upload_reads

SECRET = "test-secret"
FIXTURE = Path(__file__).parent / "fixtures" / "kw_transcribe_sample.json"
APP = Path(__file__).resolve().parents[1] / "app"
client = TestClient(main.app)


# Dzisiejszy prompt karty lokalu, zamrożony (F-W5): karta lokalu nie zmienia się o bajt.
PROMPT_PRZED = """Załączone dokumenty lub tekst to treść księgi wieczystej z przeglądarki eKW lub e-odpisu (działy I-O, I-Sp, II, III, IV); każda zakładka lub strona może powtarzać nagłówek „TREŚĆ KSIĘGI WIECZYSTEJ NR …” — to jedna księga, nagłówek przepisz raz. Gdy tekst ma wiersze `etykieta | wartość | nr podstawy`, kolumny są rozdzielone znakiem „|”: pierwsza to etykieta rubryki, środkowe to jej wartości, ostatnia to „Nr podstawy wpisu”.
Przepisz PEŁNĄ treść wszystkich działów do schematu — dosłownie, znak w znak: bez poprawiania, skracania, streszczania i bez pomijania osób fizycznych (imiona, nazwiska, imiona rodziców i PESEL przepisz tak, jak są w dokumencie; to materiał do operatu szacunkowego).

Zasady:
- naglowek: z nagłówka wydruku — numer księgi, „STAN Z DNIA” z pierwszej strony, sąd, wydział, rodzaj księgi (np. „LOKAL STANOWIĄCY ODRĘBNĄ NIERUCHOMOŚĆ”).
- dzialy: każdy dział osobno, w kolejności z dokumentu. Dział oznaczony „BRAK WPISÓW” → brakWpisow=true, puste tabele i dokumenty.
- tabele: każda tabela działu; naglowek = tytuł tabeli (np. „Lokal”, „Właściciele”) albo null, gdy tabela nie ma tytułu.
- wpisy: grupa wierszy otwarta wierszem „Lp. N.” (lp="N"); gdy tabela nie ma takiego wiersza — jeden wpis z lp=null. nrPodstawyWpisu = wartość z prawej kolumny „Nr podstawy wpisu” tego wpisu.
- rubryki: każdy wiersz tabeli. nazwa = pełna etykieta z lewej kolumny łącznie z opisem w nawiasie; lp = numer z komórki „Lp. N.” w tym wierszu albo null; wartosci = komórki wartości od lewej do prawej, każda jako osobny string. Gdy w jednym wierszu stoi kilka etykiet obok siebie (np. Ulica | Numer budynku | Numer lokalu), utwórz osobną rubrykę dla każdej etykiety z jej wartością. Wiersz będący tylko podtytułem (np. „Wierzyciel hipoteczny”) → rubryka z pustą listą wartosci.
- Wiersz „Lp. N.” otwierający wpis (z komórką „---”) NIE jest rubryką — jego numer trafia wyłącznie do lp wpisu; nigdy nie zwracaj rubryki z wartosci ["---"].
- Tekst łamany w komórce na kilka linii łącz pojedynczą spacją. Zachowaj wielkość liter, interpunkcję, spacje wokół „/”, rodzaj kresek („–” vs „-”) i zera wiodące.
- dokumenty: sekcja „DOKUMENTY BĘDĄCE PODSTAWĄ WPISU / DANE O WNIOSKU” danego działu (także gdy powtarza się w kilku działach). dokument = linia z danymi dokumentu; dokumentOpisPol = opis pól w nawiasie pod nią; wniosek = linia „DZ. KW./…”; wniosekOpisPol = opis pól w nawiasie pod nią.
- polaDodatkowe: numerLokalu (dział I-O), kwLokalu (nagłówek), kwGruntu (dział I-O „Przyłączenie”), udzial (dział I-Sp, wielkość udziału), powierzchniaUzytkowa (dział I-O, z jednostką jak w dokumencie), podstawaNabycia = dokument z działu II będący podstawą wpisu właściciela, rozbity na tytulAktu, repA, dataAktu (RRRR-MM-DD), notariusz (imię i nazwisko), siedzibaNotariusza. Null, gdy pola nie ma.
Nie dodawaj niczego, czego nie ma w dokumencie."""


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


PDF = b"%PDF-1.4 ksiega"


def b64(content: bytes) -> str:
    return base64.standard_b64encode(content).decode()


def post_form(
    token: str,
    *,
    files: list[tuple[str, bytes, str]] = (),
    tekst: str | None = None,
    file: tuple[str, bytes, str] | None = None,
):
    """The endpoint's multipart form: `files` repeated per PDF, `tekst` when
    given, `file` = the old web's single field (alias, see the endpoint)."""
    data = {"token": token}
    if tekst is not None:
        data["tekst"] = tekst
    parts = [("files", part) for part in files]
    if file is not None:
        parts.append(("file", file))
    return client.post("/kw-transcribe", data=data, files=parts or None)


def post(token: str, content: bytes = PDF, mime: str = "application/pdf"):
    """One PDF through `files` — the shape most tests need."""
    return post_form(token, files=[("kw.pdf", content, mime)])


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
            max_tokens=32000,
            thinking={"type": "adaptive"},
        )
    ]


def test_a_transcription_failing_validation_is_returned_with_the_verdict(monkeypatch):
    """Validation judges, the endpoint never rejects: web stores the content whatever
    the verdict says (ADR-021) and shows it as a standing warning."""
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
    use_llm(monkeypatch, LlmResult(None, stop_reason, 14440, 32000))
    resp = post(mint())
    assert resp.status_code == status
    body = resp.json()
    assert set(body) == {"detail", "code"}
    assert body["code"] == code
    if code == "kw_transkrypcja_ucieta":
        # Ścieżki ręcznej nie ma od ADR-021: za obszerna księga = wklej mniej.
        assert body["detail"] == (
            "Treść księgi jest zbyt obszerna, żeby przepisać ją w całości — wklej z "
            "przeglądarki KW tylko wpisy dotyczące przedmiotowego lokalu."
        )
    else:
        assert "ręcznie" in body["detail"]


def test_only_a_real_truncation_is_called_too_large(monkeypatch):
    """A refusal written as plain text fails the adapter's schema validation and
    comes back as INVALID_OUTPUT — it must not tell the appraiser the book is too large."""
    refusal = message([{"type": "text", "text": "Nie mogę pomóc."}], stop_reason="refusal")
    monkeypatch.setattr(main, "kw_llm", lambda: AnthropicAdapter(sdk_streaming(refusal)))
    resp = post(mint())
    assert resp.status_code == 422
    assert resp.json()["code"] == "kw_transkrypcja_nieczytelna"
    assert "obszerna" not in resp.json()["detail"]

    use_llm(monkeypatch, LlmResult(None, "max_tokens", 14440, 32000))
    resp = post(mint())
    assert resp.json()["code"] == "kw_transkrypcja_ucieta"
    assert "obszerna" in resp.json()["detail"]


def test_kw_transcribe_sends_the_pre_port_request_byte_for_byte(monkeypatch):
    """The adapter always streams with `output_config`, never `output_format`
    (ADR-024; Z3 kw-banner-fix), so the request is pinned on the wire, for the
    transcription's own shape: two PDFs, a paste and adaptive thinking. The HTTP
    body /kw-transcribe sends is byte for byte the body of the SDK's own
    `messages.stream(output_format=KsiegaTresc)`."""
    pdfs = [b"%PDF-1.4 dzial I-O", b"%PDF-1.4 dzial II"]
    tekst = "DZIAŁ IV\nBRAK WPISÓW"
    answer = message([{"type": "text", "text": sample_tresc().model_dump_json()}])

    # Reference request: the SDK's stream helper with `output_format`.
    pre_port: list[httpx.Request] = []
    with sdk_streaming(answer, pre_port).messages.stream(
        model=kw_transcribe.TRANSCRIBE_MODEL,
        max_tokens=kw_transcribe.MAX_TOKENS,
        thinking={"type": "adaptive"},
        messages=[
            {
                "role": "user",
                "content": [
                    *(
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": b64(pdf),
                            },
                        }
                        for pdf in pdfs
                    ),
                    {"type": "text", "text": f"<tresc_ksiegi>\n{tekst}\n</tresc_ksiegi>"},
                    {"type": "text", "text": kw_transcribe.PROMPT},
                ],
            }
        ],
        output_format=KsiegaTresc,
    ) as reference_stream:
        reference_stream.get_final_message()

    sent: list[httpx.Request] = []
    monkeypatch.setattr(main, "kw_llm", lambda: AnthropicAdapter(sdk_streaming(answer, sent)))
    resp = post_form(
        mint(),
        files=[(f"kw{i}.pdf", pdf, "application/pdf") for i, pdf in enumerate(pdfs)],
        tekst=tekst,
    )

    assert resp.status_code == 200
    (reference,) = pre_port
    (request,) = sent
    assert (request.method, request.url) == (reference.method, reference.url)
    assert request.content == reference.content


def test_json_cut_at_max_tokens_by_the_real_sdk_is_called_too_large(monkeypatch):
    """Z3 proof 3: the adapter's own result for JSON cut at max_tokens — not a
    hand-made `LlmResult` — is a truncation, end to end."""
    cut = message([{"type": "text", "text": '{"naglowek": {"numerKs'}], stop_reason="max_tokens")
    with pytest.raises(kw_transcribe.TranscriptionFailed) as failed:
        kw_transcribe.transcribe(AnthropicAdapter(sdk_streaming(cut)), ["JVBERg=="], None)
    assert failed.value.code == "kw_transkrypcja_ucieta"

    monkeypatch.setattr(main, "kw_llm", lambda: AnthropicAdapter(sdk_streaming(cut)))
    resp = post(mint())
    assert resp.status_code == 422
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
    lokal = kw_transcribe.prompt_dla("lokal", None)
    assert '["---"]' in lokal
    assert "bez pomijania osób fizycznych" in lokal
    assert "POMIJAJ" not in lokal
    grunt = kw_transcribe.prompt_dla("grunt", kw_transcribe.KluczeLokalu(KW, NR))
    assert '["---"]' in grunt
    assert "osoby fizyczne tak, jak są w dokumencie" in grunt
    assert "POMIJAJ" not in grunt


# --- prompts per card (ADR-024 R1) -------------------------------------------------

KW = sample()["naglowek"]["numerKsiegi"]  # numer z fikstury (F-9)
NR = sample()["polaDodatkowe"]["numerLokalu"]


def test_lokal_prompt_is_todays_prompt_byte_for_byte():
    assert kw_transcribe.prompt_dla("lokal", None) == PROMPT_PRZED
    assert kw_transcribe.prompt_dla("lokal", kw_transcribe.KluczeLokalu(KW, NR)) == PROMPT_PRZED
    assert kw_transcribe.PROMPT == PROMPT_PRZED


def _selektywny(lokal_io: str, lokal_ii: str, klucze: str) -> str:
    """The spike's construction (spike.py `prompt_selektywny`): today's prompt with
    the full-scope paragraph replaced."""
    return PROMPT_PRZED.replace(
        kw_transcribe.PELNA,
        kw_transcribe.SELEKTYWNA.format(lokal_io=lokal_io, lokal_ii=lokal_ii, klucze=klucze),
    )


def test_land_prompt_with_both_keys_is_the_spikes_prompt():
    assert kw_transcribe.prompt_dla("grunt", kw_transcribe.KluczeLokalu(KW, NR)) == _selektywny(
        "przepisz tylko wiersz przedmiotowego lokalu",
        "przepisz tylko wpis przedmiotowego lokalu",
        f"Przedmiotowy lokal: numer księgi wieczystej lokalu {KW}, numer lokalu {NR}. "
        "Wiersz lub wpis należy do przedmiotowego lokalu tylko wtedy, gdy zawiera ten numer księgi.",
    )


def test_land_prompt_with_the_book_number_only_names_no_unit_number():
    prompt = kw_transcribe.prompt_dla("grunt", kw_transcribe.KluczeLokalu(KW, None))
    assert prompt == _selektywny(
        "przepisz tylko wiersz przedmiotowego lokalu",
        "przepisz tylko wpis przedmiotowego lokalu",
        f"Przedmiotowy lokal: numer księgi wieczystej lokalu {KW}. "
        "Wiersz lub wpis należy do przedmiotowego lokalu tylko wtedy, gdy zawiera ten numer księgi.",
    )
    assert "None" not in prompt


def test_land_prompt_without_keys_skips_every_unit_list():
    assert kw_transcribe.prompt_dla("grunt", None) == _selektywny(
        "nie przepisuj żadnego wiersza",
        "nie przepisuj żadnego wpisu",
        "Przedmiotowy lokal nie jest znany — pomiń wszystkie wiersze list lokali.",
    )


def test_selective_paragraph_is_the_spikes_verbatim():
    # wiki-repo tools/spike/2026-09-25-kw-grunt-selektywnie/spike.py `SELEKTYWNA` —
    # jedyny zmierzony tekst (keyed 3/3 PASS).
    assert kw_transcribe.SELEKTYWNA.startswith(
        "To księga NIERUCHOMOŚCI GRUNTOWEJ, z której wyodrębniono lokale."
    )
    assert kw_transcribe.SELEKTYWNA.endswith(
        "- polaDodatkowe: to księga gruntu — wszystkie pola null."
    )
    assert "osoby fizyczne tak, jak są w dokumencie" in kw_transcribe.SELEKTYWNA
    assert "POMIJAJ" not in kw_transcribe.prompt_dla("grunt", None)
    # SHA-256 tekstu `SELEKTYWNA` ze spike'u (repo wiki nie jest dostępne w CI):
    # każda zmiana akapitu to nowy, niezmierzony prompt.
    assert hashlib.sha256(kw_transcribe.SELEKTYWNA.encode()).hexdigest() == (
        "27c74540d30e4156e811341ad38d5f67d7970ac4ae561afa02e6d61dccbf0bdb"
    )


def test_both_cards_share_the_first_line_and_the_rules():
    for prompt in (
        kw_transcribe.prompt_dla("lokal", None),
        kw_transcribe.prompt_dla("grunt", None),
    ):
        assert prompt.startswith(kw_transcribe.NAGLOWEK_PROMPTU + "\n")
        assert prompt.endswith("\n\n" + kw_transcribe.ZASADY)


def test_zakres_follows_the_card():
    assert kw_transcribe.ZAKRES == {"lokal": "pelna", "grunt": "przedmiotowy_lokal"}


def test_one_limit_for_both_cards():
    assert kw_transcribe.MAX_TOKENS == 32000


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
            max_tokens=32000,
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
    fake = FakeLlmClient(LlmResult(None, "max_tokens", 1, 32000))
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


# --- endpoint: PDFs and/or a pasted book, limits, the old `file` field --------------


def test_two_pdfs_reach_the_model_as_two_documents_in_upload_order(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    first, second = b"%PDF-1.4 dzial I-O", b"%PDF-1.4 dzial II"
    resp = post_form(
        mint(),
        files=[("1.pdf", first, "application/pdf"), ("2.pdf", second, "application/pdf")],
    )
    assert resp.status_code == 200
    assert resp.json() == sample()
    (call,) = fake.calls
    assert call["documents"] == [b64(first), b64(second)]
    assert call["text"] is None


def test_pasted_text_alone_reaches_the_model_as_text_with_no_documents(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    text = "TREŚĆ KSIĘGI WIECZYSTEJ NR …\nDZIAŁ I-O\nNumer działki | 217/4 | 1"
    resp = post_form(mint(), tekst=text)
    assert resp.status_code == 200
    assert resp.json() == sample()
    (call,) = fake.calls
    assert call["documents"] == []
    assert call["text"] == text


def test_pdf_and_text_together_send_both(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    resp = post_form(
        mint(), files=[("kw.pdf", PDF, "application/pdf")], tekst="DZIAŁ IV\nBRAK WPISÓW"
    )
    assert resp.status_code == 200
    (call,) = fake.calls
    assert call["documents"] == [b64(PDF)]
    assert call["text"] == "DZIAŁ IV\nBRAK WPISÓW"


@pytest.mark.parametrize("tekst", [None, "", "   \n\t"])
def test_nothing_to_read_is_422_before_any_model_call(monkeypatch, tekst):
    fake = use_llm(monkeypatch, ok_result())
    resp = post_form(mint(), tekst=tekst)
    assert resp.status_code == 422
    assert "PDF" in resp.json()["detail"] and "wklej" in resp.json()["detail"]
    assert fake.calls == []


def test_more_than_five_files_is_422(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    six = [(f"{i}.pdf", PDF, "application/pdf") for i in range(6)]
    resp = post_form(mint(), files=six)
    assert resp.status_code == 422
    assert "5" in resp.json()["detail"]
    assert fake.calls == []


def test_a_non_pdf_among_the_files_is_415(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    resp = post_form(
        mint(),
        files=[("kw.pdf", PDF, "application/pdf"), ("kot.jpg", b"\xff\xd8\xff", "image/jpeg")],
    )
    assert resp.status_code == 415
    assert fake.calls == []


def test_text_over_the_limit_is_413_counted_in_utf8_bytes_and_never_echoed(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    monkeypatch.setattr(main, "kw_max_text_bytes", lambda: 20)
    text = "ąęśćłńóż" * 2  # 16 characters, 32 bytes — over the limit only in bytes
    resp = post_form(mint(), tekst=text)
    assert resp.status_code == 413
    assert "200 kB" in resp.json()["detail"]
    assert text not in resp.text and "ąęś" not in resp.text
    assert fake.calls == []


def test_total_size_of_the_files_is_capped_and_read_only_up_to_the_limit(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    monkeypatch.setattr(main, "kw_max_bytes", lambda: 10)
    sizes = record_upload_reads(monkeypatch)
    six = b"%PDF12"
    resp = post_form(
        mint(), files=[("1.pdf", six, "application/pdf"), ("2.pdf", six, "application/pdf")]
    )
    assert resp.status_code == 413
    assert "łącznie" in resp.json()["detail"]
    assert sizes == [11, 5]  # limit + 1, then what is left of the budget + 1
    assert fake.calls == []


def test_the_old_single_file_field_is_still_a_one_element_list(monkeypatch):
    """The web on main sends `file`; the worker deploys first. Follow-up after the
    web of PR-2 is merged: drop the alias and this test."""
    fake = use_llm(monkeypatch, ok_result())
    resp = post_form(mint(), file=("kw.pdf", PDF, "application/pdf"))
    assert resp.status_code == 200
    assert resp.json() == sample()
    (call,) = fake.calls
    assert call["documents"] == [b64(PDF)]
    assert call["text"] is None


def test_file_alias_and_files_together_are_one_list_alias_first(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    other = b"%PDF-1.4 inny"
    resp = post_form(
        mint(), files=[("2.pdf", other, "application/pdf")], file=("1.pdf", PDF, "application/pdf")
    )
    assert resp.status_code == 200
    (call,) = fake.calls
    assert call["documents"] == [b64(PDF), b64(other)]


# --- an empty or corrupt file never becomes an empty `document` block (review F5) ----


@pytest.mark.parametrize("content", [b"", b"nie-pdf-tylko-smieci"])
def test_an_empty_or_corrupt_file_is_415_and_never_reaches_the_model(monkeypatch, content):
    """A browser can hand over a zero-byte file. Without this guard it went to the
    model as `documents=[""]`, the API refused the block and the appraiser saw a
    generic 502 instead of being told which file to replace."""
    fake = use_llm(monkeypatch, ok_result())
    resp = post_form(mint(), files=[("pusta-ksiega.pdf", content, "application/pdf")])
    assert resp.status_code == 415
    assert resp.json()["detail"] == "Pusty lub uszkodzony plik PDF."
    # The name is the appraiser's own, often the book's number — never echoed (F-13).
    assert "pusta-ksiega" not in resp.text
    assert fake.calls == []


def test_an_empty_file_next_to_a_good_one_stops_the_whole_request(monkeypatch):
    fake = use_llm(monkeypatch, ok_result())
    resp = post_form(
        mint(),
        files=[("kw.pdf", PDF, "application/pdf"), ("pusty.pdf", b"", "application/pdf")],
    )
    assert resp.status_code == 415
    assert fake.calls == []


def test_an_empty_file_does_not_block_a_paste(monkeypatch):
    """The guard judges the files it was given, not the request as a whole: a paste
    with no files at all still goes through."""
    fake = use_llm(monkeypatch, ok_result())
    assert post_form(mint(), tekst="DZIAŁ IV\nBRAK WPISÓW").status_code == 200
    assert fake.calls[0]["documents"] == []
