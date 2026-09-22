"""words_from_pdf on a PDF written by hand in the test — positioned text, no binary fixture."""

import pytest

from app import rcn_pdf


# A hand-written PDF string is Latin-1, which has no Polish letters — and the
# printout's own row labels ("Działka") do. Each one gets a spare code and an
# Adobe glyph name in the font's /Differences, which PDFium maps back to the
# right character on extraction.
POLISH = {
    "ą": "aogonek",
    "ć": "cacute",
    "ę": "eogonek",
    "ł": "lslash",
    "ń": "nacute",
    "ś": "sacute",
    "ź": "zacute",
    "ż": "zdotaccent",
    "Ą": "Aogonek",
    "Ć": "Cacute",
    "Ę": "Eogonek",
    "Ł": "Lslash",
    "Ń": "Nacute",
    "Ś": "Sacute",
    "Ź": "Zacute",
    "Ż": "Zdotaccent",
}
_CODES = {char: 0x80 + index for index, char in enumerate(POLISH)}
_DIFFERENCES = " ".join(f"{_CODES[char]} /{name}" for char, name in POLISH.items())
_FONT = (
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding "
    f"<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [{_DIFFERENCES}] >> >>"
)


def pdf(*pages: list[tuple[float, float, str]]) -> bytes:
    """Minimal PDF: one Helvetica 8 pt text run per (x, y_from_top, text); A4 landscape."""
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""]
    kids = []
    for cells in pages:
        stream = "".join(
            f"BT /F1 8 Tf {x} {595 - y} Td ({''.join(chr(_CODES.get(c, ord(c))) for c in t)}) Tj ET\n"
            for x, y, t in cells
        )
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream}endstream")
        content = len(objects)
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841 595] /Contents {content} 0 R "
            f"/Resources << /Font << /F1 {_FONT} >> >> >>"
        )
        kids.append(f"{len(objects)} 0 R")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out, offsets = "%PDF-1.4\n", []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode("latin-1")


def test_words_carry_their_column_position_and_row():
    (page,) = rcn_pdf.words_from_pdf(
        pdf([(31, 100, "Lokal"), (541, 100, "3. 88.72"), (31, 140, "Budynek")])
    )
    by_text = {w.text: w for w in page}
    assert [w.text for w in page] == ["Lokal", "3.", "88.72", "Budynek"]
    assert by_text["Lokal"].x0 == pytest.approx(31, abs=1)
    assert by_text["3."].x0 == pytest.approx(541, abs=1)
    assert abs(by_text["Lokal"].top - by_text["88.72"].top) <= rcn_pdf.ROW_TOLERANCE_PT
    assert by_text["Budynek"].top - by_text["Lokal"].top == pytest.approx(40, abs=1)


def test_pages_come_back_in_document_order():
    pages = rcn_pdf.words_from_pdf(pdf([(31, 100, "pierwsza")], [(31, 100, "druga")]))
    assert [[w.text for w in p] for p in pages] == [["pierwsza"], ["druga"]]


def test_page_limit(monkeypatch):
    monkeypatch.setattr(rcn_pdf, "MAX_PAGES", 1)
    with pytest.raises(rcn_pdf.TooManyPages):
        rcn_pdf.words_from_pdf(pdf([(31, 100, "a")], [(31, 100, "b")]))


def test_holds_the_shared_lock(monkeypatch):
    from app import pdfium_lock

    assert rcn_pdf.PDFIUM_LOCK is pdfium_lock.PDFIUM_LOCK
    seen = []
    original = rcn_pdf.pdfium.PdfDocument
    monkeypatch.setattr(
        rcn_pdf.pdfium,
        "PdfDocument",
        lambda d: (seen.append(rcn_pdf.PDFIUM_LOCK.locked()), original(d))[1],
    )
    rcn_pdf.words_from_pdf(pdf([(31, 100, "a")]))
    assert seen == [True]
