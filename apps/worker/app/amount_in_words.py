"""Polish "kwota słownie" (amount in words) formatting.

Open Host Service adapter (ADR-009). Formats a monetary amount (PLN) as
Polish words ("złote" + "grosze"). Fitness function F-11: this module
NEVER returns the numeric value — words only.

Grammatical agreement logic (złoty/złote/złotych, grosz/grosze/groszy)
and the num2words "missing leading jeden" fix (e.g. "milion" instead of
"jeden milion") are adapted from the empirically-verified spike:
wyceny wiki repo, tools/spike/2026-06-05-dokument-path/slownie.py
"""

from num2words import num2words

_THOUSAND_UNITS = ("miliard", "milion", "tysiąc")


def _fix_missing_leading_jeden(words: str) -> str:
    """num2words(1000, lang="pl") == "tysiąc", not "jeden tysiąc".

    Prepend "jeden" when the cardinal words start with a bare thousand/
    million/billion unit (multiplier of exactly one).
    """
    for unit in _THOUSAND_UNITS:
        if words == unit or words.startswith(unit + " "):
            return "jeden " + words
    return words


def _zloty_form(n: int) -> str:
    if n % 100 in (11, 12, 13, 14):
        return "złotych"
    if n % 10 == 1:
        return "złoty"
    if n % 10 in (2, 3, 4):
        return "złote"
    return "złotych"


def _grosz_form(n: int) -> str:
    if n % 100 in (11, 12, 13, 14):
        return "groszy"
    if n % 10 == 1:
        return "grosz"
    if n % 10 in (2, 3, 4):
        return "grosze"
    return "groszy"


def to_amount_in_words(amount: float) -> str:
    """Format a PLN amount as Polish words: "<złote words> złotych <grosze words> groszy".

    F-11: returns words only — the caller must never surface the raw
    numeric amount alongside this string.
    """
    total_grosze = int(round(float(amount) * 100))
    zlote, grosze = divmod(total_grosze, 100)

    zlote_words = _fix_missing_leading_jeden(num2words(zlote, lang="pl"))
    grosze_words = num2words(grosze, lang="pl")

    return f"{zlote_words} {_zloty_form(zlote)} {grosze_words} {_grosz_form(grosze)}"
