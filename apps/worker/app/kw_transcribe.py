"""Full transcription of the five sections of a unit's land-register book
(I-O, I-Sp, II, III, IV) from an eKW printout PDF — operat §8.2 as the appraiser
pastes it (spike tools/spike/2026-09-15-kw-pelne-dzialy, PASS on claude-opus-5).

A separate call next to `/kw-extract`, which stays as it is. Persons' data stays
in on purpose (user decision 15.09, ADR-018 "Zmiana 15.09"): no `scrub_extract`
here — which is exactly why nothing from `KsiegaTresc` may reach a log.

The model is reached only through the `LlmClient` port; no SDK import here.
"""

import os
from typing import Literal

from pydantic import BaseModel, Field

from app.llm import INVALID_OUTPUT, LlmClient, LlmResult

TRANSCRIBE_MODEL = os.environ.get("LLM_KW_TRANSCRIBE_MODEL", "claude-opus-5")
# Non-streaming 16k, as measured in the spike: a unit's book is ~4.9k output tokens.
MAX_TOKENS = 16000

# --- schema: 1:1 with the spike (spike.py `KsiegaTresc`, RAPORT "Proponowany schemat")


class Rubryka(BaseModel):
    nazwa: str = Field(
        description="pelna etykieta wiersza z lewej kolumny, lacznie z opisem w nawiasie"
    )
    lp: str | None = Field(description="numer z komorki 'Lp. N.' w tym wierszu (np. '1') albo null")
    wartosci: list[str] = Field(
        description="komorki wartosci od lewej do prawej, doslownie; [] dla podnaglowka"
    )


class Wpis(BaseModel):
    lp: str | None = Field(description="numer z wiersza 'Lp. N.' otwierajacego wpis albo null")
    nrPodstawyWpisu: str | None = Field(description="wartosc z prawej kolumny 'Nr podstawy wpisu'")
    rubryki: list[Rubryka]


class Tabela(BaseModel):
    naglowek: str | None = Field(
        description="naglowek tabeli, np. 'Lokal', 'Wlasciciele'; null gdy brak"
    )
    wpisy: list[Wpis]


class DokumentPodstawy(BaseModel):
    nrPodstawyWpisu: str
    dokument: str = Field(
        description="linia z danymi dokumentu (np. tytul aktu, Rep. A, data, notariusz...)"
    )
    dokumentOpisPol: str | None = Field(description="opis pol w nawiasie pod linia dokumentu")
    wniosek: str | None = Field(description="linia 'DZ. KW./...' z danymi wniosku")
    wniosekOpisPol: str | None = Field(description="opis pol w nawiasie pod linia wniosku")


class Dzial(BaseModel):
    kod: Literal["I-O", "I-Sp", "II", "III", "IV"]
    tytul: str
    brakWpisow: bool = Field(description="true gdy dzial oznaczony 'BRAK WPISOW'")
    tabele: list[Tabela]
    dokumenty: list[DokumentPodstawy]


class Naglowek(BaseModel):
    numerKsiegi: str
    stanZDnia: str | None
    sad: str | None
    wydzial: str | None
    rodzajKsiegi: str | None


class PodstawaNabycia(BaseModel):
    tytulAktu: str | None
    repA: str | None
    dataAktu: str | None = Field(description="RRRR-MM-DD")
    notariusz: str | None = Field(description="imie i nazwisko notariusza")
    siedzibaNotariusza: str | None


class PolaDodatkowe(BaseModel):
    numerLokalu: str | None
    kwLokalu: str | None
    kwGruntu: str | None
    udzial: str | None
    powierzchniaUzytkowa: str | None
    podstawaNabycia: PodstawaNabycia | None


class KsiegaTresc(BaseModel):
    naglowek: Naglowek
    dzialy: list[Dzial]
    polaDodatkowe: PolaDodatkowe


# The spike's prompt verbatim, plus production fix no. 1 from its report: the
# "Lp. N. | ---" row opening an entry is not a rubric (both models duplicated it).
PROMPT = """Załączony PDF to wydruk treści księgi wieczystej z przeglądarki eKW (działy I-O, I-Sp, II, III, IV).
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


class TranscriptionFailed(Exception):
    """No usable transcription. Carries the model's `LlmResult` for counters only —
    never partial content (there is none: `parsed is None`)."""

    def __init__(self, result: LlmResult):
        super().__init__(f"brak transkrypcji ({result.stop_reason})")
        self.result = result

    @property
    def code(self) -> str:
        stop_reason = self.result.stop_reason
        if stop_reason == "refusal":
            return "kw_transkrypcja_odmowa"
        # Structured output yields schema-invalid text in practice only when it was
        # cut off, so INVALID_OUTPUT is treated as a truncation — and repeating the
        # same book repeats it, which is why both are non-retryable.
        if stop_reason in ("max_tokens", INVALID_OUTPUT):
            return "kw_transkrypcja_ucieta"
        return "kw_transkrypcja_blad"


def transcribe(llm: LlmClient, pdf_b64: str) -> LlmResult:
    """The model's transcription of the book. Raises `TranscriptionFailed` when
    there is none; the returned result always has `parsed`."""
    result = llm.parse_pdf(
        model=TRANSCRIBE_MODEL,
        pdf_b64=pdf_b64,
        prompt=PROMPT,
        schema=KsiegaTresc,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
    )
    if result.parsed is None:
        raise TranscriptionFailed(result)
    return result
