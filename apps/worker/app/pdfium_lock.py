"""The single PDFium lock of this process.

PDFium is not thread-safe (pypdfium2 docs, "Incompatibility with Threading"),
and sync handlers run in Starlette's threadpool: parallel uploads without this
lock crash the whole worker process (SIGBUS/SIGSEGV), /kw-transcribe and prose
included. Every PDFium call — open to close — happens under it, in every module.
"""

import threading

PDFIUM_LOCK = threading.Lock()
