"""Insurance policy PDF -> page images for Załącznik nr 1 (user decision 15.09:
policy only as PDF, each page as a full-page image in the operat).

pypdfium2 ships PDFium in its wheel, so no system packages are needed. Render
~150 DPI, JPEG through Pillow (same quality as inspection photos). A page with
an absurd MediaBox is scaled down to MAX_SIDE_PX instead of allocating a giant
bitmap — the PDF counterpart of Pillow's decompression-bomb guard in photo.py.

Pure — no I/O, no FastAPI import (endpoint lives in main.py).
"""

import threading
from io import BytesIO

import pypdfium2 as pdfium

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PAGES = 10
DPI = 150
MAX_SIDE_PX = 2500  # A4 at 150 DPI is 1240 x 1754
JPEG_QUALITY = 85


class TooManyPages(Exception):
    pass


# PDFium is not thread-safe (pypdfium2 docs, "Incompatibility with Threading"),
# and sync handlers run in Starlette's threadpool: parallel uploads without this
# lock crash the whole worker process (SIGBUS/SIGSEGV), /kw-transcribe and prose
# included. Every PDFium call — open to close — happens under it.
_PDFIUM_LOCK = threading.Lock()


def render_pages(data: bytes) -> list[tuple[bytes, int, int]]:
    """(JPEG, width, height) per page, in document order. Raises TooManyPages over
    MAX_PAGES and ValueError for a PDF without pages; PDFium's own error for
    anything unreadable."""
    with _PDFIUM_LOCK:
        pdf = pdfium.PdfDocument(data)
        try:
            if len(pdf) > MAX_PAGES:
                raise TooManyPages(len(pdf))
            if len(pdf) == 0:
                raise ValueError("PDF bez stron")
            pages = []
            for index in range(len(pdf)):
                page = pdf[index]
                width_pt, height_pt = page.get_size()
                scale = min(DPI / 72, MAX_SIDE_PX / max(width_pt, height_pt))
                bitmap = page.render(scale=scale)
                image = bitmap.to_pil().convert("RGB")  # a copy: PDFium memory not kept
                bitmap.close()
                page.close()
                out = BytesIO()
                image.save(out, format="JPEG", quality=JPEG_QUALITY)
                pages.append((out.getvalue(), image.width, image.height))
            return pages
        finally:
            pdf.close()
