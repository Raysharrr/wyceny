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
    """num2words(1000, lang="pl") == "tysiąc", not "jeden tysiąc" — and the
    same gap shows up mid-string too: num2words(1_001_000) == "milion
    tysiąc" (should be "jeden milion jeden tysiąc"), because BOTH the
    million and the thousand component have an implicit count of one.

    Insert "jeden" before every bare occurrence of a thousand/million/
    billion unit (multiplier of exactly one) — leading or interior — since
    a bare scale word only ever appears in num2words' pl output when its
    own count is exactly 1 (count 2-4 uses the plural nominative form,
    e.g. "tysiące"; count 5+ uses the genitive plural, e.g. "tysięcy";
    neither is a plain match against `_THOUSAND_UNITS`, so this never
    fires on an already-counted unit).
    """
    tokens = words.split(" ")
    fixed: list[str] = []
    for i, token in enumerate(tokens):
        if token in _THOUSAND_UNITS and (i == 0 or tokens[i - 1] != "jeden"):
            fixed.append("jeden")
        fixed.append(token)
    return " ".join(fixed)


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
