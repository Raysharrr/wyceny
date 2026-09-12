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
from itertools import product
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
#
# KNOWN LIMIT, deliberate. The worker ships without `obreby-poznan.json` (it is
# a separate deployment; the file lives in web), so "a name we know is an
# obręb" can only mean "a name the FACTS carry". An invented name that is
# neither in the facts nor introduced by the word "obręb" — "Badany obszar
# stanowił Naramowice." — is therefore not detectable here. Closing that needs
# the obręb list inside the worker image or inside the facts payload, which is
# a scope decision, not something this guard can improvise.

_OBREB_KEYWORD_RE = re.compile(r"\bobręb\w*(?:\s+ewidencyjn\w*)?", re.IGNORECASE)
# A proper noun, or a run of them ("Zielona Góra"). NEVER IGNORECASE —
# lowercase words after "w obrębie" are ordinary prose ("w obrębie jednego
# budynku"), and matching them would make every sentence a violation.
_NAME_RUN_RE = re.compile(r"[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*)*")
# Everything the register and ordinary prose put between the keyword and the
# name: a colon, a dash, "nr"/"numer", "o nazwie"/"oznaczony jako", a code.
_OBREB_TAIL_RE = re.compile(
    r"(?:\s*[:–—-])?"
    r"(?:\s+(?:nr|numer|numerze))?"
    r"(?:\s+(?:o\s+nazwie|oznaczony\s+jako))?"
    r"(?:\s+\d{1,4})?"
    r"\s*[:–—-]?\s*"
    r"((?:\s*[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*(?:\s*,|\s+i|\s+oraz)?)+)"
)
# Bullet, list marker at a line start, or a blank line — NOT a sentence:
# "m. Nowogród" breaks on its own full stop and would tear the names away from
# the paragraph that governs them.
_SEGMENT_BOUNDARY_RE = re.compile(r"(?m)•|\n[ \t]*\n|^[ \t]*[-–—*·]\s")


def _inflect(name: str) -> set[str]:
    """Every written form of ONE known obręb (or city) name.

    The direction matters. Stripping an ending off whatever word the TEXT used
    both accepted "Golęcino" for a fact of "Golęcin" (not a form of it) and
    rejected "Dębca" for a fact of "Dębiec" (a correct one, with the fleeting
    -e-). Generating forms of the FACTS instead makes the accepted set closed
    and finite: the names come from the valuation, and Poznań has 24 in total.

    The branches are EXCLUSIVE on purpose. While they were additive, "Dębiec"
    collected both its real forms and the regular-masculine junk ("dębieca",
    "dębiecy") — which the cross-name collision test cannot see, because it
    only compares one name's set against another's.

    # ponytail: suffix paradigms, not a morphological analyser. Pinned by an
    # EQUALITY test on four reference names plus a walk over the whole
    # dictionary; a name needing a deeper stem change would need a rule here.
    """
    words = name.split()
    if len(words) > 1:
        # "Zielona Góra" -> "Zielonej Góry": every part declines.
        per_word = [sorted(_inflect(word)) for word in words]
        return {" ".join(combo) for combo in product(*per_word)}

    low = name.casefold()
    forms = {low}
    if low.endswith("ec"):  # Dębiec -> Dębca (e ruchome)
        stem = low[:-2].removesuffix("i") + "c"
        forms |= {stem + e for e in ("a", "u", "owi", "em")}
    elif low.endswith("ń"):  # Poznań -> Poznania
        stem = low[:-1] + "ni"
        forms |= {stem + e for e in ("a", "u", "owi", "em")}
    elif low.endswith(("na", "wa")):  # Główna — przymiotnikowa
        forms |= {low[:-1] + e for e in ("ej", "ą")}
    elif low.endswith("a"):  # Wilda, Śródka, Starołęka, Ławica, Komandoria
        stem = low[:-1]
        forms |= {stem + ("i" if stem[-1] in "kgi" else "y"), stem + "ę", stem + "ą"}
        soft = {"d": "dzie", "k": "ce", "g": "dze", "t": "cie", "ł": "le"}
        if stem[-1] in soft:
            forms.add(stem[:-1] + soft[stem[-1]])
    elif low.endswith(("ce", "je")):  # Jeżyce, Naramowice, Rataje — liczba mnoga
        stem = low[:-1]
        forms |= {stem, stem + "ach", stem + "ami", stem + "om"}
    elif low.endswith("e"):  # Zegrze — nijaki
        forms |= {low[:-1] + e for e in ("a", "u", "em")}
    elif low.endswith("o"):  # Chartowo, Junikowo, Piątkowo, Umultowo
        forms |= {low[:-1] + e for e in ("a", "u", "em", "ie")}
    elif low.endswith(("y", "i")):  # Krzesiny, Winiary, Podolany, Krzyżowniki
        stem = low[:-1]
        forms |= {stem, stem + "ach", stem + "ami", stem + "om"}
    elif not low.endswith(("ą", "ę", "ó", "u")):  # Golęcin, Łazarz — spółgłoskowy
        forms |= {low + e for e in ("a", "u", "owi", "em", "ie")}
    return forms


def _last_name_in(value) -> str:
    """The trailing proper noun of a fact string: `obreb` arrives as "0007
    Zarzecze" and `rynek` as "wtórny, lokale mieszkalne, Poznań". A run, not a
    word, so "0051 Stare Miasto" stays one name."""
    runs = _NAME_RUN_RE.findall(value) if isinstance(value, str) else []
    return runs[-1] if runs else ""


def _forms_of(names: list[str]) -> set[str]:
    return {form for name in names if name for form in _inflect(name)}


def _study_area_forms(facts: dict) -> set[str]:
    """The study area as the FACTS state it, plus the city IN ITS DECLINED
    FORMS ONLY.

    The city needs both halves of that rule. "w obrębie Poznania" is ordinary
    Polish for "within Poznań" and names no obręb, so a declined form must
    pass. But Poznań is ALSO a real obręb (0051), so the NOMINATIVE after the
    keyword — "obręb Poznań" — is a claim about an obręb and is judged like any
    other. Only `rynek` is read: the address would whitelist a street name
    ("Poznań, ul. Heweliusza 3" made `Heweliusza` a legal obręb), and the city
    already travels in `rynek`.

    Empty `obreby` (the web side's all-or-nothing rule withheld it) leaves only
    the declined city: an area we cannot state is an area the operat must not
    name.
    """
    proba = facts.get("proba")
    raw = proba.get("obreby") or [] if isinstance(proba, dict) else []
    sample = [n for n in raw if isinstance(n, str) and n]
    city = _last_name_in(facts.get("rynek"))
    declined = _inflect(city) - {city.casefold()} if city else set()
    return _forms_of(sample) | declined


def _segment_start(text: str, position: int) -> int:
    """Start of the bullet or paragraph `position` falls in."""
    start = 0
    for boundary in _SEGMENT_BOUNDARY_RE.finditer(text):
        if boundary.end() > position:
            break
        start = boundary.end()
    return start


def _unmatched(words: list[str], allowed: set[str]) -> list[str]:
    """Words of one capitalised run that are NOT an allowed name.

    Longest match first, so a run holding a multi-word name next to a
    single-word one segments correctly. Whatever is left over is reported as
    ONE string per maximal gap — "Stare Miasto" is one invented name, not two.
    """
    out: list[str] = []
    pending: list[str] = []
    i = 0
    while i < len(words):
        hit = 0
        for j in range(len(words), i, -1):
            if " ".join(words[i:j]).casefold() in allowed:
                hit = j - i
                break
        if hit:
            if pending:
                out.append(" ".join(pending))
                pending = []
            i += hit
        else:
            pending.append(words[i])
            i += 1
    if pending:
        out.append(" ".join(pending))
    return out


def validate_obreby(text: str, facts: dict) -> list[str]:
    """Obręb names present in the TEXT but absent from the FACTS (empty = clean).

    Two passes, because the word "obręb" is a useful hint but a useless gate.

    1. Names introduced by the keyword — this is what catches an INVENTED name
       ("obręb ewidencyjny: Naramowice"), which nothing else can recognise.
    2. The SUBJECT's own obręb anywhere else in the text. Its name is known
       from the facts, so word order cannot hide it: "Badany obszar stanowił
       Zarzecze", "obręb oznaczony jako Zarzecze" and "w Zarzeczu" are all the
       same claim, and a keyword-gated guard read none of them.

    The subject's obręb is legal EXACTLY ONCE — at the first keyword mention in
    the opening paragraph, the one place the prompt allows it. Everywhere else
    the sample's `obreby` are the whole permitted set. Scoping it to "the
    opening paragraph" instead let a single-paragraph text carry the study-area
    claim beside the intro and say nothing; scoping it to a phrase ("obszar
    badania") let every synonym through. Position is the only thing with no
    synonym.
    """
    study = _study_area_forms(facts)
    subject = _forms_of([_last_name_in(facts.get("obreb"))])
    subject_only = subject - study

    violations: list[str] = []

    def report(name: str) -> None:
        if name not in violations:
            violations.append(name)

    # Pass 1 — names the keyword introduces.
    intro_end = -1
    opening_end = _first_segment_end(text)
    for keyword in _OBREB_KEYWORD_RE.finditer(text):
        tail = _OBREB_TAIL_RE.match(text, keyword.end())
        if not tail:
            continue
        opening = not text[: _segment_start(text, keyword.start())].strip()
        if opening and intro_end < 0:
            allowed, intro_end = study | subject, tail.end()
        else:
            allowed = study
        for run in _NAME_RUN_RE.findall(tail.group(1)):
            for name in _unmatched(run.split(), allowed):
                report(name)

    # Pass 2 — the subject's obręb outside its one legal mention. With no legal
    # mention at all the whole opening paragraph stays exempt: the intro may
    # name the subject's obręb without the keyword, and flagging that would
    # reject a correct section.
    exempt_until = intro_end if intro_end >= 0 else opening_end
    for run in _NAME_RUN_RE.finditer(text):
        if run.start() < exempt_until:
            continue
        words = run.group(0).split()
        i = 0
        while i < len(words):
            hit = 0
            for j in range(len(words), i, -1):
                if " ".join(words[i:j]).casefold() in subject_only:
                    hit = j - i
                    break
            if hit:
                report(" ".join(words[i : i + hit]))
                i += hit
            else:
                i += 1
    return violations


def _first_segment_end(text: str) -> int:
    boundary = _SEGMENT_BOUNDARY_RE.search(text)
    return boundary.start() if boundary else len(text)


def _dumps(data: dict) -> str:
    return json.dumps(data, indent=1, ensure_ascii=False)


# S5 (Task 4c): jedno zdanie o rodzaju prawa doklejane do ZADANIA. Klucze = wartości
# `PropertyRight` po stronie web (domain/property-right.ts). Pole jedzie OBOK faktów,
# nigdy w nich — odcisk sekcji (prose-hash.ts) liczy się z faktów, a wejście tam
# unieważniłoby każdą potwierdzoną sekcję każdej istniejącej wyceny.
PROPERTY_RIGHT_SENTENCE: dict[str, str] = {
    "wlasnosc_lokalu": (
        "Przedmiotem wyceny jest prawo własności lokalu (nieruchomość lokalowa) — "
        "tak nazywaj przedmiot wyceny."
    ),
    "spoldzielcze_wlasnosciowe": (
        "Przedmiotem wyceny jest spółdzielcze własnościowe prawo do lokalu — tak nazywaj "
        "przedmiot wyceny; NIE pisz o „prawie własności”, „nieruchomości lokalowej” ani "
        "„udziale w gruncie”, bo lokal nie jest odrębną nieruchomością."
    ),
}

# Straż słownictwa własnościowego dla prawa spółdzielczego — ta sama lista co straż
# tekstowa F-12 po stronie web (f12-document-sections.test.ts), sprawdzana na
# wygenerowanym tekście, którego F-12 nie widzi (mierzy render z pustą prozą).
OWNERSHIP_PHRASES: tuple[str, ...] = (
    "prawa własności",
    "prawo własności",
    "nieruchomości lokalowej",
    "udział w gruncie",
)


def validate_property_right(text: str, property_right: str | None) -> list[str]:
    """Phrases the text must not carry for the given right. Only the cooperative
    right has a forbidden vocabulary; ownership and an unknown right pass.
    Each finding is self-describing — it lands in front of the appraiser next
    to the number guard's findings, and „prawa własności” alone reads like a typo."""
    if property_right != "spoldzielcze_wlasnosciowe":
        return []
    lowered = text.lower()
    return [
        f"„{phrase}” (przedmiotem wyceny jest spółdzielcze własnościowe prawo do lokalu)"
        for phrase in OWNERSHIP_PHRASES
        if phrase in lowered
    ]


def build_prompt(section: str, facts: dict, property_right: str | None = None) -> str:
    """Assemble the section prompt: style + task + few-shot examples + facts.

    The layout (separators included) is the one validated in the spike — do not
    reshape it. Unknown section -> ValueError. `property_right` (S5) adds ONE
    sentence to the task; `None` yields the exact pre-S5 prompt.
    """
    if section not in SECTIONS:
        raise ValueError(f"nieznana sekcja: {section!r}")

    style = (PROMPTS_DIR / "_style.md").read_text(encoding="utf-8").strip()
    task, examples = parse_section_file(PROMPTS_DIR / f"{section}.md")
    if property_right is not None:
        task = f"{task}\n{PROPERTY_RIGHT_SENTENCE[property_right]}"

    blocks = [
        f"PRZYKŁAD — DANE:\n{_dumps(data)}\nPRZYKŁAD — TEKST SEKCJI:\n{text}"
        for data, text in examples
    ]
    return (
        f"{style}\n\nZADANIE: {task}\n\n"
        + "\n\n".join(blocks)
        + f"\n\nDANE:\n{_dumps(facts)}\nTEKST SEKCJI:"
    )
