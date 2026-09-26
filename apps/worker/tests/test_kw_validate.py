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


def klasy(
    doc: dict, karta: str = "lokal", zakres: str = "pelna", kw_lokalu: str | None = None
) -> set[tuple[str, str | None]]:
    """The verdict as (class, section). Default = the unit card in full: a test
    that names a land book by its kind measures the header, not the card."""
    walidacja = validate(
        KsiegaTresc.model_validate(doc), karta=karta, zakres=zakres, kw_lokalu=kw_lokalu
    )
    assert walidacja.ok is (walidacja.bledy == [])
    return {(b["klasa"], b.get("dzial")) for b in walidacja.bledy}


def test_the_synthetic_book_is_valid():
    walidacja = validate(KsiegaTresc.model_validate(sample()), karta="lokal", zakres="pelna")
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

    walidacja = validate(tresc, karta="lokal", zakres="pelna")

    assert walidacja.ok is False
    assert len(walidacja.bledy) >= 3
    assert not re.search(r"\d", json.dumps(walidacja.model_dump()))
    assert tresc.model_dump() == before


# --- the land book: rules follow the kind of book (ADR-021, R5) ---------------------


def test_the_synthetic_land_book_is_valid():
    walidacja = validate(KsiegaTresc.model_validate(grunt()), karta="lokal", zakres="pelna")
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
    walidacja = validate(
        KsiegaTresc.model_validate(without(grunt(), "IV", "III")), karta="lokal", zakres="pelna"
    )
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
    walidacja = validate(
        KsiegaTresc.model_validate(without(doc, "II")), karta="lokal", zakres="pelna"
    )
    assert walidacja.ok is False
    assert not re.search(r"\d", json.dumps(walidacja.model_dump()))


# --- the land card: rules by the card, scope, the subject unit's row (ADR-024) --------

# The subject unit = the unit fixture's book; the land fixture lists it in I-O and II.
KW_LOKALU = sample()["naglowek"]["numerKsiegi"]
GRUNTU = {"karta": "grunt", "zakres": "przedmiotowy_lokal"}


def bez_ii(doc: dict) -> dict:
    """Section II present, empty and not marked „BRAK WPISÓW" — what a selective
    transcription gives when the owners' list is all the section has."""
    ii = dzial(doc, "II")
    ii["tabele"], ii["dokumenty"], ii["brakWpisow"] = [], [], False
    return doc


def ii_z_wartosciami(wartosci: list[str]) -> dict:
    """II with one row of the unit owners' list, whose KW number is `wartosci`."""
    doc = grunt()
    dzial(doc, "II")["tabele"] = [
        {
            "naglowek": "Właściciele wyodrębnionych lokali",
            "wpisy": [
                {
                    "lp": "2",
                    "nrPodstawyWpisu": "4",
                    "rubryki": [
                        {
                            "nazwa": "Numer księgi wieczystej lokalu",
                            "lp": None,
                            "wartosci": wartosci,
                        }
                    ],
                }
            ],
        }
    ]
    return doc


def test_the_selective_land_fixture_is_valid_on_the_land_card():
    assert klasy(grunt(), **GRUNTU, kw_lokalu=KW_LOKALU) == set()


def test_land_card_without_kind_gets_land_rules():
    """25.09 (Aneta): the model dropped the kind of a land book and the unit-field
    rules fired on it. On the land card the content IS a land book (ADR-024 pkt 4);
    on the unit card the same content keeps every rule (decision 22.09)."""
    doc = grunt()
    doc["naglowek"]["rodzajKsiegi"] = None
    assert klasy(doc, **GRUNTU, kw_lokalu=KW_LOKALU) == set()
    assert {("pole_niezgodne:kwLokalu", None), ("pole_niezgodne:kwGruntu", None)} <= klasy(doc)


def test_empty_section_ii_is_consistent_only_in_the_reduced_scope():
    doc = bez_ii(grunt())
    assert ("brak_wpisow_niespojny", "II") not in klasy(doc, **GRUNTU)
    assert ("brak_wpisow_niespojny", "II") in klasy(doc, karta="grunt", zakres="pelna")


def test_empty_section_iii_is_inconsistent_even_in_the_reduced_scope():
    """III and IV are transcribed in full — only II's owners' list is left out."""
    doc = grunt()
    dzial(doc, "III")["brakWpisow"] = False
    assert klasy(doc, **GRUNTU) == {("brak_wpisow_niespojny", "III")}


def test_brak_wpisow_with_tables_is_inconsistent_everywhere():
    doc = grunt()
    dzial(doc, "II")["brakWpisow"] = True
    assert ("brak_wpisow_niespojny", "II") in klasy(doc, **GRUNTU, kw_lokalu=KW_LOKALU)


@pytest.mark.parametrize("zapis", ["ciągły", "z odstępami", "małe litery", "rozbity na komórki"])
def test_subject_unit_found_in_section_ii_in_any_spelling(zapis):
    sad, nr, cyfra = KW_LOKALU.split("/")
    wartosci = {
        "ciągły": [KW_LOKALU],
        "z odstępami": [f"{sad} / {nr} / {cyfra}"],
        "małe litery": [KW_LOKALU.lower()],
        "rozbity na komórki": [sad, nr, cyfra],
    }[zapis]
    assert klasy(ii_z_wartosciami(wartosci), **GRUNTU, kw_lokalu=KW_LOKALU) == set()


def test_subject_unit_missing_from_section_ii_is_t5():
    """The row in I-O does not count: T5 reads II only (spec §4.6)."""
    doc = bez_ii(grunt())
    walidacja = validate(KsiegaTresc.model_validate(doc), **GRUNTU, kw_lokalu=KW_LOKALU)
    assert walidacja.ok is False
    assert walidacja.bledy == [{"klasa": "brak_wiersza_lokalu", "dzial": "II"}]


def test_another_units_row_in_section_ii_is_t5():
    doc = ii_z_wartosciami([other_digit(KW_LOKALU)])
    assert klasy(doc, **GRUNTU, kw_lokalu=KW_LOKALU) == {("brak_wiersza_lokalu", "II")}


def test_a_key_in_any_spelling_finds_the_row():
    """The form's value is normalized the same way as the rows."""
    sad, nr, cyfra = KW_LOKALU.split("/")
    klucz = f" {sad.lower()} / {nr} / {cyfra} "
    assert klasy(grunt(), **GRUNTU, kw_lokalu=klucz) == set()


def test_no_t5_without_a_key_or_on_the_unit_card():
    doc = bez_ii(grunt())
    assert ("brak_wiersza_lokalu", "II") not in klasy(doc, **GRUNTU)
    assert ("brak_wiersza_lokalu", "II") not in klasy(doc, **GRUNTU, kw_lokalu="")
    assert ("brak_wiersza_lokalu", "II") not in klasy(doc, kw_lokalu=KW_LOKALU)


def test_missing_section_ii_is_only_incomplete():
    doc = without(grunt(), "II")
    assert klasy(doc, **GRUNTU, kw_lokalu=KW_LOKALU) == {("dzialy_niekompletne", "II")}


def test_t5_carries_no_value():
    walidacja = validate(KsiegaTresc.model_validate(bez_ii(grunt())), **GRUNTU, kw_lokalu=KW_LOKALU)
    assert not re.search(r"\d", json.dumps(walidacja.model_dump()))
