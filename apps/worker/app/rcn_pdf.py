"""„WYDRUK Z RCN" (GEO-INFO i.Rzeczoznawca, Crystal Reports) -> flat transaction rows (T-22).

The printout positions every cell absolutely, so text order is useless; columns
sit at fixed x0 and the parser reads geometry. `parse` is pure — it works on
`Word`s, so its tests need no PDF. `words_from_pdf` is the only PDFium code and
runs under the process-wide lock.

Pure — no FastAPI import (endpoint lives in main.py).
"""

import re
from dataclasses import dataclass, field

import pypdfium2 as pdfium

from app.pdfium_lock import PDFIUM_LOCK

MAX_PDF_BYTES = 4 * 1024 * 1024  # the Server Action path; Vercel refuses bodies over 4.5 MB
MAX_PAGES = 400
ROW_TOLERANCE_PT = 2.5  # a row label can sit 1 pt above the rest of its row
WORD_GAP_PT = 1.5

# Lower bounds of the column bands, per row kind (measured on the 15.09.2026 sample).
TRANSACTION_BANDS = (
    (0, "lp"),
    (90, "id"),
    (160, "change"),
    (236, "doc"),
    (330, "date"),
    (415, "author"),
    (558, "signature"),
    (690, "desc"),
    (748, "ref"),
)
PRICE_BANDS = (
    (0, "kind"),
    (90, "price"),
    (160, "market"),
    (236, "seller"),
    (330, "buyer"),
    (415, "info"),
    (690, "vat"),
    (748, "rate"),
)
OBJECT_BANDS = (
    (0, "label"),
    (100, "ident"),
    (330, "price"),
    (415, "desc"),
    (502, "share"),
    (538, "area"),
    (602, "extra"),
    (678, "plan"),
    (730, "address"),
)
LEAD_X = 90  # a word left of this starts a new logical row; anything else continues a cell
OBJECT_LABELS = ("Obiekt", "Lokal", "Działka", "Budynek")
HEADER_LABELS = ("Lp.", "Rodzaj", "transakcji", "Nieruchomość")
PAGE_FURNITURE = ("STAROSTA", "POZNAŃSKI", "_")

KIND_UNIT = "lokal"
KIND_BUILT = "zabudowana"
KIND_PLOT = "niezabudowana"
KINDS = (KIND_UNIT, KIND_BUILT, KIND_PLOT)

_DATE = re.compile(r"\d{4}-\d\d-\d\d")
_SECTION = re.compile(
    r"Obręb: \S+ - (?P<district>.+?) Jedn\. ewidencyjna: (?P<unit>\S+ - .+?) Rodzaj: "
)
_ORDER = re.compile(r"[A-Z]{2,4}\.[A-Z]{2,4}\.\d+\.\d+\.\d{4}")
# The generator stamps two lines at the foot of the LAST page only. They sit in
# the object columns, so without this they land in the last transaction's cells
# (a town of "dnia: 30.06.2026 Automatyczny Generator"). Gap-tolerant, because a
# row is joined left-to-right and nothing guarantees the words stay adjacent.
# `spo?rządzony` matches both spellings on purpose: today's printouts carry the
# county's own typo ("sprządzony"), and the filter has to keep working the day
# the portal fixes it.
_FOOTER = re.compile(r"Wygenerowano\b.*\bdnia:|Dokument\b.*\bspo?rządzony|Automatyczny\s+Generator")
_MARKER = re.compile(r"\d\.")
# A narrow column breaks a word across lines WITHOUT a hyphen ("mieszkaniow" +
# "e"), so a 1–2-letter lowercase tail belongs to the token before it — unless
# it is a word in its own right.
_FRAGMENT = re.compile(r"([a-ząćęłńóśźż]{1,2}),?")
_CONJUNCTIONS = frozenset("i w z o u a".split())
_ADDRESS = re.compile(
    r"^(?:(?:ul|al|pl|os)\.\s*)?(?P<street>.+?)\s+(?P<building>\d+[A-Za-z]?(?:/\d+[A-Za-z]?)?)"
    r"(?:\s+m\.\s*(?P<unit>\S+?))?,\s*(?P<town>.+)$"
)


class NoTextLayer(Exception):
    pass


class NotRcnPrintout(Exception):
    pass


class NoTransactions(Exception):
    pass


class TooManyPages(Exception):
    pass


@dataclass(frozen=True)
class Word:
    text: str
    x0: float
    top: float


@dataclass
class Row:
    """One transaction. `kind` decides which sheet it lands on and therefore
    which fields are filled: `area`/`unit`/`annex` belong to a flat, the plot
    fields to land."""

    lp: int
    date: str | None
    town: str
    street: str
    building: str
    unit: str
    area: float | None
    price: float | None
    annex: bool
    warnings: list[str] = field(default_factory=list)
    kind: str = KIND_UNIT
    plot_ids: list[str] = field(default_factory=list)
    plot_area_m2: int | None = None
    share: str = ""
    plan: str = ""


@dataclass
class Printout:
    order_number: str
    unit: str
    rows: list[Row]
    file_warnings: list[str]


def words_from_pdf(data: bytes) -> list[list[Word]]:
    """Words per page. Loose char boxes: tight ones differ in height per glyph and
    would split one visual row into several."""
    with PDFIUM_LOCK:
        pdf = pdfium.PdfDocument(data)
        try:
            if len(pdf) > MAX_PAGES:
                raise TooManyPages(len(pdf))
            pages = []
            for index in range(len(pdf)):
                page = pdf[index]
                height = page.get_height()
                textpage = page.get_textpage()
                words: list[Word] = []
                text, x0, x1, top = "", 0.0, 0.0, 0.0
                for i in range(textpage.count_chars()):
                    char = textpage.get_text_range(i, 1)
                    left, _bottom, right, char_top = textpage.get_charbox(i, loose=True)
                    y = height - char_top
                    joins = text and abs(y - top) < 4 and left - x1 < WORD_GAP_PT
                    if not char.strip() or not joins:
                        if text:
                            words.append(Word(text, x0, top))
                        text = ""
                    if char.strip():
                        if not text:
                            x0, top = left, y
                        text, x1 = text + char, right
                if text:
                    words.append(Word(text, x0, top))
                textpage.close()
                page.close()
                pages.append(words)
            return pages
        finally:
            pdf.close()


def _visual_rows(words: list[Word]) -> list[list[Word]]:
    rows: list[list[Word]] = []
    for word in sorted(words, key=lambda w: (w.top, w.x0)):
        if rows and word.top - rows[-1][0].top <= ROW_TOLERANCE_PT:
            rows[-1].append(word)
        else:
            rows.append([word])
    return [sorted(row, key=lambda w: w.x0) for row in rows]


def _band(bands, x0: float) -> str:
    name = bands[0][1]
    for lower, candidate in bands:
        if x0 >= lower - 2:
            name = candidate
    return name


def _put(cell: dict[str, list[str]], bands, row: list[Word]) -> None:
    for word in row:
        cell.setdefault(_band(bands, word.x0), []).append(word.text)


def _glued(tokens: list[str]) -> str:
    out: list[str] = []
    for token in tokens:
        fragment = _FRAGMENT.fullmatch(token)
        if out and fragment and fragment[1] not in _CONJUNCTIONS:
            out[-1] += token  # the comma after a fragment stays: "wewnętrznyc" + "h," -> "…ych,"
        else:
            out.append(token)
    return " ".join(out)


def _cell_text(cell: dict[str, list[str]], band: str, *, glue: bool = False) -> str:
    """A cell's text without the object's ordinal marker ("1." on a plot, "3." on
    a flat). Only a bare marker token is dropped — never "0.0486"."""
    tokens = cell.get(band, [])
    if tokens and _MARKER.fullmatch(tokens[0]):
        tokens = tokens[1:]
    return (_glued(tokens) if glue else " ".join(tokens)).strip()


def _number(text: str) -> float | None:
    digits = re.sub(r"[^\d.]", "", text)
    return float(digits) if re.search(r"\d", digits) else None


def _after_marker(tokens: list[str], marker: str) -> float | None:
    if marker not in tokens:
        return None
    index = tokens.index(marker) + 1
    return _number(tokens[index]) if index < len(tokens) else None


def parse(pages: list[list[Word]]) -> Printout:
    if not any(pages):
        raise NoTextLayer()
    first_page = " ".join(w.text for w in sorted(pages[0], key=lambda w: (w.top, w.x0)))
    if "WYDRUK Z RCN" not in first_page:
        raise NotRcnPrintout()
    order = _ORDER.search(first_page)

    transactions: list[dict] = []
    unit_name = ""
    district = ""
    cell: dict[str, list[str]] | None = None
    bands = OBJECT_BANDS
    skip_section_id = False
    for words in pages:
        for row in _visual_rows(words):
            text = " ".join(w.text for w in row)
            head = row[0]
            leads = head.x0 < LEAD_X
            if (
                re.match(r"Strona \d+ z \d+", text)
                or "WYDRUK Z RCN" in text
                or text in PAGE_FURNITURE
                or (leads and _ORDER.fullmatch(text))
                or _FOOTER.search(text)
            ):
                continue
            if head.text == "Numer" and "Obręb:" in text:
                section = _SECTION.search(text)
                if section:
                    unit_name, district = section["unit"], section["district"]
                cell, skip_section_id = None, True
                continue
            if skip_section_id and leads and re.fullmatch(r"[0-9A-F]+", head.text):
                skip_section_id = False
                continue
            if leads and head.text in HEADER_LABELS:
                cell = None
                continue
            if leads and head.text.isdigit() and any(_DATE.fullmatch(w.text) for w in row):
                transactions.append({"head": {}, "price": {}, "objects": [], "district": district})
                cell, bands = transactions[-1]["head"], TRANSACTION_BANDS
                _put(cell, bands, row)
                continue
            if leads and transactions and cell is transactions[-1]["head"]:
                cell, bands = transactions[-1]["price"], PRICE_BANDS
                _put(cell, bands, row)
                continue
            if leads and transactions and head.text in OBJECT_LABELS:
                cell, bands = {}, OBJECT_BANDS
                transactions[-1]["objects"].append(cell)
                _put(cell, bands, row)
                continue
            if cell is not None:
                _put(cell, bands, row)

    if not transactions:
        raise NoTransactions()
    rows = [_to_row(t) for t in transactions]
    file_warnings = [] if [r.lp for r in rows] == list(range(1, len(rows) + 1)) else ["lp_gap"]
    return Printout(order[0] if order else "", unit_name, rows, file_warnings)


def _split_address(text: str) -> tuple[str, str, str, str] | None:
    matched = _ADDRESS.match(text)
    if not matched:
        return None
    return matched["town"], matched["street"], matched["building"], matched["unit"] or ""


def _to_row(transaction: dict) -> Row:
    """The kind comes from the objects, never from the section header: a section
    titled NIEZABUDOWANA can hold a transaction with two buildings."""
    head, price = transaction["head"], transaction["price"]
    objects = transaction["objects"]
    units = [o for o in objects if o["label"][0] == "Lokal"]
    base = dict(
        lp=int(head["lp"][0]),
        date=next((t for t in head.get("date", []) if _DATE.fullmatch(t)), None),
        price=_number("".join(price.get("price", []))),
    )
    build = _unit_row if units else _land_row
    return build(base, transaction)


def _unit_row(base: dict, transaction: dict) -> Row:
    units = [o for o in transaction["objects"] if o["label"][0] == "Lokal"]
    warnings = ["many_units"] if len(units) > 1 else []
    unit = next((u for u in units if "mieszkalna" in u.get("desc", [])), units[0])

    raw_address = _cell_text(unit, "address")
    parts = _split_address(raw_address)
    if parts:
        town, street, building, unit_no = parts
    else:
        town, street, building, unit_no = "", raw_address, "", ""
        warnings.append("address_unparsed")

    area_tokens = unit.get("area", [])
    area = _after_marker(area_tokens, "3.")
    if base["date"] is None or base["price"] is None or area is None:
        warnings.append("missing_field")
    return Row(
        **base,
        town=town,
        street=street,
        building=building,
        unit=unit_no,
        area=area,
        annex=(_after_marker(area_tokens, "4.") or 0) > 0,
        warnings=warnings,
        kind=KIND_UNIT,
    )


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(v for v in values if v))


def _land_row(base: dict, transaction: dict) -> Row:
    objects = transaction["objects"]
    buildings = [o for o in objects if o["label"][0] == "Budynek"]
    plots = [o for o in objects if o["label"][0] == "Działka"]
    holdings = [o for o in objects if o["label"][0] == "Obiekt"]
    kind = KIND_BUILT if buildings else KIND_PLOT
    warnings: list[str] = []

    areas = [_number(_cell_text(p, "area")) for p in plots]
    # A missing area on ANY plot makes the sum a lie, so there is no sum at all.
    area_m2 = sum(round(a * 10000) for a in areas) if plots and None not in areas else None
    if len(plots) > 1:
        warnings.append("many_plots")
    # "1/1" is the norm and says nothing; only a fraction of the right is news.
    shares = _unique([s for s in (_cell_text(h, "share") for h in holdings) if s != "1/1"])
    if shares:
        warnings.append("partial_share")

    # The address of the dwelling, else of the first plot (spec §2).
    home = next((b for b in buildings if "Mieszkalny" in b.get("desc", [])), None)
    sources = [o for o in (home, plots[0] if plots else None) if o is not None]
    raw_address = next((t for t in (_cell_text(o, "address") for o in sources) if t), "")
    parts = _split_address(raw_address)
    town, street, building = transaction["district"], "", ""
    if parts:
        town, street, building = parts[0], parts[1], parts[2]
    elif kind == KIND_BUILT:
        # Only the built sheet has ULICA / NR BUD, so only there is a missing
        # address a gap; on bare land the district name is answer enough.
        street = raw_address
        warnings.append("address_unparsed")
    if base["date"] is None or base["price"] is None or area_m2 is None:
        warnings.append("missing_field")
    return Row(
        **base,
        town=town,
        street=street,
        building=building,
        unit="",
        area=None,
        annex=False,
        warnings=warnings,
        kind=kind,
        plot_ids=[_cell_text(p, "ident") for p in plots],
        plot_area_m2=area_m2,
        share="; ".join(shares),
        plan="; ".join(_unique([_cell_text(p, "plan", glue=True) for p in plots])),
    )
