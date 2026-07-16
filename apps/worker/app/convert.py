"""DOCX -> PDF conversion via LibreOffice headless (soffice).

Open Host Service adapter (ADR-009): the worker hosts the heavyweight
native dependency so the web app never needs it. F-11: this module takes
a document IN and returns file bytes OUT — it computes nothing and never
returns a market-value field.
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def resolve_soffice() -> str | None:
    """SOFFICE env override first (macOS app-bundle path), then PATH."""
    env = os.environ.get("SOFFICE")
    if env:
        return env if Path(env).exists() else None
    return shutil.which("soffice")


class ConversionError(Exception):
    pass


def docx_to_pdf(docx: bytes, timeout_s: int = 120) -> bytes:
    soffice = resolve_soffice()
    if soffice is None:
        raise ConversionError("soffice not found (set SOFFICE or install LibreOffice)")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "input.docx"
        src.write_bytes(docx)
        try:
            subprocess.run(
                [
                    soffice,
                    "--headless",
                    # Isolated profile: parallel soffice runs otherwise fight
                    # over the shared user profile and silently fail.
                    f"-env:UserInstallation=file://{tmp}/lo-profile",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmp,
                    str(src),
                ],
                check=True,
                capture_output=True,
                timeout=timeout_s,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise ConversionError(f"soffice failed: {exc}") from exc
        pdf = Path(tmp) / "input.pdf"
        if not pdf.exists():
            raise ConversionError("soffice produced no PDF output")
        return pdf.read_bytes()
