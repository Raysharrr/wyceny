"""KW extraction core (Slice 6): pydantic extract schema, PII scrub, LLM
prompt, and HMAC upload-token verification. Pure — no I/O, no anthropic
import here (the API call lives in main.py behind an injectable seam).

F-9 / GDPR: the extract schema has NO fields for parties, names, or PESELs
(minimization by design — layer 1); scrub_extract (layer 2) defensively
strips PESEL-like runs and person-context fragments from the few free-text
fields before the payload leaves the worker process.
"""

import hashlib
import hmac
import re
from typing import Literal

from pydantic import BaseModel, Field

MAX_PDF_BYTES = 32 * 1024 * 1024  # Anthropic request limit

PESEL_RE = re.compile(r"\b\d{11}\b")
# Person-context markers in dział entries; cut from the marker to the next
# delimiter. ponytail: word-list heuristic, not NER — over-cutting is fine
# (the appraiser reviews/edits every entry before confirming).
# Amendment D6: corrected regex — ur\. must not be followed by \b
PERSON_CTX_RE = re.compile(
    r"(?:PESEL\b|urodzon\w+\b|ur\.|syn(?:a|owi)?\b|c[óo]r(?:ka|ki|ce)\b)[^,;.]*",
    re.IGNORECASE,
)
SCRUB_MARK = "[dane osobowe usunięte]"


class KwDzial(BaseModel):
    wpisy: bool = Field(description="czy dzial ma jakiekolwiek wpisy")
    tresc: list[str] = Field(
        default_factory=list,
        description="wpisy dzialu: rodzaj + instytucja + kwota; BEZ osob fizycznych",
    )


class KwExtractPayload(BaseModel):
    docType: Literal["akt", "odpis_kw", "nieznany"] = Field(
        description="akt = akt notarialny; odpis_kw = odpis ksiegi wieczystej; "
        "nieznany = dokument innego rodzaju"
    )
    kwLokalu: str | None = Field(description="nr KW lokalu (null gdy brak, np. deweloperski)")
    kwGruntu: str | None = Field(description="nr KW gruntu / ksiegi macierzystej")
    kwInne: list[str] = Field(default_factory=list, description="inne nr KW (garaz itp.)")
    deweloperski: bool = Field(default=False, description="lokal bez wlasnej KW (ksiega matka)")
    powUzytkowaKw: float | None = Field(
        description="powierzchnia uzytkowa w m2 — TYLKO gdy wpisana wprost liczba"
    )
    powPrzezOdwolanie: bool = Field(
        default=False,
        description="true gdy powierzchnia okreslona wylacznie odwolaniem do KW",
    )
    udzial: str | None = Field(description="udzial w nieruchomosci wspolnej, np. 1234/56789")
    sad: str | None = Field(description="sad rejonowy prowadzacy ksiegi")
    wydzial: str | None = Field(description="wydzial ksiag wieczystych")
    dataDokumentu: str | None = Field(description="data dokumentu RRRR-MM-DD")
    dzial3: KwDzial | None = Field(description="odpis: dzial III (prawa/roszczenia/ograniczenia)")
    dzial4: KwDzial | None = Field(description="odpis: dzial IV (hipoteki)")


EXTRACTION_PROMPT = """Przeanalizuj załączony polski dokument (akt notarialny albo odpis księgi wieczystej — może być skan lub zdjęcie).
Wyekstrahuj pola wg schematu. Jeśli pole nie występuje w dokumencie, zwróć null.
Powierzchnię użytkową podaj TYLKO jeśli jest wpisana wprost liczbą (nie przez odwołanie do KW).
Numery KW podawaj w pełnym formacie: kod sądu / 8 cyfr / cyfra kontrolna.
W treści wpisów działów III i IV podawaj wyłącznie rodzaj wpisu, instytucję (bank, spółdzielnia, gmina) i kwotę — POMIJAJ osoby fizyczne: żadnych imion, nazwisk ani numerów PESEL.
Jeśli dokument nie jest aktem notarialnym ani odpisem KW, zwróć docType="nieznany"."""


def _scrub_text(text: str) -> str:
    text = PERSON_CTX_RE.sub(SCRUB_MARK, text)
    return PESEL_RE.sub(SCRUB_MARK, text)


def scrub_extract(payload: KwExtractPayload) -> KwExtractPayload:
    """Defensive PII scrub (layer 2) over the free-text fields. Runs BEFORE
    the payload leaves the worker — web/DB/logs never see unscrubbed text."""
    update: dict = {}
    for field in ("udzial", "sad", "wydzial"):
        value = getattr(payload, field)
        if value is not None:
            update[field] = _scrub_text(value)
    for field in ("dzial3", "dzial4"):
        dzial = getattr(payload, field)
        if dzial is not None:
            update[field] = KwDzial(wpisy=dzial.wpisy, tresc=[_scrub_text(t) for t in dzial.tresc])
    return payload.model_copy(update=update)


def verify_token(token: str, secret: str, now: float) -> bool:
    """Stateless HMAC upload token: '<exp_unix>.<nonce>.<hex sig>' where
    sig = HMAC-SHA256(secret, '<exp_unix>.<nonce>'). Web mints (Task 6),
    worker verifies. Constant-time comparison; expired/malformed -> False."""
    parts = token.split(".")
    if len(parts) != 3:
        return False
    exp_s, nonce, signature = parts
    try:
        exp = int(exp_s)
    except ValueError:
        return False
    if exp < now:
        return False
    expected = hmac.new(secret.encode(), f"{exp_s}.{nonce}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
