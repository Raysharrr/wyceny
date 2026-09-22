"""rcn_pdf.parse on synthetic words (T-22) — no PDF, no PII: every address is invented.

`words(...)` lays text out the way the printout does: one tuple per cell,
(x0, top, "text with spaces"); each space-separated token becomes a Word a few
points to the right of the previous one, inside the same column band."""

import os
import re
from collections import Counter
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


def holding(top: float, share: str = "1/1", area: str = "0.0900", built: bool = False):
    return words(
        (31, top, "Obiekt"),
        (108, top, f"nieruchomość gruntowa {'zabudowana' if built else 'niezabudowana'}"),
        (419, top, "własność nieruchomości gruntowej"),
        (505, top, share),
        (541, top, area),
    )


def plot(
    top: float,
    ident: str,
    area: str,
    address: str = "",
    plan: str = "",
    desc: str = "Grunty rolne",
):
    return words(
        (31, top, "Działka"),
        (108, top, f"1. {ident}"),
        (419, top, f"1. {desc}"),
        (541, top, f"1. {area}".strip()),
        (681, top, f"1. {plan}".strip()),
        (734, top, f"1. {address}".strip()),
    )


def house(top: float, ident: str = "000000_0.0001.12/3.1_BUD", desc="Mieszkalny", address=""):
    return words(
        (31, top, "Budynek"),
        (108, top, f"2. {ident}"),
        (419, top, f"2. {desc}"),
        (734, top, f"2. {address}".strip()),
    )


# The generator's two stamp lines at the foot of the last page. Today's
# printouts spell it "sprządzony" — the county's own typo — so both spellings
# are worth exercising.
SPELLINGS = ("sprządzony", "sporządzony")


def footer(spelling: str = SPELLINGS[0], *, named: bool = True) -> list[Word]:
    """`named=False` drops "Automatyczny Generator", leaving the stamp line to be
    recognised by its wording alone — which is what the spelling branch is for."""
    # x0 as measured on the real printouts: the stamp straddles the `extra`,
    # `plan` and `address` bands, which is precisely why it used to end up in the
    # last transaction's cells. Splitting "Dokument / {spelling} / przez:" into
    # separate words is what makes `named=False` possible: written as a single
    # cell the whole stamp line lands in `extra`, which has no reader, so the
    # spelling test would have nothing to check.
    cells = [
        (706, 700, "Wygenerowano"),
        (758, 700, "dnia: 30.06.2026"),
        (637, 712, "Dokument"),
        (671, 712, spelling),
        (710, 712, "przez:"),
    ]
    if named:
        cells += [(731, 712, "Automatyczny"), (778, 712, "Generator")]
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


def test_transaction_without_a_unit_is_bare_land():
    """The shape that used to be flagged `no_unit` is now a kind of its own: a
    sheet with no PU column, so nothing about it is a defect."""
    pages = [
        HEADER
        + section(145)
        + transaction(210, 1, "2026-06-17", "412 000.00")
        + holding(290)
        + plot(300, "000000_0.0001.12/3", "0.0900", address="ul. Polna 3, Testowo")
    ]
    row = rcn_pdf.parse(pages).rows[0]
    assert (row.kind, row.area, row.town, row.warnings) == (
        rcn_pdf.KIND_PLOT,
        None,
        "Testowo",
        [],
    )
    assert (row.plot_ids, row.plot_area_m2) == (["000000_0.0001.12/3"], 900)


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


# --- domy i działki (spec 22.09) ---------------------------------------------


def land(*objects: list[Word], kind: str = "NIERUCHOMOŚĆ GRUNTOWA NIEZABUDOWANA", tail=()):
    page = HEADER + section(145, kind) + transaction(210, 1, "2026-06-17", "412 000.00")
    for obj in objects:
        page = page + obj
    return [page + list(tail)]


@pytest.mark.parametrize("spelling", SPELLINGS)
def test_the_generators_footer_does_not_leak_into_the_last_transaction(spelling):
    pages = land(
        holding(290),
        plot(300, "000000_0.0001.12/3", "0.0900", plan="tereny dróg publicznych"),
        tail=footer(spelling),
    )
    row = rcn_pdf.parse(pages).rows[0]
    assert (row.town, row.plan) == ("Testowo", "tereny dróg publicznych")


@pytest.mark.parametrize("spelling", SPELLINGS)
def test_the_stamp_line_is_recognised_by_its_wording_alone(spelling):
    """The previous test passes on either spelling anyway, because the same row
    also says "Automatyczny Generator". Here that name is gone, so the line is
    filtered by "Dokument … przez:" and nothing else — the branch that has to
    survive the county fixing its own typo."""
    pages = land(
        holding(290),
        plot(300, "000000_0.0001.12/3", "0.0900", plan="tereny dróg publicznych"),
        tail=footer(spelling, named=False),
    )
    row = rcn_pdf.parse(pages).rows[0]
    assert (row.town, row.plan) == ("Testowo", "tereny dróg publicznych")


def test_a_building_makes_it_built_even_in_a_section_titled_niezabudowana():
    pages = land(
        holding(290, built=True),
        plot(300, "000000_0.0001.12/3", "0.0900"),
        house(320, address="ul. Lipowa 6, Testowo"),
    )
    row = rcn_pdf.parse(pages).rows[0]
    assert (row.kind, row.town, row.street, row.building) == (
        rcn_pdf.KIND_BUILT,
        "Testowo",
        "Lipowa",
        "6",
    )


def test_a_flat_wins_over_a_building():
    assert rcn_pdf.parse([simple()[0] + house(400)]).rows[0].kind == rcn_pdf.KIND_UNIT


def test_two_plots_are_joined_and_their_areas_summed():
    pages = land(
        holding(290),
        plot(300, "000000_0.0001.12/3", "0.0900"),
        plot(320, "000000_0.0001.12/4", "0.1204"),
    )
    row = rcn_pdf.parse(pages).rows[0]
    assert row.plot_ids == ["000000_0.0001.12/3", "000000_0.0001.12/4"]
    assert (row.plot_area_m2, row.warnings) == (2104, ["many_plots"])


def test_a_share_other_than_one_is_carried_and_flagged():
    pages = land(holding(290, share="3/18"), plot(300, "000000_0.0001.12/3", "0.0900"))
    row = rcn_pdf.parse(pages).rows[0]
    assert (row.share, row.warnings) == ("3/18", ["partial_share"])


def test_a_whole_right_leaves_the_share_empty():
    pages = land(holding(290), plot(300, "000000_0.0001.12/3", "0.0900"))
    assert rcn_pdf.parse(pages).rows[0].share == ""


def test_a_word_broken_across_a_narrow_column_is_glued_back():
    pages = land(
        holding(290),
        plot(300, "000000_0.0001.12/3", "0.0900", plan="budownictwo mieszkaniow e wewnętrznyc h,"),
    )
    assert rcn_pdf.parse(pages).rows[0].plan == "budownictwo mieszkaniowe wewnętrznych,"


def test_a_conjunction_is_a_word_not_a_broken_tail():
    pages = land(
        holding(290),
        plot(300, "000000_0.0001.12/3", "0.0900", plan="tereny dróg i obiektów"),
    )
    assert rcn_pdf.parse(pages).rows[0].plan == "tereny dróg i obiektów"


def test_two_plans_are_joined_without_repeats():
    pages = land(
        holding(290),
        plot(300, "000000_0.0001.12/3", "0.0900", plan="tereny dróg publicznych"),
        plot(320, "000000_0.0001.12/4", "0.0100", plan="tereny dróg publicznych"),
        plot(340, "000000_0.0001.12/5", "0.0100", plan="grunty rolne"),
    )
    assert rcn_pdf.parse(pages).rows[0].plan == "tereny dróg publicznych; grunty rolne"


def test_town_falls_back_to_the_section_district_when_there_is_no_address():
    pages = land(holding(290), plot(300, "000000_0.0001.12/3", "0.0900"))
    row = rcn_pdf.parse(pages).rows[0]
    assert (row.town, row.street, row.warnings) == ("Testowo", "", [])


def test_a_built_plot_without_an_address_is_flagged():
    pages = land(holding(290, built=True), plot(300, "000000_0.0001.12/3", "0.0900"), house(320))
    row = rcn_pdf.parse(pages).rows[0]
    assert (row.town, row.street, row.warnings) == ("Testowo", "", ["address_unparsed"])


def test_a_built_address_off_the_pattern_lands_whole_in_street():
    """The other half of `address_unparsed`: there IS an address, it just does
    not split. It goes to ULICA in one piece — the same as on the flats sheet —
    while MIEJSCOWOŚĆ still falls back to the district (what Pomoc promises).

    The address deliberately shares NO word with the district: were MIEJSCOWOŚĆ
    taken from the address instead of the section header, the town below could
    not come out right by accident."""
    pages = land(
        holding(290, built=True),
        plot(300, "000000_0.0001.12/3", "0.0900"),
        house(320, address="dz. 12/3 przy drodze"),
    )
    row = rcn_pdf.parse(pages).rows[0]
    assert (row.street, row.building) == ("dz. 12/3 przy drodze", "")
    assert row.town == "Testowo"  # z obrębu sekcji, nie z adresu
    assert row.warnings == ["address_unparsed"]


def test_a_plot_without_an_area_has_no_sum_and_is_flagged():
    pages = land(holding(290), plot(300, "000000_0.0001.12/3", ""))
    row = rcn_pdf.parse(pages).rows[0]
    assert (row.plot_area_m2, row.warnings) == (None, ["missing_field"])


SAMPLE = os.environ.get("RCN_SAMPLE_PDF")

# Shapes, not names: what a plot identifier looks like, and what the generator's
# footer looks like when it leaks into a cell it does not belong in.
_PLOT_ID = re.compile(r"\d{6}_\d\.\d{4}\.\S+")
_FOOTER_LEAK = re.compile(r"Generator|Wygenerowano|dnia:|spo?rządzony")


def expected(variable: str) -> list[str]:
    """Values read off a real printout live in the environment, next to the path
    of the file they came from — never in the repo. Pipe-separated, and no
    variable means no test, exactly as a missing PDF means no test."""
    value = os.environ.get(variable)
    if not value:
        pytest.skip(f"{variable} not set — the printout's own names stay outside the repo")
    return value.split("|")


@pytest.mark.skipif(not SAMPLE, reason="real county printout stays outside the repo (PII)")
def test_sample_printout_counters():
    printout = rcn_pdf.parse(rcn_pdf.words_from_pdf(Path(SAMPLE).read_bytes()))
    rows = printout.rows
    assert [r.lp for r in rows] == list(range(1, 29))
    assert printout.file_warnings == [] and not any(r.warnings for r in rows)
    assert sum(r.price for r in rows) == 24_336_900.0
    assert round(sum(r.area for r in rows), 2) == 2734.70
    assert sum(r.annex for r in rows) == 3
    assert {r.kind for r in rows} == {rcn_pdf.KIND_UNIT}


# Counters from the three land printouts of 22.09, recomputed from scratch here.
# Counters ONLY: the printouts stay outside the repo, and so does every name
# written in them — a place, a street or a house number does not belong in a test
# file just because it is a convenient thing to assert. Where a test does need
# one, it reads it from the environment (`expected`), next to the path of the
# file it came from.
# The spec's figures for the file behind `RCN_SAMPLE_PDF_MIESZANY` (94 plots /
# 175 196 m² / 22 partial shares) were taken before the kind split and include
# the ONE flat transaction's own 17 plots (11 247 m², one partial share) — those
# now belong to the `lokale` sheet, which has no plot columns at all, so the land
# totals are 17 / 11 247 / 1 lower.
LAND_SAMPLES = {
    "RCN_SAMPLE_PDF_ZAB": (11, {rcn_pdf.KIND_BUILT: 11}, 5_140_000.0, 21_979, 13, 1),
    "RCN_SAMPLE_PDF_NIEZAB": (8, {rcn_pdf.KIND_PLOT: 8}, 11_073_149.67, 82_223, 15, 1),
    "RCN_SAMPLE_PDF_MIESZANY": (
        34,
        {rcn_pdf.KIND_UNIT: 1, rcn_pdf.KIND_PLOT: 33},
        21_991_096.84,
        163_949,
        77,
        21,
    ),
}


@pytest.mark.parametrize("variable", LAND_SAMPLES)
def test_land_sample_counters(variable):
    path = os.environ.get(variable)
    if not path:
        pytest.skip("real county printout stays outside the repo (PII)")
    expected_rows, expected_kinds, total, area, plots, partial = LAND_SAMPLES[variable]
    rows = rcn_pdf.parse(rcn_pdf.words_from_pdf(Path(path).read_bytes())).rows
    assert [r.lp for r in rows] == list(range(1, expected_rows + 1))
    assert Counter(r.kind for r in rows) == Counter(expected_kinds)
    assert round(sum(r.price for r in rows), 2) == total
    land = [r for r in rows if r.kind != rcn_pdf.KIND_UNIT]
    assert sum(r.plot_area_m2 or 0 for r in land) == area
    assert sum(len(r.plot_ids) for r in land) == plots
    assert sum(1 for r in land if "partial_share" in r.warnings) == partial
    # The generator's footer used to end up in the last transaction's cells.
    assert not any(_FOOTER_LEAK.search(r.town) or _FOOTER_LEAK.search(r.plan) for r in rows)


@pytest.mark.skipif(
    not os.environ.get("RCN_SAMPLE_PDF_ZAB"), reason="real county printout stays outside the repo"
)
def test_the_first_built_transaction_reads_whole():
    """The address of this row sits on its residential BUILDING, not on either of
    its two plots, and it splits into three parts — so the expected town, street
    and house number come from `RCN_SAMPLE_ZAB_ROW1` ("town|street|number")."""
    town, street, building = expected("RCN_SAMPLE_ZAB_ROW1")
    path = os.environ["RCN_SAMPLE_PDF_ZAB"]
    row = rcn_pdf.parse(rcn_pdf.words_from_pdf(Path(path).read_bytes())).rows[0]
    assert (row.kind, row.town, row.street, row.building) == (
        rcn_pdf.KIND_BUILT,
        town,
        street,
        building,
    )
    assert (len(row.plot_ids), row.plot_area_m2) == (2, 984)
    # Two of the right thing: a count alone would survive ID DZIAŁKI being fed
    # from the wrong band.
    assert all(_PLOT_ID.fullmatch(identifier) for identifier in row.plot_ids)


@pytest.mark.skipif(
    not os.environ.get("RCN_SAMPLE_PDF_NIEZAB"),
    reason="real county printout stays outside the repo",
)
def test_bare_land_sample_takes_its_town_from_the_district_and_not_the_footer():
    """Neither of these two rows carries an address, so each town comes from its
    own section's district — and the sections differ. Expected names come from
    `RCN_SAMPLE_NIEZAB_TOWNS` ("first|last"); the last row is also the one the
    generator's footer used to overwrite. The MPZP text is asserted here rather
    than read from the environment: it is planning terminology, not a name, and
    it is the only proof that the un-hyphenated line break is glued back on a
    REAL printout."""
    first_town, last_town = expected("RCN_SAMPLE_NIEZAB_TOWNS")
    path = os.environ["RCN_SAMPLE_PDF_NIEZAB"]
    rows = rcn_pdf.parse(rcn_pdf.words_from_pdf(Path(path).read_bytes())).rows
    assert (rows[0].town, rows[0].plot_area_m2) == (first_town, 26_485)
    assert rows[0].plan.startswith("budownictwo mieszkaniowe wielorodzinne")
    assert rows[-1].town == last_town
    assert not _FOOTER_LEAK.search(rows[-1].town + " " + rows[-1].plan)
