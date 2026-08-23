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
# ewidencyjnego". The facts now name the study area (`proba.obreby`, built from
# the sample the appraiser actually kept), so the text may name no other.

_OBREB_KEYWORD_RE = re.compile(r"\bobręb\w*", re.IGNORECASE)
# A proper noun: initial capital (Polish letters included). NEVER IGNORECASE —
# lowercase words after "w obrębie" are ordinary prose ("w obrębie jednego
# budynku"), and matching them would make every sentence a violation.
_OBREB_NAME_RE = re.compile(r"[A-ZĄĆĘŁŃÓŚŹŻ][\w-]+")
# What may follow the keyword: an optional "nr", an optional 4-digit code, then
# one or more names joined by a comma / "i" / "oraz" ("obrębach Golęcin i
# Sołacz", "obręb nr 0007 Zarzecze"). `\s` spans the newline the prompt's
# few-shot wraps on.
_OBREB_TAIL_RE = re.compile(
    r"(?:\s+[Nn]r)?(?:\s+\d{1,4})?"
    r"((?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]+(?:\s*,|\s+i|\s+oraz)?)+)"
)


def _obreb_stem(name: str) -> str:
    """Casefolded name minus its last two characters (never below four), so a
    declined form still matches: "Golęcina" -> stem "golęc" of "Golęcin".
    Polish declines proper nouns and the guard must not punish grammar.

    # ponytail: prefix on a stem, not a morphological analyser. Poznań's 24
    # obręb names are single words with no colliding prefixes; a real declension
    # engine only earns its place if a name ever needs one.
    """
    low = name.casefold()
    return low[: max(4, len(low) - 2)]


def _allowed_obreby(facts: dict) -> list[str]:
    """Obręb names the text may use: the sample's study area plus the SUBJECT's
    own obręb — the few-shot opens its first paragraph with the latter, so a
    guard that reads only `proba.obreby` would reject every correct generation.
    `obreb` arrives as "0007 Zarzecze"; the code is not a name."""
    proba = facts.get("proba")
    raw = proba.get("obreby") or [] if isinstance(proba, dict) else []
    names = [n for n in raw if isinstance(n, str)]
    subject = facts.get("obreb")
    if isinstance(subject, str):
        names.extend(_OBREB_NAME_RE.findall(subject))
    return [n for n in names if n]


def validate_obreby(text: str, facts: dict) -> list[str]:
    """Obręb names present in the TEXT but absent from the FACTS (empty = clean).

    Only names introduced by the word "obręb" in any of its forms are read —
    the section also names a city and a street, and those are not obręby.
    """
    allowed = _allowed_obreby(facts)
    stems = [(_obreb_stem(name), len(name.casefold())) for name in allowed]

    violations: list[str] = []
    for keyword in _OBREB_KEYWORD_RE.finditer(text):
        tail = _OBREB_TAIL_RE.match(text, keyword.end())
        if not tail:
            continue
        for found in _OBREB_NAME_RE.findall(tail.group(1)):
            low = found.casefold()
            if any(low.startswith(stem) and len(low) <= length + 3 for stem, length in stems):
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
