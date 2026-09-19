"""One PDFium lock per process: two locks are no lock (parallel uploads crash the worker)."""

from app import pdf_pages, pdfium_lock


def test_pdf_pages_uses_the_shared_lock():
    assert pdf_pages.PDFIUM_LOCK is pdfium_lock.PDFIUM_LOCK
