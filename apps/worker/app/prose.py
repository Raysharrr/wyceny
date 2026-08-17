"""Prose core: prompt assembly from the committed section prompts, a
deterministic price trend, and the number guard. Pure — no I/O beyond reading
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


_DATE_RE = re.compile(r"^(\d{2})-(\d{4})$")


def _chronological_key(transaction: dict) -> tuple[int, int]:
    """Sort key for an 'MM-RRRR' date. Lexicographic sorting of these strings is
    WRONG ('01-2025' < '03-2024'), hence the explicit (year, month) tuple."""
    raw = str(transaction["data"])
    match = _DATE_RE.match(raw.strip())
    if not match:
        raise ValueError(f"data transakcji spoza formatu MM-RRRR: {raw!r}")
    month, year = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12:
        raise ValueError(f"miesiąc spoza zakresu 1-12: {raw!r}")
    return year, month


def price_trend(transakcje: list[dict], *, prog: float = 0.05) -> str:
    """Deterministic price trend over the sample: 'stabilne' | 'wzrostowe' | 'spadkowe'.

    Input: [{'data': 'MM-RRRR', 'cena_m2': float}, ...]. Transactions are sorted
    chronologically and split into halves (with an odd count the middle one goes
    to the SECOND half); the verdict comes from the relative change between the
    half means. Fewer than 2 transactions -> 'stabilne' (no grounds to claim a
    change). The wording in the operat is derived from this value, never from the
    model's own reading of the numbers.
    """
    if len(transakcje) < 2:
        return "stabilne"

    ordered = sorted(transakcje, key=_chronological_key)
    prices = [float(t["cena_m2"]) for t in ordered]
    middle = len(prices) // 2
    first, second = prices[:middle], prices[middle:]

    mean_first = sum(first) / len(first)
    mean_second = sum(second) / len(second)
    if mean_first == 0:
        return "stabilne"

    delta = (mean_second - mean_first) / mean_first
    if abs(delta) < prog:
        return "stabilne"
    return "wzrostowe" if delta >= prog else "spadkowe"


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
        allowed.add(re.split(r"[.,]", number)[0])  # integer part written without decimals
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
        if number in allowed or number.split(",")[0] in allowed:
            continue
        violations.append(match.group(0).strip())
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
