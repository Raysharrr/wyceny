"""Prose core: prompt assembly from the committed section prompts and the
number guard. Pure — no I/O beyond reading
the prompt files, no `anthropic` import (the API call lives in main.py behind
an injectable seam, same shape as kw.py).

F-11: nothing here accepts or returns a market value (WR) or the unit value of
the result — `pozycja_wyniku`, when present in the facts, is a categorical
string computed on the web side.
"""

import json
import re
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent / "prompts" / "prose"

SECTIONS: tuple[str, ...] = (
    "analiza_rynku",
    "opis_lokalu",
    "otoczenie",
    "zagospodarowanie",
    "standard",
    "uzasadnienie",
)

_EXAMPLE_SPLIT_RE = re.compile(r"^## PRZYKŁAD\s*$", re.MULTILINE)
_TASK_RE = re.compile(r"^## ZADANIE\s*$", re.MULTILINE)
_DATA_FENCE_RE = re.compile(r"### DANE\s*```json\s*(.*?)```", re.DOTALL)
_TEXT_RE = re.compile(r"### TEKST\s*(.*)", re.DOTALL)


def parse_section_file(path: Path) -> tuple[str, list[tuple[dict, str]]]:
    """Parse one section prompt into (task, [(example_data, example_text), ...]).

    File contract: `## ZADANIE` followed by one or more `## PRZYKŁAD` blocks,
    each holding a fenced ```json DANE block and a `### TEKST` body. Raises
    ValueError when the task is missing/empty or there is not a single example.
    """
    raw = path.read_text(encoding="utf-8")
    chunks = _EXAMPLE_SPLIT_RE.split(raw)
    head, example_chunks = chunks[0], chunks[1:]

    if not _TASK_RE.search(head):
        raise ValueError(f"{path.name}: brak sekcji '## ZADANIE'")
    task = _TASK_RE.sub("", head, count=1).strip()
    if not task:
        raise ValueError(f"{path.name}: puste '## ZADANIE'")

    examples: list[tuple[dict, str]] = []
    for chunk in example_chunks:
        data_match = _DATA_FENCE_RE.search(chunk)
        text_match = _TEXT_RE.search(chunk)
        if not data_match or not text_match:
            raise ValueError(f"{path.name}: przykład bez bloku DANE albo TEKST")
        data = json.loads(data_match.group(1))
        text = text_match.group(1).strip()
        if not isinstance(data, dict) or not text:
            raise ValueError(f"{path.name}: przykład z pustym DANE albo TEKST")
        examples.append((data, text))

    if not examples:
        raise ValueError(f"{path.name}: zero przykładów few-shot")
    return task, examples


_NUM_RE = re.compile(r"\d[\d\s]*(?:,\d+)?")
_BROKEN_DECIMAL_RE = re.compile(r"(\d[\d\s]*),[ \t]*\r?\n[ \t]*(\d+)")
_UNIT_IDIOM_RE = re.compile(r"\b1\s*m2\b|\b1\s*m²\b")
_UNIT_RE = re.compile(r"m2\b|m²")


def _norm_num(value: str) -> str:
    return re.sub(r"\s", "", value)


def _allowed_numbers(facts: dict) -> set[str]:
    """Every number the model is allowed to write: all numeric literals found
    anywhere in the facts (nested dicts and lists included)."""
    raw: list[str] = []

    def walk(value) -> None:
        if isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, bool):
            return
        elif isinstance(value, (int, float)):
            raw.append(str(value))
        elif isinstance(value, str):
            raw.extend(_NUM_RE.findall(value))

    walk(facts)

    allowed: set[str] = set()
    for number in raw:
        number = _norm_num(number)
        allowed.add(number)
        allowed.add(number.replace(".", ","))  # float 10815.5 -> PL notation "10815,5"
    # NOTE: the spike also split dashed tokens into components. Dropped in
    # review: _NUM_RE never yields a dash from a string fact ("03-2024" is
    # already two tokens), so the loop only ever fired on float reprs — it
    # turned a fact of 1e-05 into permission to write "05" anywhere in the
    # operat. A guard against invented numbers must not widen itself.
    return allowed


def validate_numbers(text: str, facts: dict) -> list[str]:
    """Numbers present in the TEXT but absent from the FACTS (empty list = clean).

    Ported from the spike's K1 evaluator, traps included: the digit inside the
    "m2"/"m²" unit is not a fact, and "za 1 m2" is the single idiom allowed to
    carry a number of its own (style rule 4).

    A number must appear in the facts EXACTLY as written. The ported evaluator
    also accepted a number whose INTEGER PART was a fact — which let an invented
    decimal through: with an area of "71,63" the guard passed "71,99 m2", a
    different flat stated as fact in a document with legal effects. The mirror
    tolerance (fact "71,63" licensing the text "71") is gone for the same
    reason: a rounded area is not the area. Re-evaluating the 18 recorded
    validation generations under the strict rule produced ZERO violations, so
    neither tolerance was ever carrying real output — only risk.
    """
    allowed = _allowed_numbers(facts)

    # A decimal split by a line break ("12 061,\n94") is one number, not two.
    # Rejoin it ONLY when the joined form is itself an allowed fact: joining
    # unconditionally would let the model smuggle a number past the guard by
    # breaking the line ("z lat 2024,\n2019" would collapse into the allowed
    # "2024,2019" and the integer-part fallback would wave it through). When
    # the join is not a fact, the break is left in place and both halves are
    # scanned separately — which is exactly what catches the invented one.
    def _join_if_factual(match: re.Match[str]) -> str:
        head, tail = match.group(1), match.group(2)
        candidate = f"{_norm_num(head)},{tail}"
        return f"{head},{tail}" if candidate in allowed else match.group(0)

    joined = _BROKEN_DECIMAL_RE.sub(_join_if_factual, text)
    stripped = _UNIT_IDIOM_RE.sub(" ", joined)
    stripped = _UNIT_RE.sub(" ", stripped)

    violations: list[str] = []
    for match in _NUM_RE.finditer(stripped):
        number = _norm_num(match.group(0).strip())
        if not number:
            continue
        if number in allowed:
            continue
        violations.append(match.group(0).strip())
    return violations


# --- Obręb guard (Slice 5) -------------------------------------------------
#
# `validate_numbers` is blind to an invented obręb: a name carries no digit.
# Aneta on a generated section: "analizę opisał nam nie z tego obrębu
# ewidencyjnego". The facts name the study area (`proba.obreby`, built from the
# sample the appraiser actually kept), so the text may name no other.

# The keyword and the optional adjective the register uses ("w obrębie
# EWIDENCYJNYM Naramowice"). The adjective belongs to the keyword, not to the
# name — read as a name it would make the guard skip the real one.
_OBREB_KEYWORD_RE = re.compile(r"\bobręb\w*(?:\s+ewidencyjn\w*)?", re.IGNORECASE)
# A proper noun: initial capital (Polish letters included). NEVER IGNORECASE —
# lowercase words after "w obrębie" are ordinary prose ("w obrębie jednego
# budynku"), and matching them would make every sentence a violation.
_OBREB_NAME_RE = re.compile(r"[A-ZĄĆĘŁŃÓŚŹŻ][\w-]+")
# Everything the register and ordinary prose put between the keyword and the
# name: a colon, "nr"/"numer", "o nazwie", a code. Each optional and
# independent, so "obręb ewidencyjny: X", "obręb nr 0007 X" and "obręb
# ewidencyjny o nazwie X" all land on the same capture.
_OBREB_TAIL_RE = re.compile(
    r"(?:\s*:)?"
    r"(?:\s+(?:nr|numer|numerze))?"
    r"(?:\s+o\s+nazwie)?"
    r"(?:\s+\d{1,4})?"
    r"((?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]+(?:\s*,|\s+i|\s+oraz)?)+)"
)
# Bullet or blank line — NOT a sentence: "m. Nowogród" breaks on its own full
# stop and would tear the names away from the paragraph that governs them.
_SEGMENT_BOUNDARY_RE = re.compile(r"•|\n[ \t]*\n")


def _inflect(name: str) -> set[str]:
    """Every written form of ONE known obręb name.

    The direction matters. Round 2 stripped an ending off whatever word the
    text used and compared stems — which BOTH accepted "Golęcino" for a fact of
    "Golęcin" (not a form of it) and rejected "Dębca" for a fact of "Dębiec"
    (a correct one, with the fleeting -e-). Generating forms of the FACTS
    instead makes the accepted set closed and finite: the names come from the
    valuation, and Poznań has 24 of them in total.

    # ponytail: suffix paradigms, not a morphological analyser. The rules below
    # cover every name in `obreby-poznan.json` (pinned by a test that walks the
    # whole file); a name needing a deeper stem change would need a rule here.
    """
    low = name.casefold()
    forms = {low}

    if low.endswith("ec"):  # Dębiec -> Dębca (e ruchome)
        stem = low[:-2].removesuffix("i") + "c"
        forms |= {stem + e for e in ("a", "u", "owi", "em", "e")}
    if low.endswith("ń"):  # Poznań -> Poznania
        stem = low[:-1] + "ni"
        forms |= {stem, *(stem + e for e in ("a", "u", "owi", "em"))}

    if low.endswith("a"):  # Wilda, Główna, Starołęka, Ławica, Komandoria
        stem = low[:-1]
        forms |= {stem + e for e in ("y", "i", "ę", "ą", "o", "ej", "e")}
        # Locative/dative palatalisation: Wilda -> Wildzie, Śródka -> Śródce.
        soft = {"d": "dzie", "k": "ce", "g": "dze", "c": "cy", "t": "cie", "ł": "le"}
        if stem and stem[-1] in soft:
            forms.add(stem[:-1] + soft[stem[-1]])
    elif low.endswith("o"):  # Chartowo, Junikowo, Piątkowo, Umultowo
        forms |= {low[:-1] + e for e in ("a", "u", "em", "ie")}
    elif low.endswith("e"):  # Zegrze; plural Jeżyce, Naramowice, Rataje
        forms |= {low[:-1] + e for e in ("", "a", "u", "em", "ach", "ami", "om")}
    elif low.endswith(("y", "i")):  # plural Krzesiny, Winiary, Krzyżowniki
        forms |= {low[:-1] + e for e in ("", "ach", "ami", "om")}
    elif not low.endswith(("ą", "ę", "ó", "u")):  # consonant-final masculine
        forms |= {low + e for e in ("a", "u", "owi", "em", "ie", "y")}
    return forms


def _names_in(value) -> list[str]:
    """Proper nouns inside a fact string. `obreb` arrives as "0007 Zarzecze"
    and `rynek` as "wtórny, lokale mieszkalne, Poznań"; the code is not a
    name, and neither are the lowercase words."""
    return _OBREB_NAME_RE.findall(value) if isinstance(value, str) else []


def _forms_of(names: list[str]) -> set[str]:
    return {form for name in names for form in _inflect(name)}


def _study_area_forms(facts: dict) -> set[str]:
    """The study area as the FACTS state it — plus the city, because "w obrębie
    Poznania" is ordinary Polish for "within Poznań" and names no obręb at all.

    Empty `obreby` (the web side's all-or-nothing rule withheld it) leaves only
    the city: an area we cannot state is an area the operat must not name.
    """
    proba = facts.get("proba")
    raw = proba.get("obreby") or [] if isinstance(proba, dict) else []
    sample = [n for n in raw if isinstance(n, str) and n]
    city = _names_in(facts.get("rynek"))[-1:] + _names_in(facts.get("adres"))[-1:]
    return _forms_of(sample + city)


def _segment_start(text: str, position: int) -> int:
    """Start of the bullet or paragraph `position` falls in."""
    start = 0
    for boundary in _SEGMENT_BOUNDARY_RE.finditer(text):
        if boundary.end() > position:
            break
        start = boundary.end()
    return start


def validate_obreby(text: str, facts: dict) -> list[str]:
    """Obręb names present in the TEXT but absent from the FACTS (empty = clean).

    Only names introduced by the word "obręb" in any of its forms are read —
    the section also names a city and a street, and those are not obręby.

    The default is INVERTED on purpose: the subject's own `obreb` is legal ONLY
    in the opening paragraph, which is the one place the prompt allows it.
    Everywhere else the sample's `obreby` are the whole permitted set. Round 2
    instead looked for the phrase "obszar badania" near the name, so every
    rewording of it — "badany obszar", "teren badania", or a plain sentence —
    walked straight past the guard. There is no synonym of "not the opening
    paragraph".
    """
    study = _study_area_forms(facts)
    intro = study | _forms_of(_names_in(facts.get("obreb")))

    violations: list[str] = []
    for keyword in _OBREB_KEYWORD_RE.finditer(text):
        tail = _OBREB_TAIL_RE.match(text, keyword.end())
        if not tail:
            continue
        start = _segment_start(text, keyword.start())
        allowed = intro if not text[:start].strip() else study
        for found in _OBREB_NAME_RE.findall(tail.group(1)):
            if found.casefold() in allowed:
                continue
            if found not in violations:
                violations.append(found)
    return violations


def _dumps(data: dict) -> str:
    return json.dumps(data, indent=1, ensure_ascii=False)


def build_prompt(section: str, facts: dict) -> str:
    """Assemble the section prompt: style + task + few-shot examples + facts.

    The layout (separators included) is the one validated in the spike — do not
    reshape it. Unknown section -> ValueError.
    """
    if section not in SECTIONS:
        raise ValueError(f"nieznana sekcja: {section!r}")

    style = (PROMPTS_DIR / "_style.md").read_text(encoding="utf-8").strip()
    task, examples = parse_section_file(PROMPTS_DIR / f"{section}.md")

    blocks = [
        f"PRZYKŁAD — DANE:\n{_dumps(data)}\nPRZYKŁAD — TEKST SEKCJI:\n{text}"
        for data, text in examples
    ]
    return (
        f"{style}\n\nZADANIE: {task}\n\n"
        + "\n\n".join(blocks)
        + f"\n\nDANE:\n{_dumps(facts)}\nTEKST SEKCJI:"
    )
