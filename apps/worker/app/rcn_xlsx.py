"""Printout rows -> the office's XLSX layout (T-22). Pure — no FastAPI import."""

from datetime import date
from io import BytesIO

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Font, PatternFill

from app.rcn_pdf import Printout

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
HEADERS = (
    "DATA",
    "MIEJSCOWOŚĆ",
    "ULICA",
    "NR BUD",
    "NR LOK",
    "PU",
    "CENA",
    "CENA J",
    "P.P",
    "RODZAJ BUD",
)
WARNING_FILL = PatternFill("solid", fgColor="FFF2CC")
WARNING_TEXT = {
    "no_unit": "Transakcja bez lokalu — brak powierzchni użytkowej.",
    "many_units": "Transakcja obejmuje kilka lokali — wpisano pierwszy mieszkalny.",
    "address_unparsed": "Nie udało się rozbić adresu — cały adres jest w kolumnie ULICA.",
    "missing_field": "W wydruku brakuje daty, ceny albo powierzchni.",
}


def _cell_number(text: str):
    return int(text) if text.isdigit() else text or None


def to_xlsx(printout: Printout) -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = "transakcje"
    sheet.append(
        [" · ".join(p for p in ("WYDRUK Z RCN", printout.order_number, printout.unit) if p)]
    )
    sheet.append(HEADERS)
    for cell in sheet[2]:
        cell.font = Font(bold=True)
    sheet.cell(2, 10).comment = Comment(
        "Do uzupełnienia ręcznie — wydruk podaje tylko „Mieszkalny”, bez rodzaju zabudowy.",
        "Wyceny",
    )
    for n, row in enumerate(printout.rows, start=3):
        sheet.append(
            [
                date.fromisoformat(row.date) if row.date else None,
                row.town,
                row.street,
                _cell_number(row.building),
                _cell_number(row.unit),
                row.area,
                row.price,
                f"=G{n}/F{n}" if row.area else None,
                "tak" if row.annex else "nie",
                None,
            ]
        )
        sheet.cell(n, 1).number_format = "DD.MM.YYYY"
        if row.warnings:
            for cell in sheet[n]:
                cell.fill = WARNING_FILL
            sheet.cell(n, 1).comment = Comment(
                " ".join(WARNING_TEXT[w] for w in row.warnings), "Wyceny"
            )
    for column, width in zip("ABCDEFGHIJ", (12, 18, 26, 8, 8, 9, 13, 11, 6, 16)):
        sheet.column_dimensions[column].width = width
    out = BytesIO()
    book.save(out)
    return out.getvalue()
