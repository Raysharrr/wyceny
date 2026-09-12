"""Raw cell reader for cooperative transaction registers (T-13, S2a).

Returns the sheets of an XLSX as TEXT cells — no interpretation, no column
guessing: four known registers have five column layouts, so a human maps the
columns in the web app and `domain/coop-import.ts` does the normalising.
The only conversions here are representational: dates → ISO, numbers → their
plain string, empty → "". Rows are padded to the sheet's widest row so the
web side can index columns without bounds checks.

openpyxl `read_only=True` streams rows (the largest known register is 9.1 MB
with five sheets) and never touches formulas: `data_only=True` yields the
cached value the author saw.
"""

from __future__ import annotations

import io
from datetime import date, datetime

import openpyxl

MAX_XLSX_BYTES = 12 * 1024 * 1024  # largest known register: 9.1 MB, 5 sheets
# Rows per sheet, not bytes: a small compressed XLSX can unfold into millions of
# cells (review 1 §10). Largest known sheet: ~320 rows; Dębiecka's six stacked
# copies of one base ≈ 1 000. 50 000 is two orders above any register.
MAX_ROWS_PER_SHEET = 50_000

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class NotAWorkbook(ValueError):
    """The bytes are not an XLSX workbook (XLS/CSV/PDF/scan) — not retryable."""


class TooManyRows(ValueError):
    """A sheet exceeds MAX_ROWS_PER_SHEET — a register never does; refuse, do not swap."""


def cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        # A date cell with no time part is a date; anything else keeps the time.
        return (
            value.date().isoformat() if value.time() == datetime.min.time() else value.isoformat()
        )
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def read_sheets(data: bytes) -> list[dict]:
    try:
        workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # openpyxl raises a zoo: BadZipFile, InvalidFileException, KeyError…
        raise NotAWorkbook(type(exc).__name__) from exc
    sheets = []
    for ws in workbook.worksheets:
        rows = []
        for row in ws.iter_rows(values_only=True):
            if len(rows) >= MAX_ROWS_PER_SHEET:
                workbook.close()
                raise TooManyRows(ws.title)
            rows.append([cell_text(v) for v in row])
        cols = max((len(r) for r in rows), default=0)
        sheets.append(
            {"name": ws.title, "cols": cols, "rows": [r + [""] * (cols - len(r)) for r in rows]}
        )
    workbook.close()
    return sheets
