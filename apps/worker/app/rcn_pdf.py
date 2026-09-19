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

_DATE = re.compile(r"\d{4}-\d\d-\d\d")
_SECTION = re.compile(r"Obręb: \S+ - .+? Jedn\. ewidencyjna: (\S+ - .+?) Rodzaj: ")
_ORDER = re.compile(r"[A-Z]{2,4}\.[A-Z]{2,4}\.\d+\.\d+\.\d{4}")
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
            ):
                continue
            if head.text == "Numer" and "Obręb:" in text:
                section = _SECTION.search(text)
                unit_name = section[1] if section else unit_name
                cell, skip_section_id = None, True
                continue
            if skip_section_id and leads and re.fullmatch(r"[0-9A-F]+", head.text):
                skip_section_id = False
                continue
            if leads and head.text in HEADER_LABELS:
                cell = None
                continue
            if leads and head.text.isdigit() and any(_DATE.fullmatch(w.text) for w in row):
                transactions.append({"head": {}, "price": {}, "objects": []})
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


def _to_row(transaction: dict) -> Row:
    head, price = transaction["head"], transaction["price"]
    units = [o for o in transaction["objects"] if o["label"][0] == "Lokal"]
    plots = [o for o in transaction["objects"] if o["label"][0] == "Działka"]
    warnings: list[str] = []
    unit = next(
        (u for u in units if "mieszkalna" in u.get("desc", [])), units[0] if units else None
    )
    if not units:
        warnings.append("no_unit")
    elif len(units) > 1:
        warnings.append("many_units")

    source = unit or (plots[0] if plots else {})
    raw_address = re.sub(r"^\d\.\s*", "", " ".join(source.get("address", [])))
    matched = _ADDRESS.match(raw_address)
    if matched:
        town, street = matched["town"], matched["street"]
        building, unit_no = matched["building"], matched["unit"] or ""
    else:
        town, street, building, unit_no = "", raw_address, "", ""
        warnings.append("address_unparsed")

    area_tokens = unit.get("area", []) if unit else []
    area = _after_marker(area_tokens, "3.")
    annex = (_after_marker(area_tokens, "4.") or 0) > 0
    date = next((t for t in head.get("date", []) if _DATE.fullmatch(t)), None)
    total = _number("".join(price.get("price", [])))
    if date is None or total is None or (unit is not None and area is None):
        warnings.append("missing_field")
    return Row(
        lp=int(head["lp"][0]),
        date=date,
        town=town,
        street=street,
        building=building,
        unit=unit_no,
        area=area,
        price=total,
        annex=annex,
        warnings=warnings,
    )
