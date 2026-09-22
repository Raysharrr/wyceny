"""Deterministic checks of a KW transcription (spike KW report: "Mitygacja" and
"Rekomendacja wdrożeniowa"). The verdict is a standing warning in step 1 and in
the operat preview, never a gate (ADR-021: the paste or upload is the
appraiser's confirmation; web stores the content whatever the verdict).

Rules follow the kind of book (`naglowek.rodzajKsiegi`), and the reduced set is
opt-in: ONLY a book whose kind names the land gets it — the check digit of the
book's OWN number, PESEL, `brakWpisow`, separator rows, Rep. A. Out of it fall
every rule reading a unit field, the check digits of `kwLokalu` and `kwGruntu`
among them: in a land book those two point at nothing (they exist in a unit book
as its pointer at itself and at its land). Every other kind, INCLUDING a missing
one, is judged in full. The unit-field rules (`kwLokalu`, `kwGruntu`,
`numerLokalu`, `udzial`) gave three false positives on a land book in the spike
of 21.09 and a fourth measured E2E on 22.09 — the model wrote the plot area from
I-O into `kwGruntu`, whose check digit then failed — but dropping them on a book
of unknown kind would silently retire the only automatic guard of fidelity on
today's production path — a visible false `ok: false` beats a silent gap. A book
pasted tab by tab may lack sections: each missing one is `dzialy_niekompletne`,
and a rule reading a section that is not there is skipped rather than cascading.

The verdict judges and never corrects. Error classes carry NO values (F-13) —
they end up in logs and in the answer — only a class and, where the rule points
at one section, its code.

Pure — no I/O.
"""

import re

from pydantic import BaseModel

from app.kw_transcribe import Dzial, KsiegaTresc


class Walidacja(BaseModel):
    ok: bool
    # {"klasa": str, "dzial"?: str} — `dzial` absent (not null) when the rule
    # spans sections; the web contract types it as `dzial?: string`.
    bledy: list[dict[str, str]]


# Check digit of a KW number: court code (4 chars) + 8 digits, weights 1, 3, 7
# repeated, sum mod 10. Character values from the Ministry of Justice table
# (Q and V are not used), described at
# http://www.algorytm.org/numery-identyfikacyjne/numer-ksiegi-wieczystej.html
_KW_CHAR_VALUES = {
    **{str(d): d for d in range(10)},
    **dict(zip("XABCDEFGHIJKLMNOPRSTUWYZ", range(10, 34))),
}
_KW_RE = re.compile(r"([A-Z0-9]{4})/(\d{8})/(\d)")

_PESEL_WEIGHTS = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)
_PESEL_RE = re.compile(r"\b\d{11}\b")
_REP_CORE_RE = re.compile(r"\d+/\d+")

DZIALY = ("I-O", "I-Sp", "II", "III", "IV")


def is_land_book(rodzaj: str | None) -> bool:
    """True only when the kind explicitly names the land. eKW writes it three
    ways — „NIERUCHOMOŚĆ GRUNTOWA", „GRUNT ODDANY W UŻYTKOWANIE WIECZYSTE" and
    that one plus a building — so the shared core is „GRUNT", not „GRUNTOW": the
    middle form has no „GRUNTOWA" in it. No unit kind contains „GRUNT", so the
    test never fires the other way. A missing or unknown kind is NOT a land book
    and keeps every rule (user decision 22.09)."""
    return rodzaj is not None and "GRUNT" in rodzaj.upper()


def kw_check_digit_ok(number: str) -> bool:
    match = _KW_RE.fullmatch(re.sub(r"\s+", "", number))
    if not match or any(c not in _KW_CHAR_VALUES for c in match.group(1)):
        return False
    chars = match.group(1) + match.group(2)
    total = sum(_KW_CHAR_VALUES[c] * (1, 3, 7)[i % 3] for i, c in enumerate(chars))
    return total % 10 == int(match.group(3))


def pesel_ok(pesel: str) -> bool:
    total = sum(int(d) * w for d, w in zip(pesel, _PESEL_WEIGHTS))
    return (10 - total % 10) % 10 == int(pesel[10])


def _loose(value: str | None) -> str | None:
    """KW numbers, shares: eKW writes spaces around "/" — they carry no meaning."""
    return None if value is None else re.sub(r"\s+", "", value)


def _collapsed(value: str | None) -> str | None:
    """Unit number ("NN BUD NN"): spaces are meaningful, only their amount is not."""
    return None if value is None else re.sub(r"\s+", " ", value).strip()


def _label(nazwa: str) -> str:
    return re.sub(r"\([^)]*\)", " ", nazwa).strip().lower()


def _section(tresc: KsiegaTresc, kod: str) -> Dzial | None:
    return next((d for d in tresc.dzialy if d.kod == kod), None)


def _rubric_value(tresc: KsiegaTresc, kod: str, label_prefix: str) -> str | None:
    """Value of the first rubric in section `kod` whose label (without the
    parenthesised field description) starts with `label_prefix`."""
    section = _section(tresc, kod)
    if section is None:
        return None
    for tabela in section.tabele:
        for wpis in tabela.wpisy:
            for rubryka in wpis.rubryki:
                if _label(rubryka.nazwa).startswith(label_prefix):
                    return " ".join(rubryka.wartosci)
    return None


def validate(tresc: KsiegaTresc) -> Walidacja:
    bledy: list[dict[str, str]] = []

    def fail(klasa: str, dzial: str | None = None) -> None:
        blad = {"klasa": klasa} if dzial is None else {"klasa": klasa, "dzial": dzial}
        if blad not in bledy:
            bledy.append(blad)

    pola = tresc.polaDodatkowe
    present = {d.kod for d in tresc.dzialy}
    ksiega_gruntu = is_land_book(tresc.naglowek.rodzajKsiegi)

    for kod in DZIALY:
        if kod not in present:
            fail("dzialy_niekompletne", kod)

    numery = [("numerKsiegi", tresc.naglowek.numerKsiegi)]
    if not ksiega_gruntu:
        numery += [("kwLokalu", pola.kwLokalu), ("kwGruntu", pola.kwGruntu)]
    for field, number in numery:
        if number is not None and not kw_check_digit_ok(number):
            fail(f"kw_cyfra_kontrolna:{field}")

    for kod in ("II", "III"):
        section = _section(tresc, kod)
        for tabela in section.tabele if section else []:
            for wpis in tabela.wpisy:
                for rubryka in wpis.rubryki:
                    for value in rubryka.wartosci:
                        if any(not pesel_ok(p) for p in _PESEL_RE.findall(value)):
                            fail("pesel_suma", kod)

    if not ksiega_gruntu:
        if {"I-O", "I-Sp"} <= present:
            kw_gruntu_i_o = _loose(_rubric_value(tresc, "I-O", "przyłączenie"))
            kw_gruntu_i_sp = _loose(_rubric_value(tresc, "I-Sp", "numer księgi wieczystej"))
            if not (_loose(pola.kwGruntu) == kw_gruntu_i_o == kw_gruntu_i_sp):
                fail("pole_niezgodne:kwGruntu")
        if _loose(pola.kwLokalu) != _loose(tresc.naglowek.numerKsiegi):
            fail("pole_niezgodne:kwLokalu")
        if "I-O" in present and _collapsed(pola.numerLokalu) != _collapsed(
            _rubric_value(tresc, "I-O", "numer lokalu")
        ):
            fail("pole_niezgodne:numerLokalu", "I-O")
        if "I-Sp" in present and _loose(pola.udzial) != _loose(
            _rubric_value(tresc, "I-Sp", "wielkość udziału")
        ):
            fail("pole_niezgodne:udzial", "I-Sp")

    rep_a = _loose(pola.podstawaNabycia.repA if pola.podstawaNabycia else None)
    if rep_a is not None and "II" in present:
        # The model spells Rep. A with or without "REP. A NR" — compare the
        # "number/year" core, as a whole number ("497/2018" is not "6497/2018").
        core = _REP_CORE_RE.search(rep_a)
        pattern = re.compile(rf"(?<!\d){re.escape(core.group() if core else rep_a)}(?!\d)")
        section_ii = _section(tresc, "II")
        documents = [_loose(d.dokument) for d in section_ii.dokumenty] if section_ii else []
        if not any(pattern.search(document) for document in documents):
            fail("pole_niezgodne:repA", "II")

    for section in tresc.dzialy:
        if section.brakWpisow != (section.tabele == []):
            fail("brak_wpisow_niespojny", section.kod)
        for tabela in section.tabele:
            for wpis in tabela.wpisy:
                if any([v.strip() for v in r.wartosci] == ["---"] for r in wpis.rubryki):
                    fail("rubryka_separator", section.kod)

    return Walidacja(ok=not bledy, bledy=bledy)
