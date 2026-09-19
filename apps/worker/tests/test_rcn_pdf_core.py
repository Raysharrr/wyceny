"""rcn_pdf.parse on synthetic words (T-22) — no PDF, no PII: every address is invented.

`words(...)` lays text out the way the printout does: one tuple per cell,
(x0, top, "text with spaces"); each space-separated token becomes a Word a few
points to the right of the previous one, inside the same column band."""

import os
from pathlib import Path

import pytest

from app import rcn_pdf
from app.rcn_pdf import Word


def words(*cells: tuple[float, float, str]) -> list[Word]:
    out = []
    for x0, top, text in cells:
        for i, token in enumerate(text.split()):
            out.append(Word(token, x0 + i * 0.01, top))
    return out


HEADER = words((399, 61, "WYDRUK Z RCN"), (31, 119, "GKG.GZW.4061.0000.2026"))


def section(top: float, kind: str = "NIERUCHOMOŚĆ LOKALOWA") -> list[Word]:
    return words(
        (31, top, "Numer"),
        (100, top, "Obręb: 0001 - Testowo"),
        (269, top, "Jedn. ewidencyjna: 000000_0 - Przykładowo - obszar wiejski"),
        (561, top, f"Rodzaj: {kind}"),
        (31, top + 9, "AAAA0000BBBB11"),
        (33, top + 24, "Lp."),
        (99, top + 21, "Id Transakcji"),
        (32, top + 43, "Rodzaj"),
        (99, top + 43, "Cena ogółem -"),
    )


def transaction(top: float, lp: int, date: str, total: str) -> list[Word]:
    return words(
        (31, top, str(lp)),
        (98, top, "AAAA0000BBBB1"),
        (98, top + 10, "CCCC2222DDDD3"),
        (240, top, "umowa (akt notarialny)"),
        (334, top, date),
        (419, top, "not. Jan Testowy"),
        (31, top + 40, "wolny rynek"),
        (98, top + 40, total),
        (163, top + 40, "wtórny rynek"),
        (30, top + 60, "Nieruchomość"),
        (109, top + 60, "Rodzaj nieruchomości"),
    )


def unit(top: float, price: str, area: str, address: str, annex: str = "", label_shift: float = 0):
    cells = [
        (31, top - label_shift, "Lokal"),
        (108, top, "3. 000000_0.0001.1_BUD.1_LOK"),
        (335, top, f"3. {price}"),
        (419, top, "3. mieszkalna"),
        (541, top, f"3. {area}"),
        (734, top, f"3. {address.split('|')[0]}"),
        (541, top + 12, f"4. {annex}".strip()),
    ]
    if "|" in address:
        cells.append((734, top + 9, address.split("|")[1]))
    return words(*cells)


def simple(address: str = "ul. Lipowa 4|m.1, Testowo", **kw) -> list[list[Word]]:
    return [
        HEADER
        + section(145)
        + transaction(210, 1, "2026-07-27", "870 000.00")
        + unit(300, "870 000.00", "88.72", address, **kw)
    ]


def test_simple_transaction():
    printout = rcn_pdf.parse(simple())
    assert printout.order_number == "GKG.GZW.4061.0000.2026"
    assert printout.unit == "000000_0 - Przykładowo - obszar wiejski"
    assert printout.file_warnings == []
    (row,) = printout.rows
    assert (row.lp, row.date, row.town, row.street, row.building, row.unit) == (
        1,
        "2026-07-27",
        "Testowo",
        "Lipowa",
        "4",
        "1",
    )
    assert (row.area, row.price, row.annex, row.warnings) == (88.72, 870000.0, False, [])


def test_total_price_wins_over_object_price():
    pages = [
        HEADER
        + section(145)
        + transaction(210, 1, "2026-06-17", "860 000.00")
        + unit(300, "859 000.00", "107.10", "ul. Polna 7|m.1, Testowo")
    ]
    assert rcn_pdf.parse(pages).rows[0].price == 860000.0


def test_annex_area_means_yes():
    assert rcn_pdf.parse(simple(annex="3.67")).rows[0].annex is True
    assert rcn_pdf.parse(simple(annex="")).rows[0].annex is False


def test_row_label_one_point_above_its_row_still_joins():
    assert rcn_pdf.parse(simple(label_shift=1)).rows[0].area == 88.72


def test_building_list_continues_on_the_next_page_without_a_header():
    first = simple()[0]
    second = words(
        (31, 58, "Budynek"), (116, 58, "2. 000000_0.0001.2_BUD"), (734, 58, "2. ul. Lipowa 6,")
    )
    second += transaction(120, 2, "2026-07-16", "1 070 000.00")
    second += unit(210, "1 070 000.00", "95.75", "ul. Klonowa 9|m.1, Testowo")
    printout = rcn_pdf.parse([first, second])
    assert [r.lp for r in printout.rows] == [1, 2]
    assert printout.rows[0].street == "Lipowa"
    assert printout.rows[1].street == "Klonowa"


@pytest.mark.parametrize(
    ("address", "expected"),
    [
        ("ul. Osiedle pod Dębem 37|m.1, Testowo", ("Testowo", "Osiedle pod Dębem", "37", "1")),
        ("ul. Leśna 21E|m.2, Wzorcowo", ("Wzorcowo", "Leśna", "21E", "2")),
        ("ul. Polna 7, Testowo", ("Testowo", "Polna", "7", "")),
    ],
)
def test_address_shapes(address, expected):
    row = rcn_pdf.parse(simple(address)).rows[0]
    assert (row.town, row.street, row.building, row.unit) == expected
    assert row.warnings == []


def test_unparsed_address_lands_whole_in_street_with_a_warning():
    row = rcn_pdf.parse(simple("Testowo dz. 12/3")).rows[0]
    assert (row.street, row.town, row.warnings) == ("Testowo dz. 12/3", "", ["address_unparsed"])


def test_transaction_without_a_unit_is_flagged():
    plot = words(
        (31, 300, "Działka"),
        (108, 300, "1. 000000_0.0001.12/3"),
        (541, 300, "1. 0.0900"),
        (734, 300, "1. ul. Polna 3, Testowo"),
    )
    pages = [HEADER + section(145) + transaction(210, 1, "2026-06-17", "412 000.00") + plot]
    row = rcn_pdf.parse(pages).rows[0]
    assert (row.area, row.street, row.warnings) == (None, "Polna", ["no_unit"])


def test_two_units_take_the_first_residential_and_flag_it():
    garage = words(
        (31, 340, "Lokal"),
        (419, 340, "3. garaż"),
        (541, 340, "3. 15.00"),
        (734, 340, "3. ul. Lipowa 4 m.G1, Testowo"),
    )
    row = rcn_pdf.parse([simple()[0] + garage]).rows[0]
    assert (row.area, row.warnings) == (88.72, ["many_units"])


def test_gap_in_lp_is_a_file_warning():
    pages = simple()
    pages[0] += transaction(400, 3, "2026-07-16", "1 070 000.00")
    pages[0] += unit(490, "1 070 000.00", "95.75", "ul. Klonowa 9|m.1, Testowo")
    assert rcn_pdf.parse(pages).file_warnings == ["lp_gap"]


def test_refusals():
    with pytest.raises(rcn_pdf.NoTextLayer):
        rcn_pdf.parse([[], []])
    with pytest.raises(rcn_pdf.NotRcnPrintout):
        rcn_pdf.parse([words((31, 60, "Umowa sprzedaży"))])
    with pytest.raises(rcn_pdf.NoTransactions):
        rcn_pdf.parse([HEADER + section(145)])


SAMPLE = os.environ.get("RCN_SAMPLE_PDF")


@pytest.mark.skipif(not SAMPLE, reason="real county printout stays outside the repo (PII)")
def test_sample_printout_counters():
    printout = rcn_pdf.parse(rcn_pdf.words_from_pdf(Path(SAMPLE).read_bytes()))
    rows = printout.rows
    assert [r.lp for r in rows] == list(range(1, 29))
    assert printout.file_warnings == [] and not any(r.warnings for r in rows)
    assert sum(r.price for r in rows) == 24_336_900.0
    assert round(sum(r.area for r in rows), 2) == 2734.70
    assert sum(r.annex for r in rows) == 3
