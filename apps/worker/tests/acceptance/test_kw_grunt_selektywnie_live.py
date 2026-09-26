"""Test akceptacyjny ADR-024 na prawdziwej księdze gruntu — POZA CI (spec §10.4).

Uruchamia (z katalogu apps/worker):
  KW_GRUNT_ACCEPTANCE_DIR=<katalog> KW_GRUNT_KW_LOKALU=<nr KW lokalu> \\
  KW_GRUNT_NR_LOKALU=<nr lokalu> ANTHROPIC_API_KEY=… .venv/bin/pytest tests/acceptance -s
Katalog jak raw/documents/2026-09-25-kw-grunt-cesnikowska/ (wiki-repo, lokalnie):
grunt-1-dzial-I-O.pdf … grunt-5-dzial-IV.pdf, grunt-3-dzial-II.txt, grunt-wklej-calosc.txt.
Trzy przebiegi po jednym wywołaniu modelu (~2–3 min każdy): PDF + oba klucze, PDF + sam
numer KW (M3, niezmierzony w spike'u), wklejenie + oba klucze. Żaden numer KW nie stoi
w tym pliku (F-9) — przychodzą ze zmiennych i z pliku tekstowego w katalogu; wypisujemy
liczniki i werdykty, nigdy treść księgi.
"""

import base64
import json
import os
import re
import time
from pathlib import Path

import pytest

from app import kw_transcribe
from app.kw_validate import validate
from app.llm import AnthropicAdapter

DIR = os.environ.get("KW_GRUNT_ACCEPTANCE_DIR")
KW = os.environ.get("KW_GRUNT_KW_LOKALU")
NR = os.environ.get("KW_GRUNT_NR_LOKALU")
pytestmark = pytest.mark.skipif(
    not (DIR and KW and NR and os.environ.get("ANTHROPIC_API_KEY")),
    reason="test akceptacyjny na prawdziwej księdze — tylko ręcznie",
)

PLIKI = [
    "grunt-1-dzial-I-O",
    "grunt-2-dzial-I-Sp",
    "grunt-3-dzial-II",
    "grunt-4-dzial-III",
    "grunt-5-dzial-IV",
]
# Wiersz listy właścicieli lokali w tekście działu II z przeglądarki eKW
# (spike 2026-09-25 `_II`): numer księgi lokalu w trzech częściach.
_II = re.compile(r"Wyodrębniony lokal Numer księgi (\w{4}) / (\d{8}) / (\d)")


def _norm(value: str) -> str:
    return re.sub(r"[\s/]", "", value).upper()


def _lokale() -> set[str]:
    """Numery KW wszystkich lokali budynku — wyrocznia obcych wierszy."""
    tekst = (Path(DIR) / "grunt-3-dzial-II.txt").read_text()
    return {f"{a}{b}{c}" for a, b, c in _II.findall(tekst)}


def _dzial(tresc, kod: str):
    return next((d for d in tresc.dzialy if d.kod == kod), None)


def _rubryki(tresc, kod: str) -> str:
    """Tylko tabele: numery innych lokali stoją też w opisach dokumentów podstaw
    wpisu (np. wypis z kartoteki lokali) — to nie są wiersze list lokali."""
    dz = _dzial(tresc, kod)
    return _norm(json.dumps([t.model_dump() for t in dz.tabele], ensure_ascii=False)) if dz else ""


@pytest.mark.parametrize("wariant", ["pdf_oba_klucze", "pdf_sam_numer_kw", "wklej_oba_klucze"])
def test_land_book_selective_on_the_real_book(wariant):
    wklej = wariant.startswith("wklej")
    pdfy = (
        []
        if wklej
        else [base64.b64encode((Path(DIR) / f"{p}.pdf").read_bytes()).decode() for p in PLIKI]
    )
    tekst = (Path(DIR) / "grunt-wklej-calosc.txt").read_text() if wklej else None
    klucze = kw_transcribe.KluczeLokalu(KW, None if wariant == "pdf_sam_numer_kw" else NR)
    lokale = _lokale()
    cel, obce = _norm(KW), lokale - {_norm(KW)}
    assert len(lokale) == 65 and cel in lokale  # wyrocznia trafia w księgę Anety

    t0 = time.monotonic()
    result = kw_transcribe.transcribe(AnthropicAdapter(), pdfy, tekst, karta="grunt", klucze=klucze)
    sekundy = round(time.monotonic() - t0)
    tresc = result.parsed
    zakres = kw_transcribe.ZAKRES["grunt"]
    walidacja = validate(tresc, karta="grunt", zakres=zakres, kw_lokalu=KW)
    iii, iv = _dzial(tresc, "III"), _dzial(tresc, "IV")
    wynik = {
        "wariant": wariant,
        "sekundy": sekundy,
        "stop_reason": result.stop_reason,
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
        "zakres": zakres,
        "dzialy": [d.kod for d in tresc.dzialy],
        "cel_w_I-O": cel in _rubryki(tresc, "I-O"),
        "cel_w_II": cel in _rubryki(tresc, "II"),
        "obce_w_I-O": sum(k in _rubryki(tresc, "I-O") for k in obce),
        "obce_w_II": sum(k in _rubryki(tresc, "II") for k in obce),
        "III_wpisy": sum(len(t.wpisy) for t in iii.tabele) if iii else None,
        "IV_brak_wpisow": iv.brakWpisow if iv else None,
        "polaDodatkowe_null": all(v is None for v in tresc.polaDodatkowe.model_dump().values()),
        "walidacja": walidacja.bledy,
    }
    print(json.dumps(wynik, ensure_ascii=False))  # noqa: T201 — wynik ręcznego przebiegu, bez treści
    assert result.stop_reason == "end_turn"
    assert wynik["cel_w_I-O"] and wynik["cel_w_II"]
    assert wynik["obce_w_I-O"] == wynik["obce_w_II"] == 0
    assert wynik["III_wpisy"] == 3 and wynik["IV_brak_wpisow"] is True
    assert wynik["walidacja"] == []
