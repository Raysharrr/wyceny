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
GRUNT_FIXTURE = Path(__file__).parent / "fixtures" / "kw_transcribe_grunt_sample.json"

# What the model put into `kwGruntu` of a land book on 22.09: the plot area from
# I-O. Not a KW number, so not a check digit either.
OBSZAR_DZIALKI = "0,0163 HA"


def sample() -> dict:
    doc = json.loads(FIXTURE.read_text())
    doc.pop("walidacja")
    return doc


def grunt() -> dict:
    """The synthetic land book: a company as owner, no unit fields — the shape
    that tripped the unit-only rules in the spike of 21.09."""
    doc = json.loads(GRUNT_FIXTURE.read_text())
    doc.pop("walidacja")
    return doc


def without(doc: dict, *kody: str) -> dict:
    doc["dzialy"] = [d for d in doc["dzialy"] if d["kod"] not in kody]
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


# --- the land book: rules follow the kind of book (ADR-021, R5) ---------------------


def test_the_synthetic_land_book_is_valid():
    walidacja = validate(KsiegaTresc.model_validate(grunt()))
    assert walidacja.ok is True
    assert walidacja.bledy == []


@pytest.mark.parametrize(
    "rodzaj",
    [
        "NIERUCHOMOŚĆ GRUNTOWA",
        "GRUNT ODDANY W UŻYTKOWANIE WIECZYSTE",
        "GRUNT ODDANY W UŻYTKOWANIE WIECZYSTE I BUDYNEK STANOWIĄCY ODRĘBNĄ NIERUCHOMOŚĆ",
    ],
)
def test_every_form_of_a_land_book_skips_the_unit_field_rules(rodzaj):
    """All three spellings eKW uses for a land book share the core "GRUNT" — the
    one in the middle has no "GRUNTOWA" in it, which is why the discriminator
    cannot key on that longer form."""
    doc = grunt()
    doc["naglowek"]["rodzajKsiegi"] = rodzaj
    assert klasy(doc) == set()


@pytest.mark.parametrize(
    "rodzaj",
    [
        None,
        "LOKAL STANOWIĄCY ODRĘBNĄ NIERUCHOMOŚĆ",
        "SPÓŁDZIELCZE WŁASNOŚCIOWE PRAWO DO LOKALU",
        "NIERUCHOMOŚĆ BUDYNKOWA",
        "BUDYNEK STANOWIĄCY ODRĘBNĄ NIERUCHOMOŚĆ",
    ],
)
def test_anything_that_is_not_a_land_book_keeps_the_unit_rules(rodzaj):
    """Control for the mutation "an unknown kind goes to the reduced set": the land
    fixture labelled as anything but a land book trips the spike's false positives.
    A missing kind is deliberately on this side — silently dropping four field
    rules on a unit book is worse than a false `ok: false` we can see.

    The two building kinds are on this side by the same deliberate choice: nobody
    has measured them yet, so they keep every rule and any mismatch shows up as a
    visible `ok: false` rather than as rules quietly not running. The composite
    kind „GRUNT ODDANY W UŻYTKOWANIE WIECZYSTE I BUDYNEK…" names the land, so it
    goes to the reduced set instead — the two lists do not collide.

    Since ADR-024 the land fixture carries the subject unit's row from the unit
    list in I-O, whose „Numer lokalu" the unit rule reads as the book's own unit
    number — one more false positive on the same side."""
    doc = grunt()
    doc["naglowek"]["rodzajKsiegi"] = rodzaj
    assert klasy(doc) == {
        ("pole_niezgodne:kwGruntu", None),
        ("pole_niezgodne:kwLokalu", None),
        ("pole_niezgodne:numerLokalu", "I-O"),
    }


def test_a_unit_book_without_the_kind_header_still_catches_its_field_mismatches():
    """The kind is the one header the model can drop, and it used to take four
    field rules with it. A unit book with no kind is still judged in full."""
    doc = sample()
    doc["naglowek"]["rodzajKsiegi"] = None
    doc["polaDodatkowe"]["numerLokalu"] += "1"
    doc["polaDodatkowe"]["kwLokalu"] = other_digit(doc["polaDodatkowe"]["kwLokalu"])
    assert klasy(doc) == {
        ("kw_cyfra_kontrolna:kwLokalu", None),
        ("pole_niezgodne:kwLokalu", None),
        ("pole_niezgodne:numerLokalu", "I-O"),
    }


def test_the_unit_book_keeps_all_its_rules():
    """Positive control: the unit fixture is still judged by every rule."""
    doc = sample()
    doc["polaDodatkowe"]["udzial"] += "0"
    doc["polaDodatkowe"]["numerLokalu"] += "1"
    assert klasy(doc) == {
        ("pole_niezgodne:udzial", "I-Sp"),
        ("pole_niezgodne:numerLokalu", "I-O"),
    }


def test_a_land_book_ignores_the_check_digit_of_the_unit_fields():
    """Measured E2E on 22.09, 4/4: a land book pasted onto the land card comes back
    with the plot area from I-O in `kwGruntu`, because in a land book that field
    points at nothing. Its check digit then failed and the verdict on the main
    path of Głuszyna was a false `ok: false`. The book's own number keeps its
    check digit — see `test_land_book_wrong_check_digit` below."""
    doc = grunt()
    doc["polaDodatkowe"]["kwGruntu"] = OBSZAR_DZIALKI
    assert klasy(doc) == set()


@pytest.mark.parametrize("rodzaj", [None, "LOKAL STANOWIĄCY ODRĘBNĄ NIERUCHOMOŚĆ"])
def test_a_unit_book_keeps_the_check_digit_of_the_unit_fields(rodzaj):
    """Control: the same junk in `kwGruntu` of a unit book — kind spelled out or
    missing — is still a check-digit error, on top of the mismatch."""
    doc = sample()
    doc["naglowek"]["rodzajKsiegi"] = rodzaj
    doc["polaDodatkowe"]["kwGruntu"] = OBSZAR_DZIALKI
    assert klasy(doc) == {
        ("kw_cyfra_kontrolna:kwGruntu", None),
        ("pole_niezgodne:kwGruntu", None),
    }


def test_land_book_wrong_check_digit():
    doc = grunt()
    doc["naglowek"]["numerKsiegi"] = other_digit(doc["naglowek"]["numerKsiegi"])
    assert klasy(doc) == {("kw_cyfra_kontrolna:numerKsiegi", None)}


def test_land_book_rep_a_absent_from_section_ii():
    """The selective land book has `polaDodatkowe` all null (ADR-024); the rule is
    still the reduced set's, so the deed is put back by hand — the core of the
    owner's deed in II, one digit off."""
    doc = grunt()
    rep = re.search(r"\d+/\d+", dzial(doc, "II")["dokumenty"][0]["dokument"]).group()
    doc["polaDodatkowe"]["podstawaNabycia"] = {
        **sample()["polaDodatkowe"]["podstawaNabycia"],
        "repA": rep.replace("/", "1/"),
    }
    assert klasy(doc) == {("pole_niezgodne:repA", "II")}
    doc["polaDodatkowe"]["podstawaNabycia"]["repA"] = rep  # control: the deed as written
    assert klasy(doc) == set()


def test_land_book_brak_wpisow_inconsistent():
    doc = grunt()
    dzial(doc, "III")["brakWpisow"] = False
    assert klasy(doc) == {("brak_wpisow_niespojny", "III")}


def test_land_book_separator_row_as_a_rubric():
    doc = grunt()
    wpis = dzial(doc, "IV")["tabele"][0]["wpisy"][0]
    wpis["rubryki"].insert(0, {"nazwa": "Lp. 1.", "lp": "1", "wartosci": ["---"]})
    assert klasy(doc) == {("rubryka_separator", "IV")}


# --- pasted tab by tab: missing sections, one class per code -------------------------


def test_missing_sections_are_reported_one_per_code_in_book_order():
    walidacja = validate(KsiegaTresc.model_validate(without(grunt(), "IV", "III")))
    assert walidacja.ok is False
    assert walidacja.bledy == [
        {"klasa": "dzialy_niekompletne", "dzial": "III"},
        {"klasa": "dzialy_niekompletne", "dzial": "IV"},
    ]


@pytest.mark.parametrize("kod", ["I-O", "I-Sp", "II", "III", "IV"])
def test_a_unit_book_missing_a_section_reports_only_that_section(kod):
    """A field rule that reads a section which is not there is skipped — a paste
    of three tabs must not cascade into "numer lokalu", "udział", "Rep. A".

    III and IV are the two codes whose verdict this class actually flips against
    `main`: no field rule reads them, so before `dzialy_niekompletne` a unit book
    missing one of them came back `ok: true` (review F1)."""
    assert klasy(without(sample(), kod)) == {("dzialy_niekompletne", kod)}


def test_land_book_errors_carry_no_values():
    doc = grunt()
    doc["naglowek"]["numerKsiegi"] = other_digit(doc["naglowek"]["numerKsiegi"])
    walidacja = validate(KsiegaTresc.model_validate(without(doc, "II")))
    assert walidacja.ok is False
    assert not re.search(r"\d", json.dumps(walidacja.model_dump()))
