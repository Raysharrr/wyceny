"""Deterministic checks of a KW transcription (operat-bugfix KW.3). Positive case =
the synthetic book (fictional, valid check digits); every negative case is a copy
of it with one thing broken. Values are mutated at runtime — never literals."""

import copy
import json
import re
from pathlib import Path

import pytest

from app.kw_transcribe import KsiegaTresc
from app.kw_validate import kw_check_digit_ok, pesel_ok, validate

FIXTURE = Path(__file__).parent / "fixtures" / "kw_transcribe_sample.json"


def sample() -> dict:
    doc = json.loads(FIXTURE.read_text())
    doc.pop("walidacja")
    return doc


def dzial(doc: dict, kod: str) -> dict:
    return next(d for d in doc["dzialy"] if d["kod"] == kod)


def rubryka(doc: dict, kod: str, prefix: str) -> dict:
    return next(
        r
        for t in dzial(doc, kod)["tabele"]
        for w in t["wpisy"]
        for r in w["rubryki"]
        if r["nazwa"].startswith(prefix)
    )


def other_digit(number: str) -> str:
    """Same KW number with a different check digit."""
    return number[:-1] + str((int(number[-1]) + 1) % 10)


def klasy(doc: dict) -> set[tuple[str, str | None]]:
    walidacja = validate(KsiegaTresc.model_validate(doc))
    assert walidacja.ok is (walidacja.bledy == [])
    return {(b["klasa"], b.get("dzial")) for b in walidacja.bledy}


def test_the_synthetic_book_is_valid():
    walidacja = validate(KsiegaTresc.model_validate(sample()))
    assert walidacja.ok is True
    assert walidacja.bledy == []


# --- KW check digit ------------------------------------------------------------------


def test_kw_check_digit_accepts_the_synthetic_numbers_and_rejects_a_changed_digit():
    doc = sample()
    for number in (doc["naglowek"]["numerKsiegi"], doc["polaDodatkowe"]["kwGruntu"]):
        assert kw_check_digit_ok(number)
        assert not kw_check_digit_ok(other_digit(number))
        # two neighbouring digits of the 8-digit part swapped (weights 7 and 1)
        swapped = number[:9] + number[10] + number[9] + number[11:]
        assert swapped != number
        assert not kw_check_digit_ok(swapped)


def test_kw_check_digit_rejects_malformed_numbers():
    # Built from the fixture at runtime: a well-formed literal would trip check-no-pii.sh.
    number = sample()["naglowek"]["numerKsiegi"]
    court, digits, check = number.split("/")
    for malformed in (
        "",
        f"{court}/{digits[1:]}/{check}",  # 7 digits
        number.replace("/", "-"),
        f"{court[0]}Q{court[2:]}/{digits}/{check}",  # Q is not in the character table
    ):
        assert not kw_check_digit_ok(malformed)


def test_wrong_check_digit_of_the_book_number():
    doc = sample()
    doc["naglowek"]["numerKsiegi"] = other_digit(doc["naglowek"]["numerKsiegi"])
    assert ("kw_cyfra_kontrolna:numerKsiegi", None) in klasy(doc)


def test_wrong_check_digit_of_kw_lokalu_and_kw_gruntu():
    doc = sample()
    pola = doc["polaDodatkowe"]
    pola["kwLokalu"] = other_digit(pola["kwLokalu"])
    pola["kwGruntu"] = other_digit(pola["kwGruntu"])
    found = klasy(doc)
    assert ("kw_cyfra_kontrolna:kwLokalu", None) in found
    assert ("kw_cyfra_kontrolna:kwGruntu", None) in found


# --- PESEL ---------------------------------------------------------------------------


def pesele(doc: dict, kod: str) -> list[str]:
    values = [
        v
        for t in dzial(doc, kod)["tabele"]
        for w in t["wpisy"]
        for r in w["rubryki"]
        for v in r["wartosci"]
    ]
    return [p for v in values for p in re.findall(r"\b\d{11}\b", v)]


def test_pesel_checksum_of_the_synthetic_persons():
    doc = sample()
    found = pesele(doc, "II") + pesele(doc, "III")
    assert len(found) == 3
    for pesel in found:
        assert pesel_ok(pesel)
        assert not pesel_ok(pesel[:-1] + str((int(pesel[-1]) + 1) % 10))


@pytest.mark.parametrize("kod", ["II", "III"])
def test_wrong_pesel_in_a_persons_section(kod):
    doc = sample()
    osoba = rubryka(doc, kod, "Osoba fizyczna")
    pesel = pesele(doc, kod)[0]
    broken = pesel[:-1] + str((int(pesel[-1]) + 1) % 10)
    osoba["wartosci"] = [v.replace(pesel, broken) for v in osoba["wartosci"]]
    assert klasy(doc) == {("pesel_suma", kod)}


# --- polaDodatkowe agree with the content --------------------------------------------


def test_kw_gruntu_differs_between_i_o_and_i_sp():
    doc = sample()
    r = rubryka(doc, "I-Sp", "Numer księgi wieczystej")
    r["wartosci"] = [doc["naglowek"]["numerKsiegi"]]  # valid number, just the wrong one
    assert klasy(doc) == {("pole_niezgodne:kwGruntu", None)}


def test_kw_gruntu_field_differs_from_the_content():
    doc = sample()
    doc["polaDodatkowe"]["kwGruntu"] = doc["naglowek"]["numerKsiegi"]
    assert klasy(doc) == {("pole_niezgodne:kwGruntu", None)}


def test_kw_lokalu_differs_from_the_book_number():
    doc = sample()
    doc["polaDodatkowe"]["kwLokalu"] = doc["polaDodatkowe"]["kwGruntu"]
    assert klasy(doc) == {("pole_niezgodne:kwLokalu", None)}


def test_numer_lokalu_differs_from_i_o():
    doc = sample()
    doc["polaDodatkowe"]["numerLokalu"] += "1"
    assert klasy(doc) == {("pole_niezgodne:numerLokalu", "I-O")}


def test_rep_a_absent_from_the_documents_of_section_ii():
    doc = sample()
    pn = doc["polaDodatkowe"]["podstawaNabycia"]
    pn["repA"] = pn["repA"].replace("/", "1/")
    assert klasy(doc) == {("pole_niezgodne:repA", "II")}


def test_rep_a_is_found_inside_the_document_line():
    """„REP. A NR 6497/2018” in the document vs `repA` „6497/2018” — containment."""
    doc = sample()
    pn = doc["polaDodatkowe"]["podstawaNabycia"]
    assert pn["repA"] not in [d["dokument"] for d in dzial(doc, "II")["dokumenty"]]
    assert klasy(doc) == set()


@pytest.mark.parametrize("prefix", ["REP. A NR ", "REP. A ", "A NR ", "A "])
def test_rep_a_written_with_a_prefix_is_still_found(prefix):
    """The model returns Rep. A in several acceptable spellings (the synthetic book's
    ground truth lists them as alternatives) — none may fail a correct reading."""
    doc = sample()
    pn = doc["polaDodatkowe"]["podstawaNabycia"]
    pn["repA"] = prefix + pn["repA"]
    assert klasy(doc) == set()


def test_rep_a_matches_the_whole_number_not_its_tail():
    doc = sample()
    pn = doc["polaDodatkowe"]["podstawaNabycia"]
    pn["repA"] = pn["repA"][1:]  # "497/2018" sits inside "6497/2018" but is another deed
    assert klasy(doc) == {("pole_niezgodne:repA", "II")}


def test_udzial_differs_from_i_sp():
    doc = sample()
    doc["polaDodatkowe"]["udzial"] += "0"
    assert klasy(doc) == {("pole_niezgodne:udzial", "I-Sp")}


def test_udzial_ignores_spacing_around_the_slash():
    doc = sample()
    doc["polaDodatkowe"]["udzial"] = doc["polaDodatkowe"]["udzial"].replace(" ", "")
    assert klasy(doc) == set()


# --- structure -----------------------------------------------------------------------


def test_separator_row_as_a_rubric():
    doc = sample()
    wpis = dzial(doc, "IV")["tabele"][0]["wpisy"][0]
    wpis["rubryki"].insert(0, {"nazwa": "Lp. 1.", "lp": "1", "wartosci": ["---"]})
    assert klasy(doc) == {("rubryka_separator", "IV")}


def test_brak_wpisow_with_tables():
    doc = sample()
    dzial(doc, "III")["brakWpisow"] = True
    assert klasy(doc) == {("brak_wpisow_niespojny", "III")}


def test_entries_missing_without_brak_wpisow():
    doc = sample()
    iii = dzial(doc, "III")
    iii["tabele"], iii["dokumenty"] = [], []
    assert klasy(doc) == {("brak_wpisow_niespojny", "III")}


def test_empty_section_marked_brak_wpisow_is_valid():
    doc = sample()
    iii = dzial(doc, "III")
    iii["brakWpisow"], iii["tabele"], iii["dokumenty"] = True, [], []
    assert klasy(doc) == set()


# --- the verdict judges, never corrects, never repeats a value ------------------------


def test_errors_carry_no_values_and_the_content_is_untouched():
    doc = sample()
    doc["naglowek"]["numerKsiegi"] = other_digit(doc["naglowek"]["numerKsiegi"])
    doc["polaDodatkowe"]["numerLokalu"] += "1"
    osoba = rubryka(doc, "II", "Osoba fizyczna")
    pesel = pesele(doc, "II")[0]
    osoba["wartosci"] = [v.replace(pesel, pesel[::-1]) for v in osoba["wartosci"]]
    tresc = KsiegaTresc.model_validate(doc)
    before = copy.deepcopy(tresc.model_dump())

    walidacja = validate(tresc)

    assert walidacja.ok is False
    assert len(walidacja.bledy) >= 3
    assert not re.search(r"\d", json.dumps(walidacja.model_dump()))
    assert tresc.model_dump() == before
