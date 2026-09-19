"""rcn_xlsx.to_xlsx — the office's layout: title, headers, typed cells, a live formula, an empty J."""

from datetime import datetime
from io import BytesIO

from openpyxl import load_workbook

from app.rcn_pdf import Printout, Row
from app.rcn_xlsx import to_xlsx

CLEAN = Row(1, "2026-07-27", "Testowo", "Lipowa", "4", "1", 88.72, 870000.0, False)
FLAGGED = Row(2, "2026-06-17", "Testowo", "Polna", "21E", "", None, 412000.0, False, ["no_unit"])


def sheet(*rows: Row):
    data = to_xlsx(Printout("GKG.GZW.4061.0000.2026", "000000_0 - Przykładowo", list(rows), []))
    return load_workbook(BytesIO(data))["transakcje"]


def test_title_and_headers():
    ws = sheet(CLEAN)
    assert ws["A1"].value == "WYDRUK Z RCN · GKG.GZW.4061.0000.2026 · 000000_0 - Przykładowo"
    assert [c.value for c in ws[2]] == [
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
    ]


def test_cells_are_typed_and_price_per_metre_is_a_formula():
    ws = sheet(CLEAN)
    assert [c.value for c in ws[3]] == [
        datetime(2026, 7, 27),
        "Testowo",
        "Lipowa",
        4,
        1,
        88.72,
        870000,
        "=G3/F3",
        "nie",
        None,
    ]
    assert ws["A3"].number_format == "DD.MM.YYYY"


def test_flagged_row_is_yellow_commented_and_has_no_formula():
    ws = sheet(CLEAN, FLAGGED)
    assert ws["D4"].value == "21E"
    assert ws["H4"].value is None
    assert ws["A4"].fill.fgColor.rgb.endswith("FFF2CC")
    assert "bez lokalu" in ws["A4"].comment.text
    assert ws["A3"].comment is None


def test_the_empty_column_says_why_it_is_empty():
    assert "Do uzupełnienia ręcznie" in sheet(CLEAN)["J2"].comment.text
