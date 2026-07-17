# KW Deed/Excerpt Upload + LLM Extraction (Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The "Stan prawny (KW)" form section accepts an uploaded notarial deed or KW excerpt, the worker extracts a PII-minimized snapshot via Claude vision, and the approved operat renders a real KW examination section (both KW numbers, dział III/IV findings, area/share in 8.2) — with manual entry unchanged as fallback.

**Architecture:** Browser uploads the PDF **directly to the worker** (`POST /kw-extract`, HMAC token minted by a web server action — Vercel's 4.5 MB body limit blocks the web path; real deeds are 11–15 MB). Worker calls Anthropic (`claude-sonnet-5`, thinking disabled, structured output), scrubs PII, discards the file, returns a minimized extract. The client seeds the form; on submit the extract persists into write-once `inputs.kw` (jsonb — **zero DDL**) with server-assigned provenance `akt`/`odpis_kw` → `to_verify`, gated by F-4.

**Tech Stack:** Next.js 16 (App Router, server actions), react-hook-form + zod 4, FastAPI + pydantic, `anthropic` Python SDK, docxtemplater, vitest (+ NEW: jsdom + React Testing Library), pytest.

**Spec:** `docs/superpowers/specs/2026-07-17-kw-akt-ekstrakcja-design.md` (approved 2026-07-17).

## Global Constraints

- Code/comments/commits: **English**; commit subject ≤100 chars, conventional, lowercase-leading. NO tool attribution in commits.
- UI copy and operat content: **Polish with full diacritics**.
- **No network/LLM calls in CI tests** — anthropic client is always monkeypatched; fixtures are synthetic.
- **F-9:** no PESELs (11-digit runs), no full KW numbers matching `[A-Z]{2}[0-9][A-Z]/[0-9]{8}/[0-9]` anywhere in committed files (incl. test fixtures — use `AB1C/000…` breaking shapes like `PO1P/…/6` instead). `scripts/check-no-pii.sh` runs in CI.
- **F-11 untouched:** worker returns data, never computes WR.
- Invisible chars (NBSP) only as escape sequences; the Edit tool converts escapes to live NBSP — **write such fragments via Python file I/O**.
- Per-task gates: web `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`; worker `cd apps/worker && uv run ruff check . && uv run ruff format --check . && uv run pytest -q`. Commit + `git push` per task, then `gh run watch --exit-status`.
- Focused web tests: `pnpm --filter web exec vitest run <path>` (a bare `-- <pattern>` does NOT filter in this repo).
- Template regenerates ONLY via wiki-repo `tools/spike/2026-07-15-template-koscielna/build_template.py`. Never hand-edit the .docx.
- Ports/adapters: adapters import ports **relatively** (`../ports/x`); only `app/`/`_deps` use `@/`.

## File Structure (new/modified)

```
apps/worker/app/kw.py                        NEW  pure core: extract schema, scrub, prompt, token verify
apps/worker/app/main.py                      MOD  POST /kw-extract + CORS middleware
apps/worker/pyproject.toml                   MOD  + anthropic, python-multipart
apps/worker/tests/test_kw_core.py            NEW  scrub/token unit tests (F-9)
apps/worker/tests/test_kw_extract.py         NEW  endpoint tests (mocked extractor)
packages: (no kernel changes — ProvenanceSource already has "akt"/"odpis_kw")
apps/web/src/domain/kw-snapshot.ts           NEW  KwSnapshot/KwMetaSnapshot types
apps/web/src/domain/kcs.ts                   MOD  KcsInput += kw?: KwSnapshot|null, kwMeta?
apps/web/src/domain/provenance.ts            MOD  InputsProvenance.kw, GateInput.kw, gate blockers
apps/web/src/domain/valuation.ts             MOD  confirmKwProvenance
apps/web/src/lib/valuation-form-schema.ts    MOD  kwSchema/kwMetaSchema, kwNumber superRefine
apps/web/src/lib/assign-provenance.ts        MOD  kw group + area-from-document provenance
apps/web/src/app/actions/create-valuation.ts MOD  kwNumber sync from extract
apps/web/src/app/actions/mint-kw-token.ts    NEW  HMAC token mint (server action)
apps/web/src/lib/kw-extract-client.ts        NEW  browser→worker fetch + zod response parse
apps/web/src/app/valuations/new/kw-section.tsx        NEW  picker/upload/banner/warning UI
apps/web/src/app/valuations/new/new-valuation-form.tsx MOD  wire kw-section
apps/web/src/app/valuations/[id]/page.tsx    MOD  KwCard + group badge
apps/web/src/app/valuations/[id]/valuation-actions.tsx MOD  bulk confirm button
apps/web/src/app/actions/confirm-kw.ts       NEW  bulk confirm action
apps/web/src/adapters/valuation-drizzle.ts   MOD  repo confirmKw
apps/web/src/ports/valuation.ts              MOD  PortValuation.confirmKw
apps/web/src/domain/document-model.ts        MOD  DocumentModel kw_* fields
apps/web/tests/kw-*.test.ts, rtl-*.test.tsx  NEW  see tasks
wiki-repo tools/spike/2026-07-15-template-koscielna/build_template.py  MOD  8.2 badanie KW block
apps/web/templates/operat-szablon.docx       REGENERATED
```

---

### Task 1: React Testing Library infra (raised priority — 3 Slice-5 bugs hid here)

**Files:**

- Modify: `apps/web/package.json` (devDependencies)
- Create: `apps/web/tests/rtl-infra.test.tsx`
- Modify: `apps/web/vitest.config.ts` (comment only — jsdom stays per-file)

**Interfaces:**

- Produces: working `// @vitest-environment jsdom` + RTL + user-event pipeline that later tasks' component tests rely on (Task 7 imports `render`, `screen`, `userEvent` the same way).

- [ ] **Step 1: Add dev dependencies**

```bash
cd apps/web && pnpm add -D jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Write the infra-proving test (RED — deps just installed, but component render is the check)**

Create `apps/web/tests/rtl-infra.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@/components/ui/input";

/**
 * RTL infra smoke (Slice 6 Task 1): proves jsdom + RTL + user-event work
 * under vitest in CI. Three Slice-5 bugs (coerce-trap, checkbox data-state,
 * empty-subject) hid exactly in the no-component-test gap this closes.
 */
describe("RTL infra", () => {
  it("renders a ui Input and accepts typed text", async () => {
    render(<Input aria-label="proba" />);
    const input = screen.getByLabelText("proba");
    await userEvent.type(input, "69,56");
    expect(input).toHaveProperty("value", "69,56");
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter web exec vitest run tests/rtl-infra.test.tsx`
Expected: PASS (1 test). If it fails on JSX transform, check that the file extension is `.tsx` — vitest picks up the existing tsconfig JSX settings.

- [ ] **Step 4: Full gate**

Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: all green (new deps are dev-only; `environment: "node"` stays the vitest default — jsdom is opted into per-file via the pragma, so existing node tests are untouched).

- [ ] **Step 5: Commit + push + CI**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/tests/rtl-infra.test.tsx
git commit -m "test: add jsdom + react testing library infra with smoke test"
git push && gh run watch --exit-status
```

---

### Task 2: Worker pure core `kw.py` — extract schema, PII scrub, prompt, token verify

**Files:**

- Create: `apps/worker/app/kw.py`
- Create: `apps/worker/tests/test_kw_core.py`

**Interfaces:**

- Produces (Task 3 imports these exact names from `app.kw`):
  - `class KwDzial(BaseModel)`: `wpisy: bool`, `tresc: list[str]`
  - `class KwExtractPayload(BaseModel)`: `docType: Literal["akt", "odpis_kw", "nieznany"]`, `kwLokalu: str | None`, `kwGruntu: str | None`, `kwInne: list[str]`, `deweloperski: bool`, `powUzytkowaKw: float | None`, `powPrzezOdwolanie: bool`, `udzial: str | None`, `sad: str | None`, `wydzial: str | None`, `dataDokumentu: str | None`, `dzial3: KwDzial | None`, `dzial4: KwDzial | None`
  - `scrub_extract(payload: KwExtractPayload) -> KwExtractPayload`
  - `verify_token(token: str, secret: str, now: float) -> bool`
  - `EXTRACTION_PROMPT: str`
  - `MAX_PDF_BYTES: int = 32 * 1024 * 1024`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/tests/test_kw_core.py`:

```python
"""KW core unit tests (Slice 6 Task 2). F-9: scrub must strip PESELs and
person-context fragments before anything leaves the worker. All fixtures are
SYNTHETIC — no real KW numbers (F-9 regex-breaking shapes only), no real names.
"""

import hashlib
import hmac

from app.kw import EXTRACTION_PROMPT, KwDzial, KwExtractPayload, scrub_extract, verify_token

# F-9: PESEL-like fixtures are BUILT AT RUNTIME from split literals so this
# committed file never contains an 11-digit run (scripts/check-no-pii.sh).
PESEL_A = "85010" + "112345"
PESEL_B = "90020" + "254321"


def payload(**overrides) -> KwExtractPayload:
    base = dict(
        docType="odpis_kw",
        kwLokalu=None,
        kwGruntu=None,
        kwInne=[],
        deweloperski=False,
        powUzytkowaKw=None,
        powPrzezOdwolanie=False,
        udzial=None,
        sad=None,
        wydzial=None,
        dataDokumentu=None,
        dzial3=None,
        dzial4=None,
    )
    base.update(overrides)
    return KwExtractPayload(**base)


class TestScrub:
    def test_pesel_removed_from_dzial_tresc(self):
        p = payload(dzial3=KwDzial(wpisy=True, tresc=[f"roszczenie, PESEL {PESEL_A}, o wpis"]))
        out = scrub_extract(p)
        assert PESEL_A not in out.dzial3.tresc[0]
        assert out.dzial3.wpisy is True

    def test_person_context_fragment_removed(self):
        # "PESEL"/"urodzony"/"syn"/"córka" mark person fragments — cut to next delimiter.
        p = payload(dzial4=KwDzial(wpisy=True, tresc=["hipoteka umowna, syn Jana, kwota 200000 zł"]))
        out = scrub_extract(p)
        assert "Jana" not in out.dzial4.tresc[0]
        assert "hipoteka umowna" in out.dzial4.tresc[0]
        assert "kwota 200000 zł" in out.dzial4.tresc[0]

    def test_institution_entries_survive(self):
        entry = "hipoteka umowna — Bank Przykładowy S.A., 350000 zł"
        p = payload(dzial4=KwDzial(wpisy=True, tresc=[entry]))
        assert scrub_extract(p).dzial4.tresc[0] == entry

    def test_scrub_covers_sad_and_udzial(self):
        p = payload(sad=f"Sąd Rejonowy PESEL {PESEL_B}", udzial=f"1/2 PESEL {PESEL_B}")
        out = scrub_extract(p)
        assert PESEL_B not in out.sad
        assert PESEL_B not in out.udzial

    def test_none_fields_pass_through(self):
        out = scrub_extract(payload())
        assert out.dzial3 is None and out.sad is None


class TestToken:
    SECRET = "test-secret"

    def _mint(self, exp: int, nonce: str = "abcd1234", secret: str | None = None) -> str:
        s = secret or self.SECRET
        sig = hmac.new(s.encode(), f"{exp}.{nonce}".encode(), hashlib.sha256).hexdigest()
        return f"{exp}.{nonce}.{sig}"

    def test_valid_token_accepted(self):
        assert verify_token(self._mint(exp=2000), self.SECRET, now=1000.0) is True

    def test_expired_token_rejected(self):
        assert verify_token(self._mint(exp=500), self.SECRET, now=1000.0) is False

    def test_wrong_secret_rejected(self):
        assert verify_token(self._mint(exp=2000, secret="other"), self.SECRET, now=1000.0) is False

    def test_malformed_token_rejected(self):
        assert verify_token("not-a-token", self.SECRET, now=1000.0) is False
        assert verify_token("1.2", self.SECRET, now=1000.0) is False


class TestPrompt:
    def test_prompt_bans_persons_and_asks_for_institutions(self):
        # The prompt is the FIRST scrub layer — pin its load-bearing clauses.
        assert "osób fizycznych" in EXTRACTION_PROMPT or "osoby fizyczne" in EXTRACTION_PROMPT
        assert "PESEL" in EXTRACTION_PROMPT
        assert "instytucj" in EXTRACTION_PROMPT
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/worker && uv run pytest tests/test_kw_core.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.kw'`

- [ ] **Step 3: Implement `apps/worker/app/kw.py`**

```python
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
PERSON_CTX_RE = re.compile(
    r"(?:PESEL|urodzon\w+|ur\.|syn(?:a|owi)?|c[óo]r(?:ka|ki|ce))\b[^,;.]*",
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/worker && uv run pytest tests/test_kw_core.py -q`
Expected: PASS (11 tests)

- [ ] **Step 5: Worker gate**

Run: `cd apps/worker && uv run ruff check . && uv run ruff format --check . && uv run pytest -q`
Expected: all green

- [ ] **Step 6: Commit + push + CI**

```bash
git add apps/worker/app/kw.py apps/worker/tests/test_kw_core.py
git commit -m "feat: kw extraction core - schema, pii scrub, hmac token verify (f-9)"
git push && gh run watch --exit-status
```

---

### Task 3: Worker `POST /kw-extract` endpoint + CORS + anthropic seam

**Files:**

- Modify: `apps/worker/app/main.py`
- Modify: `apps/worker/pyproject.toml`
- Create: `apps/worker/tests/test_kw_extract.py`

**Interfaces:**

- Consumes: `app.kw` exports from Task 2.
- Produces: `POST /kw-extract` — multipart form: `file` (PDF), `token` (str), `expected_type` (`"akt" | "odpis_kw"`). Success 200 JSON: `{"extract": <KwExtractPayload sans docType-nieznany>, "docTypeDetected": "akt"|"odpis_kw", "typeMismatch": bool, "model": "claude-sonnet-5"}`. Errors: 401 (token), 413 (size), 415 (not PDF), 422 (unrecognized doc, non-retryable), 502 (upstream, retryable) — all with Polish `detail`.
- Produces: module seam `main._extract_kw_payload(pdf_b64: str) -> KwExtractPayload` (tests monkeypatch THIS; the real body calls anthropic).

- [ ] **Step 1: Add dependencies**

```bash
cd apps/worker && uv add anthropic python-multipart
```

- [ ] **Step 2: Write failing endpoint tests**

Create `apps/worker/tests/test_kw_extract.py`:

```python
"""/kw-extract endpoint tests (Slice 6 Task 3). The anthropic call is always
monkeypatched (`main._extract_kw_payload`) — no network/LLM in CI. Fixtures
synthetic; KW-number shapes broken per F-9 (no [A-Z]{2}\\d[A-Z]/\\d{8}/\\d)."""

import hashlib
import hmac
import time

import pytest
from fastapi.testclient import TestClient

from app import main
from app.kw import KwDzial, KwExtractPayload

# F-9: runtime-built PESEL (no 11-digit run in the committed file).
PESEL_A = "85010" + "112345"

client = TestClient(main.app)

SECRET = "test-secret"


def mint(exp_offset: int = 300) -> str:
    exp = int(time.time()) + exp_offset
    nonce = "cafe0123"
    sig = hmac.new(SECRET.encode(), f"{exp}.{nonce}".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{nonce}.{sig}"


def fake_payload(**overrides) -> KwExtractPayload:
    base = dict(
        docType="akt",
        kwLokalu="AB1C/1/9",  # F-9-safe synthetic shape? NO — see note below
        kwGruntu=None,
        kwInne=[],
        deweloperski=False,
        powUzytkowaKw=69.56,
        powPrzezOdwolanie=False,
        udzial="1234/56789",
        sad="Sąd Rejonowy Poznań — Stare Miasto",
        wydzial="VI Wydział Ksiąg Wieczystych",
        dataDokumentu="2026-05-11",
        dzial3=None,
        dzial4=None,
    )
    base.update(overrides)
    return KwExtractPayload(**base)


@pytest.fixture(autouse=True)
def secret_env(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)


def post(token: str, content: bytes = b"%PDF-1.4 test", expected_type: str = "akt"):
    return client.post(
        "/kw-extract",
        data={"token": token, "expected_type": expected_type},
        files={"file": ("akt.pdf", content, "application/pdf")},
    )


def test_happy_path_scrubs_and_returns_extract(monkeypatch):
    dz3 = KwDzial(wpisy=True, tresc=[f"roszczenie, PESEL {PESEL_A}, o wpis"])
    monkeypatch.setattr(main, "_extract_kw_payload", lambda pdf_b64: fake_payload(dzial3=dz3))
    resp = post(mint())
    assert resp.status_code == 200
    body = resp.json()
    assert body["docTypeDetected"] == "akt"
    assert body["typeMismatch"] is False
    assert body["extract"]["powUzytkowaKw"] == 69.56
    # scrub ran inside the endpoint: PESEL never leaves the worker
    assert PESEL_A not in body["extract"]["dzial3"]["tresc"][0]


def test_invalid_token_401():
    assert post("1.2.3").status_code == 401


def test_expired_token_401():
    assert post(mint(exp_offset=-10)).status_code == 401


def test_non_pdf_415(monkeypatch):
    monkeypatch.setattr(main, "_extract_kw_payload", lambda pdf_b64: fake_payload())
    resp = client.post(
        "/kw-extract",
        data={"token": mint(), "expected_type": "akt"},
        files={"file": ("kot.jpg", b"\xff\xd8\xff", "image/jpeg")},
    )
    assert resp.status_code == 415


def test_oversize_413(monkeypatch):
    monkeypatch.setattr(main, "kw_max_bytes", lambda: 10)  # shrink limit for the test
    assert post(mint(), content=b"%PDF" + b"x" * 20).status_code == 413


def test_unknown_doc_422_non_retryable(monkeypatch):
    monkeypatch.setattr(
        main, "_extract_kw_payload", lambda pdf_b64: fake_payload(docType="nieznany")
    )
    resp = post(mint())
    assert resp.status_code == 422
    assert "nie wygląda" in resp.json()["detail"]


def test_upstream_error_502_polish_detail(monkeypatch):
    def boom(pdf_b64):
        raise RuntimeError("anthropic down")

    monkeypatch.setattr(main, "_extract_kw_payload", boom)
    resp = post(mint())
    assert resp.status_code == 502
    assert "spróbuj ponownie" in resp.json()["detail"].lower()


def test_type_mismatch_flagged_not_errored(monkeypatch):
    monkeypatch.setattr(
        main, "_extract_kw_payload", lambda pdf_b64: fake_payload(docType="odpis_kw")
    )
    resp = post(mint(), expected_type="akt")
    assert resp.status_code == 200
    assert resp.json()["typeMismatch"] is True


def test_developer_variant_forced_when_akt_without_kw_lokalu(monkeypatch):
    monkeypatch.setattr(
        main,
        "_extract_kw_payload",
        lambda pdf_b64: fake_payload(kwLokalu=None, deweloperski=False),
    )
    body = post(mint()).json()
    assert body["extract"]["deweloperski"] is True
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/worker && uv run pytest tests/test_kw_extract.py -q`
Expected: FAIL — 404 (no `/kw-extract` route) / AttributeError on `_extract_kw_payload`

- [ ] **Step 4: Implement endpoint in `apps/worker/app/main.py`**

Add imports at top (merge with existing): `import base64`, `import os`, `import time`, `from fastapi import File, Form, UploadFile`, `from fastapi.middleware.cors import CORSMiddleware`, `from app import kw as kw_core` (follow the file's existing import style for `rcn`/`subject`). Then:

```python
# CORS: the KW upload posts directly from the browser (Vercel 4.5 MB body
# limit forces the web bypass — spec §Architektura). Scoped by origin, not
# by route; the only state-changing endpoints are token-gated anyway.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.environ.get("CORS_ALLOW_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ],
    allow_methods=["POST"],
    allow_headers=["*"],
)


class KwExtractResponse(BaseModel):
    extract: kw_core.KwExtractPayload
    docTypeDetected: str
    typeMismatch: bool
    model: str


KW_MODEL = "claude-sonnet-5"


def kw_max_bytes() -> int:
    # Seam for tests (shrinking the limit beats allocating 32 MB fixtures).
    return kw_core.MAX_PDF_BYTES


def _extract_kw_payload(pdf_b64: str) -> kw_core.KwExtractPayload:
    """The ONLY anthropic touchpoint — monkeypatched in every CI test.
    thinking disabled: spike showed identical quality, pure-JSON output."""
    import anthropic

    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from worker env (Railway secret)
    response = client.messages.parse(
        model=KW_MODEL,
        max_tokens=4096,
        thinking={"type": "disabled"},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {"type": "text", "text": kw_core.EXTRACTION_PROMPT},
                ],
            }
        ],
        output_format=kw_core.KwExtractPayload,
    )
    if response.parsed_output is None:
        raise RuntimeError(f"kw extraction returned no parsed output ({response.stop_reason})")
    return response.parsed_output


@app.post("/kw-extract")
def kw_extract(
    file: UploadFile = File(...),
    token: str = Form(...),
    expected_type: str = Form(...),
) -> KwExtractResponse:
    secret = os.environ.get("WORKER_SHARED_SECRET", "")
    if not secret or not kw_core.verify_token(token, secret, time.time()):
        raise HTTPException(
            status_code=401,
            detail="Nieprawidłowy lub wygasły token — odśwież stronę i spróbuj ponownie.",
        )
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Obsługiwane są wyłącznie pliki PDF.")
    data = file.file.read()
    if len(data) > kw_max_bytes():
        raise HTTPException(status_code=413, detail="Plik jest za duży (limit 32 MB).")

    try:
        payload = _extract_kw_payload(base64.standard_b64encode(data).decode())
    except Exception as exc:
        logger.error("kw extraction failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Nie udało się odczytać dokumentu — spróbuj ponownie albo wpisz dane ręcznie.",
        ) from exc
    # File bytes are never persisted or logged: `data` dies with this request.

    if payload.docType == "nieznany":
        raise HTTPException(
            status_code=422,
            detail="To nie wygląda na akt notarialny ani odpis księgi wieczystej.",
        )

    payload = kw_core.scrub_extract(payload)
    if payload.docType == "akt" and payload.kwLokalu is None:
        payload = payload.model_copy(update={"deweloperski": True})

    return KwExtractResponse(
        extract=payload,
        docTypeDetected=payload.docType,
        typeMismatch=payload.docType != expected_type,
        model=KW_MODEL,
    )
```

Notes for the implementer: `main.py` already has `logger`, `HTTPException`, `BaseModel` imported — merge, don't duplicate. Sync `def` (not `async`) mirrors `/convert-to-pdf` — FastAPI runs it in the threadpool, so the blocking anthropic call can't stall `/health`.

- [ ] **Step 5: Run tests**

Run: `cd apps/worker && uv run pytest tests/test_kw_extract.py -q`
Expected: PASS (9 tests)

- [ ] **Step 6: Full worker gate + F-9 scan**

Run: `cd apps/worker && uv run ruff check . && uv run ruff format --check . && uv run pytest -q && cd ../.. && bash scripts/check-no-pii.sh`
Expected: all green, F-9 OK

- [ ] **Step 7: Commit + push + CI**

```bash
git add apps/worker/app/main.py apps/worker/pyproject.toml apps/worker/uv.lock apps/worker/tests/test_kw_extract.py
git commit -m "feat: kw-extract endpoint - hmac gate, cors, anthropic seam, error taxonomy"
git push && gh run watch --exit-status
```

---

### Task 4: Web domain — `KwSnapshot`, gate blockers (F-4), `confirmKwProvenance`

**Files:**

- Create: `apps/web/src/domain/kw-snapshot.ts`
- Modify: `apps/web/src/domain/kcs.ts` (KcsInput — add fields next to `subject`/`subjectMeta`)
- Modify: `apps/web/src/domain/provenance.ts`
- Modify: `apps/web/src/domain/valuation.ts`
- Modify: `apps/web/tests/f4-approval-gate.test.ts` (add cases)
- Modify: `apps/web/tests/valuation-lifecycle.test.ts` (add cases)

**Interfaces:**

- Produces:
  - `KwDzialSnapshot = { wpisy: boolean; tresc: string[] }`
  - `KwSnapshot = { source: "akt" | "odpis_kw"; kwLokalu: string | null; kwGruntu: string | null; kwInne: string[]; deweloperski: boolean; powUzytkowaKw: number | null; udzial: string | null; sad: string | null; wydzial: string | null; dataDokumentu: string | null; dzial3: KwDzialSnapshot | null; dzial4: KwDzialSnapshot | null }`
  - `KwMetaSnapshot = { model: string; extractedAt: string; docTypeDetected: "akt" | "odpis_kw"; docTypeDeclared: "akt" | "odpis_kw" }`
  - `KcsInput` gains `kw?: KwSnapshot | null; kwMeta?: KwMetaSnapshot | null`
  - `InputsProvenance` gains `kw?: Provenance`
  - `GateInput` gains `kw?: { source: "akt" | "odpis_kw"; kwLokalu: string | null; kwGruntu: string | null; deweloperski: boolean } | null`
  - `confirmKwProvenance(v: Valuation): Valuation` in `domain/valuation.ts`
- Note: the `kw` snapshot exists ONLY for document-sourced data. Manual entry keeps using the existing `kwNumber` column — no kw object, no new gate checks (deliberate simplification vs the spec's `"reczne"` enum member; the spec's intent — manual unchanged — is preserved).

- [ ] **Step 1: Write failing gate tests** — append to `apps/web/tests/f4-approval-gate.test.ts` (follow the file's existing helper style for building a passing GateInput; the cases below assume a helper `passingInput()` exists or inline the minimal object the file already uses):

```typescript
describe("kw group (Slice 6)", () => {
  const kwOk = {
    source: "akt" as const,
    kwLokalu: "AB1C/1/9",
    kwGruntu: "AB1C/2/7",
    deweloperski: false,
  };

  it("blocks when kw snapshot present but provenance kw missing (default-deny)", () => {
    const result = approvalGate({ ...passingInput(), kw: kwOk });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.some((b) => b.path === "provenance.kw")).toBe(true);
    }
  });

  it("blocks on to_verify, passes on confirmed", () => {
    const base = passingInput();
    const toVerify = approvalGate({
      ...base,
      kw: kwOk,
      provenance: { ...base.provenance!, kw: { source: "akt", status: "to_verify" } },
    });
    expect(toVerify.ok).toBe(false);
    const confirmed = approvalGate({
      ...base,
      kw: kwOk,
      provenance: { ...base.provenance!, kw: { source: "akt", status: "confirmed" } },
    });
    expect(confirmed.ok).toBe(true);
  });

  it("blocks missing kwGruntu and missing kwLokalu (non-developer)", () => {
    const base = passingInput();
    const prov = {
      ...base.provenance!,
      kw: { source: "akt" as const, status: "confirmed" as const },
    };
    const noGrunt = approvalGate({ ...base, provenance: prov, kw: { ...kwOk, kwGruntu: null } });
    expect(noGrunt.ok).toBe(false);
    const noLokal = approvalGate({ ...base, provenance: prov, kw: { ...kwOk, kwLokalu: null } });
    expect(noLokal.ok).toBe(false);
  });

  it("developer variant: missing kwLokalu is fine when deweloperski", () => {
    const base = passingInput();
    const result = approvalGate({
      ...base,
      provenance: { ...base.provenance!, kw: { source: "akt", status: "confirmed" } },
      kw: { ...kwOk, kwLokalu: null, deweloperski: true },
    });
    expect(result.ok).toBe(true);
  });

  it("no kw snapshot -> no kw blockers (manual path regression)", () => {
    expect(approvalGate(passingInput()).ok).toBe(true);
  });
});
```

And to `apps/web/tests/valuation-lifecycle.test.ts` (mirror the file's existing `confirmSubjectProvenance` cases):

```typescript
describe("confirmKwProvenance (Slice 6)", () => {
  it("flips kw and document-sourced area to confirmed, leaves others", () => {
    const v = draftWith({
      inputs: {
        ...baseInputs(),
        provenance: {
          ...baseProvenance(),
          kw: { source: "akt", status: "to_verify" },
          area: { source: "akt", status: "to_verify" },
        },
      },
    });
    const out = confirmKwProvenance(v);
    expect(out.inputs!.provenance!.kw!.status).toBe("confirmed");
    expect(out.inputs!.provenance!.area.status).toBe("confirmed");
  });

  it("does not touch manual area provenance", () => {
    const v = draftWith({
      inputs: {
        ...baseInputs(),
        provenance: {
          ...baseProvenance(), // area: rzeczoznawca/confirmed
          kw: { source: "odpis_kw", status: "to_verify" },
        },
      },
    });
    const out = confirmKwProvenance(v);
    expect(out.inputs!.provenance!.area.source).toBe("rzeczoznawca");
  });

  it("throws on non-draft and on missing inputs (F-7 guards)", () => {
    expect(() => confirmKwProvenance(approvedValuation())).toThrow();
    expect(() => confirmKwProvenance(draftWith({ inputs: null }))).toThrow();
  });
});
```

(Use the file's actual helper names — `draftWith`/`baseInputs`/`baseProvenance`/`approvedValuation` or their local equivalents; do not invent parallel helpers.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run tests/f4-approval-gate.test.ts tests/valuation-lifecycle.test.ts`
Expected: FAIL — `kw` not in GateInput / `confirmKwProvenance` not exported

- [ ] **Step 3: Implement**

Create `apps/web/src/domain/kw-snapshot.ts`:

```typescript
/**
 * KW snapshot (Slice 6) — the PII-minimized extract from an uploaded deed
 * (akt) or KW excerpt (odpis_kw), mirrored from the worker's
 * KwExtractPayload. Exists ONLY for document-sourced data; manual entry
 * keeps using the flat `kwNumber` field.
 */
export type KwDzialSnapshot = { wpisy: boolean; tresc: string[] };

export type KwSnapshot = {
  source: "akt" | "odpis_kw";
  kwLokalu: string | null;
  kwGruntu: string | null;
  kwInne: string[];
  deweloperski: boolean;
  powUzytkowaKw: number | null;
  udzial: string | null;
  sad: string | null;
  wydzial: string | null;
  dataDokumentu: string | null;
  dzial3: KwDzialSnapshot | null;
  dzial4: KwDzialSnapshot | null;
};

export type KwMetaSnapshot = {
  model: string;
  extractedAt: string;
  docTypeDetected: "akt" | "odpis_kw";
  docTypeDeclared: "akt" | "odpis_kw";
};
```

In `apps/web/src/domain/kcs.ts`: add to `KcsInput` (next to `subject`/`subjectMeta`, same optional-nullable style):

```typescript
  kw?: KwSnapshot | null;
  kwMeta?: KwMetaSnapshot | null;
```

with `import type { KwSnapshot, KwMetaSnapshot } from "./kw-snapshot";`.

In `apps/web/src/domain/provenance.ts`: add to `InputsProvenance`:

```typescript
  /** Present only when a KW extract (deed/excerpt upload) was attached. */
  kw?: Provenance;
```

add to `GateInput`:

```typescript
  kw?: {
    source: "akt" | "odpis_kw";
    kwLokalu: string | null;
    kwGruntu: string | null;
    deweloperski: boolean;
  } | null;
```

and append to `approvalGate` body, after the subject block, before the return:

```typescript
// KW extract (deed/excerpt upload): gated whenever a kw snapshot exists.
// Manual kwNumber entry attaches no snapshot and adds no blockers here.
if (input.kw != null) {
  const kwProv = input.provenance?.kw;
  const sK = sourced("kw", kwProv?.source ?? input.kw.source, kwProv?.status ?? "none");
  if (isBlocking(sK)) {
    blockers.push({
      path: "provenance.kw",
      label: `Stan prawny (KW) — ${statusLabel(kwProv?.status ?? "none")}.`,
    });
  }
  if (!input.kw.kwGruntu) {
    blockers.push({
      path: "kw.kwGruntu",
      label: "Numer KW gruntu (księgi macierzystej) — brak.",
    });
  }
  if (!input.kw.kwLokalu && !input.kw.deweloperski) {
    blockers.push({
      path: "kw.kwLokalu",
      label:
        "Numer KW lokalu — brak (zaznacz wariant deweloperski, jeśli lokal nie ma własnej księgi).",
    });
  }
}
```

In `apps/web/src/domain/valuation.ts`: add (mirroring `confirmSubjectProvenance`):

```typescript
/**
 * Mirrors `confirmSubjectProvenance` for the KW extract group: flips `kw`
 * — and `area` when the area was seeded from the document (source akt /
 * odpis_kw) — from to_verify to confirmed. Draft-only (F-7),
 * throw-on-missing-inputs, byte-for-byte like its siblings.
 */
export function confirmKwProvenance(valuation: Valuation): Valuation {
  assertDraft(valuation);
  if (!valuation.inputs) {
    throw new Error(`Valuation ${valuation.id} has no inputs snapshot — nothing to confirm`);
  }
  const { provenance: p } = valuation.inputs;
  const areaFromDoc = p?.area && (p.area.source === "akt" || p.area.source === "odpis_kw");
  const provenance = p
    ? {
        ...p,
        ...(p.kw ? { kw: { ...p.kw, status: "confirmed" as const } } : {}),
        ...(areaFromDoc ? { area: { ...p.area, status: "confirmed" as const } } : {}),
      }
    : p;
  return { ...valuation, inputs: { ...valuation.inputs, provenance } };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web exec vitest run tests/f4-approval-gate.test.ts tests/valuation-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Full web gate**

Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: all green

- [ ] **Step 6: Commit + push + CI**

```bash
git add apps/web/src/domain apps/web/tests/f4-approval-gate.test.ts apps/web/tests/valuation-lifecycle.test.ts
git commit -m "feat: kw snapshot domain type, f-4 kw blockers, confirmKwProvenance"
git push && gh run watch --exit-status
```

---

### Task 5: Form schema + `assignProvenance` + `createValuation` kwNumber sync

**Files:**

- Modify: `apps/web/src/lib/valuation-form-schema.ts`
- Modify: `apps/web/src/lib/assign-provenance.ts`
- Modify: `apps/web/src/app/actions/create-valuation.ts`
- Modify: `apps/web/tests/valuation-form-schema.test.ts`, `apps/web/tests/assign-provenance.test.ts`, `apps/web/tests/create-valuation-action.test.ts` (add cases)

**Interfaces:**

- Consumes: `KwSnapshot`/`KwMetaSnapshot` (Task 4).
- Produces:
  - `kwSchema`/`kwMetaSchema` zod objects mirroring `KwSnapshot`/`KwMetaSnapshot` exactly (same field names/nullability); `valuationFormSchema` gains `kw: kwSchema.optional()`, `kwMeta: kwMetaSchema.optional()`.
  - `kwNumber` becomes optional in the schema; a `superRefine` requires it **only when `kw` is absent** (manual path message unchanged: "Podaj numer księgi wieczystej.").
  - `assignProvenance` accepts `Pick<..., "comparables" | "sampleMeta" | "subject" | "subjectMeta" | "kw" | "kwMeta" | "area">` and returns `provenance` with: `kw: { source: kw.source, status: "to_verify" }` when `kw` present; `area: { source: kw.source, status: "to_verify" }` when `kw.powUzytkowaKw != null` AND `Number(values.area) === kw.powUzytkowaKw` (the auto-filled/accepted document value); otherwise area stays `{ source: "rzeczoznawca", status: "confirmed" }`.
  - `createValuation` persists `inputs.kw`/`inputs.kwMeta` and syncs the column: `kwNumber: values.kwNumber?.trim() || values.kw?.kwLokalu || values.kw?.kwGruntu || null` (never null in practice — schema guarantees one of the two paths).

- [ ] **Step 1: Write failing tests** (append; follow each file's existing fixture style)

`valuation-form-schema.test.ts`:

```typescript
describe("kw section (Slice 6)", () => {
  const kwValid = {
    source: "akt" as const,
    kwLokalu: "AB1C/1/9",
    kwGruntu: "AB1C/2/7",
    kwInne: [],
    deweloperski: false,
    powUzytkowaKw: 69.56,
    udzial: "1234/56789",
    sad: "Sąd Rejonowy",
    wydzial: "VI Wydział Ksiąg Wieczystych",
    dataDokumentu: "2026-05-11",
    dzial3: null,
    dzial4: null,
  };

  it("accepts a form with kw extract and NO kwNumber", () => {
    const parsed = valuationFormSchema.safeParse({
      ...validForm(),
      kwNumber: undefined,
      kw: kwValid,
    });
    expect(parsed.success).toBe(true);
  });

  it("still requires kwNumber when no kw extract (manual path)", () => {
    const parsed = valuationFormSchema.safeParse({ ...validForm(), kwNumber: undefined });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join(".") === "kwNumber")).toBe(true);
    }
  });
});
```

`assign-provenance.test.ts`:

```typescript
describe("kw provenance (Slice 6)", () => {
  it("kw extract -> kw group to_verify; area matching extract -> doc-sourced to_verify", () => {
    const { provenance } = assignProvenance({
      ...baseValues(),
      area: 69.56,
      kw: { ...kwFixture(), source: "odpis_kw", powUzytkowaKw: 69.56 },
    });
    expect(provenance.kw).toEqual({ source: "odpis_kw", status: "to_verify" });
    expect(provenance.area).toEqual({ source: "odpis_kw", status: "to_verify" });
  });

  it("area differing from extract stays rzeczoznawca/confirmed", () => {
    const { provenance } = assignProvenance({
      ...baseValues(),
      area: 70,
      kw: { ...kwFixture(), powUzytkowaKw: 69.56 },
    });
    expect(provenance.area).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  });

  it("no kw -> no kw provenance entry (regression)", () => {
    const { provenance } = assignProvenance(baseValues());
    expect(provenance.kw).toBeUndefined();
  });
});
```

`create-valuation-action.test.ts` — one integration case: submit with `kw` present and no `kwNumber`; assert the persisted row has `inputs.kw.source === "akt"`, `inputs.kwMeta.model` set, and `kwNumber === kw.kwLokalu` (the sync). Follow the file's existing create-and-read pattern against the test Postgres.

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter web exec vitest run tests/valuation-form-schema.test.ts tests/assign-provenance.test.ts tests/create-valuation-action.test.ts`
Expected: FAIL (unknown key `kw`, missing provenance entries)

- [ ] **Step 3: Implement**

`valuation-form-schema.ts` — add above `valuationFormSchema`:

```typescript
/** Mirrors `KwDzialSnapshot`/`KwSnapshot` from `@/domain/kw-snapshot` (Slice 6). */
export const kwDzialSchema = z.object({ wpisy: z.boolean(), tresc: z.array(z.string()) });

export const kwSchema = z.object({
  source: z.enum(["akt", "odpis_kw"]),
  kwLokalu: z.string().nullable(),
  kwGruntu: z.string().nullable(),
  kwInne: z.array(z.string()),
  deweloperski: z.boolean(),
  powUzytkowaKw: z.number().nullable(),
  udzial: z.string().nullable(),
  sad: z.string().nullable(),
  wydzial: z.string().nullable(),
  dataDokumentu: z.string().nullable(),
  dzial3: kwDzialSchema.nullable(),
  dzial4: kwDzialSchema.nullable(),
});

/** Mirrors `KwMetaSnapshot` from `@/domain/kw-snapshot`. */
export const kwMetaSchema = z.object({
  model: z.string(),
  extractedAt: z.string(),
  docTypeDetected: z.enum(["akt", "odpis_kw"]),
  docTypeDeclared: z.enum(["akt", "odpis_kw"]),
});
```

Inside `valuationFormSchema`: add `kw: kwSchema.optional(), kwMeta: kwMetaSchema.optional(),` and change `kwNumber` to `kwNumber: z.string().trim().optional(),`. Then wrap the whole object with:

```typescript
.superRefine((values, ctx) => {
  if (!values.kw && !values.kwNumber) {
    ctx.addIssue({
      code: "custom",
      path: ["kwNumber"],
      message: "Podaj numer księgi wieczystej.",
    });
  }
})
```

(If downstream code uses `valuationFormSchema.pick(...)`, note zod's `.pick` doesn't exist on a `ZodEffects` — keep the base object exported as `valuationFormObject` and define `valuationFormSchema = valuationFormObject.superRefine(...)`; update the one `.pick({ address: true })` call site in `get-subject-data.ts` to use `valuationFormObject.pick(...)`.)

`assign-provenance.ts` — extend the `Pick` with `"kw" | "kwMeta" | "area"` and, in the returned provenance object, replace the fixed `area` entry and add `kw`:

```typescript
  const areaFromDocument =
    values.kw != null &&
    values.kw.powUzytkowaKw != null &&
    Number(values.area) === values.kw.powUzytkowaKw;

  // ...inside the provenance object literal:
    area: areaFromDocument
      ? { source: values.kw!.source, status: "to_verify" }
      : { source: "rzeczoznawca", status: "confirmed" },
    ...(values.kw ? { kw: { source: values.kw.source, status: "to_verify" } } : {}),
```

`create-valuation.ts` — where the `inputs` snapshot object is built (next to `subject`/`subjectMeta`): add `kw: values.kw ?? null, kwMeta: values.kwMeta ?? null,` (normalize absent→null like `subject`), and where `NewValuationInput.kwNumber` is set:

```typescript
    kwNumber: values.kwNumber?.trim() || values.kw?.kwLokalu || values.kw?.kwGruntu || null,
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web exec vitest run tests/valuation-form-schema.test.ts tests/assign-provenance.test.ts tests/create-valuation-action.test.ts`
Expected: PASS

- [ ] **Step 5: Full gate, commit + push + CI**

```bash
pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise
git add apps/web/src/lib apps/web/src/app/actions/create-valuation.ts apps/web/src/app/actions/get-subject-data.ts apps/web/tests
git commit -m "feat: kw form schema, provenance assignment, kwNumber sync on create"
git push && gh run watch --exit-status
```

---

### Task 6: Token mint action + browser extract client + contract test

**Files:**

- Create: `apps/web/src/app/actions/mint-kw-token.ts`
- Create: `apps/web/src/lib/kw-extract-client.ts`
- Create: `apps/web/tests/kw-extract-contract.test.ts`
- Create: `apps/web/tests/mint-kw-token.test.ts`

**Interfaces:**

- Produces:
  - `mintKwUploadToken(): Promise<{ token: string } | { error: string }>` — server action; token `"<expUnix>.<nonceHex>.<hmacSha256Hex>"`, TTL 300 s, secret `process.env.WORKER_SHARED_SECRET`. (Worker verifies with `kw.verify_token` — Task 2.)
  - `extractKw(args: { file: File; expectedType: "akt" | "odpis_kw"; token: string; workerUrl: string }): Promise<KwExtractResult>` where `KwExtractResult = { kind: "ok"; extract: KwSnapshot; meta: KwMetaSnapshot; typeMismatch: boolean } | { kind: "invalidDoc"; message: string } | { kind: "error"; message: string; retryable: boolean }` (`KwSnapshot.source` derived from `docTypeDetected`).
  - Worker response wire shape consumed here (from Task 3): `{ extract: {...}, docTypeDetected, typeMismatch, model }`.

- [ ] **Step 1: Write failing tests**

`apps/web/tests/mint-kw-token.test.ts` (node env — verify token math matches the worker's expectation):

```typescript
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth/session", () => ({ getSession: async () => ({ user: "tester" }) }));

import { mintKwUploadToken } from "@/app/actions/mint-kw-token";

describe("mintKwUploadToken", () => {
  beforeEach(() => {
    process.env.WORKER_SHARED_SECRET = "test-secret";
  });

  it("mints exp.nonce.sig with a valid HMAC and ~5 min expiry", async () => {
    const result = await mintKwUploadToken();
    if ("error" in result) throw new Error(result.error);
    const [exp, nonce, sig] = result.token.split(".");
    const expected = createHmac("sha256", "test-secret").update(`${exp}.${nonce}`).digest("hex");
    expect(sig).toBe(expected);
    const ttl = Number(exp) - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(250);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("returns a Polish error when the secret is unset", async () => {
    delete process.env.WORKER_SHARED_SECRET;
    const result = await mintKwUploadToken();
    expect(result).toHaveProperty("error");
  });
});
```

`apps/web/tests/kw-extract-contract.test.ts` (node env; mock global fetch — the contract fixture mirrors the worker's Task-3 response byte-for-byte):

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractKw } from "@/lib/kw-extract-client";

const WIRE_OK = {
  extract: {
    docType: "akt",
    kwLokalu: "AB1C/1/9",
    kwGruntu: "AB1C/2/7",
    kwInne: [],
    deweloperski: false,
    powUzytkowaKw: 69.56,
    powPrzezOdwolanie: false,
    udzial: "1234/56789",
    sad: "Sąd Rejonowy",
    wydzial: "VI Wydział Ksiąg Wieczystych",
    dataDokumentu: "2026-05-11",
    dzial3: { wpisy: false, tresc: [] },
    dzial4: { wpisy: true, tresc: ["hipoteka umowna — Bank Przykładowy S.A., 350000 zł"] },
  },
  docTypeDetected: "akt",
  typeMismatch: false,
  model: "claude-sonnet-5",
};

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

const args = {
  file: new File([new Uint8Array([37, 80, 68, 70])], "akt.pdf", { type: "application/pdf" }),
  expectedType: "akt" as const,
  token: "1.2.3",
  workerUrl: "http://worker.test",
};

describe("extractKw contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps a 200 into KwSnapshot + meta", async () => {
    mockFetch(200, WIRE_OK);
    const result = await extractKw(args);
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.extract.source).toBe("akt");
    expect(result.extract.powUzytkowaKw).toBe(69.56);
    expect(result.extract.dzial4?.tresc[0]).toContain("Bank Przykładowy");
    expect(result.meta.docTypeDeclared).toBe("akt");
    expect(result.typeMismatch).toBe(false);
  });

  it("422 -> invalidDoc with the worker's Polish detail", async () => {
    mockFetch(422, { detail: "To nie wygląda na akt notarialny ani odpis księgi wieczystej." });
    const result = await extractKw(args);
    expect(result.kind).toBe("invalidDoc");
  });

  it("502 -> retryable error; 401 -> non-retryable error", async () => {
    mockFetch(502, { detail: "Nie udało się odczytać dokumentu — spróbuj ponownie." });
    const r502 = await extractKw(args);
    expect(r502).toMatchObject({ kind: "error", retryable: true });
    mockFetch(401, { detail: "Nieprawidłowy lub wygasły token." });
    const r401 = await extractKw(args);
    expect(r401).toMatchObject({ kind: "error", retryable: false });
  });

  it("malformed 200 body -> retryable error (zod guard)", async () => {
    mockFetch(200, { nonsense: true });
    const result = await extractKw(args);
    expect(result.kind).toBe("error");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run tests/mint-kw-token.test.ts tests/kw-extract-contract.test.ts`
Expected: FAIL — modules don't exist

- [ ] **Step 3: Implement**

`apps/web/src/app/actions/mint-kw-token.ts`:

```typescript
"use server";

import { createHmac, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";

const TOKEN_TTL_SECONDS = 300;

/**
 * Mints a short-lived HMAC token for the browser's direct-to-worker KW
 * upload (spec §Architektura: Vercel's 4.5 MB body limit forces the
 * bypass). Stateless: the worker re-derives the signature from the shared
 * secret. Session-gated like every other action.
 */
export async function mintKwUploadToken(): Promise<{ token: string } | { error: string }> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) {
    return { error: "Upload nie jest skonfigurowany — skontaktuj się z administratorem." };
  }
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const nonce = randomBytes(8).toString("hex");
  const signature = createHmac("sha256", secret).update(`${exp}.${nonce}`).digest("hex");
  return { token: `${exp}.${nonce}.${signature}` };
}
```

`apps/web/src/lib/kw-extract-client.ts`:

```typescript
import { z } from "zod";
import { kwDzialSchema } from "@/lib/valuation-form-schema";
import type { KwMetaSnapshot, KwSnapshot } from "@/domain/kw-snapshot";

/**
 * Browser-side client for the worker's POST /kw-extract (Slice 6). Runs in
 * the client component — the file goes straight to the worker (Vercel body
 * limit), authorized by a server-minted HMAC token. The response is
 * zod-validated; on submit the extract is re-validated server-side by
 * `valuationFormSchema` like any other client input.
 */
const wireSchema = z.object({
  extract: z.object({
    docType: z.enum(["akt", "odpis_kw", "nieznany"]),
    kwLokalu: z.string().nullable(),
    kwGruntu: z.string().nullable(),
    kwInne: z.array(z.string()),
    deweloperski: z.boolean(),
    powUzytkowaKw: z.number().nullable(),
    powPrzezOdwolanie: z.boolean(),
    udzial: z.string().nullable(),
    sad: z.string().nullable(),
    wydzial: z.string().nullable(),
    dataDokumentu: z.string().nullable(),
    dzial3: kwDzialSchema.nullable(),
    dzial4: kwDzialSchema.nullable(),
  }),
  docTypeDetected: z.enum(["akt", "odpis_kw"]),
  typeMismatch: z.boolean(),
  model: z.string(),
});

export type KwExtractResult =
  | { kind: "ok"; extract: KwSnapshot; meta: KwMetaSnapshot; typeMismatch: boolean }
  | { kind: "invalidDoc"; message: string }
  | { kind: "error"; message: string; retryable: boolean };

const GENERIC_ERROR = "Nie udało się odczytać dokumentu — spróbuj ponownie.";

async function detailOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail;
  } catch {
    return undefined;
  }
}

export async function extractKw(args: {
  file: File;
  expectedType: "akt" | "odpis_kw";
  token: string;
  workerUrl: string;
}): Promise<KwExtractResult> {
  const form = new FormData();
  form.set("file", args.file);
  form.set("token", args.token);
  form.set("expected_type", args.expectedType);

  let response: Response;
  try {
    response = await fetch(`${args.workerUrl}/kw-extract`, { method: "POST", body: form });
  } catch {
    return { kind: "error", message: GENERIC_ERROR, retryable: true };
  }

  if (response.status === 422) {
    return {
      kind: "invalidDoc",
      message:
        (await detailOf(response)) ??
        "To nie wygląda na akt notarialny ani odpis księgi wieczystej.",
    };
  }
  if (!response.ok) {
    return {
      kind: "error",
      message: (await detailOf(response)) ?? GENERIC_ERROR,
      retryable: response.status === 502,
    };
  }

  const parsed = wireSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    return { kind: "error", message: GENERIC_ERROR, retryable: true };
  }
  const { extract, docTypeDetected, typeMismatch, model } = parsed.data;
  return {
    kind: "ok",
    extract: {
      source: docTypeDetected,
      kwLokalu: extract.kwLokalu,
      kwGruntu: extract.kwGruntu,
      kwInne: extract.kwInne,
      deweloperski: extract.deweloperski,
      powUzytkowaKw: extract.powUzytkowaKw,
      udzial: extract.udzial,
      sad: extract.sad,
      wydzial: extract.wydzial,
      dataDokumentu: extract.dataDokumentu,
      dzial3: extract.dzial3,
      dzial4: extract.dzial4,
    },
    meta: {
      model,
      extractedAt: new Date().toISOString(),
      docTypeDetected,
      docTypeDeclared: args.expectedType,
    },
    typeMismatch,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web exec vitest run tests/mint-kw-token.test.ts tests/kw-extract-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Full gate, commit + push + CI**

```bash
pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise
git add apps/web/src/app/actions/mint-kw-token.ts apps/web/src/lib/kw-extract-client.ts apps/web/tests
git commit -m "feat: hmac upload token action and browser kw-extract client with contract tests"
git push && gh run watch --exit-status
```

---

### Task 7: `kw-section.tsx` UI + form wiring (RTL-tested)

**Files:**

- Create: `apps/web/src/app/valuations/new/kw-section.tsx`
- Modify: `apps/web/src/app/valuations/new/new-valuation-form.tsx`
- Create: `apps/web/tests/rtl-kw-section.test.tsx`

**Interfaces:**

- Consumes: `extractKw`/`KwExtractResult` (Task 6), `mintKwUploadToken` (Task 6), form fields `kw.*`/`kwMeta`/`kwNumber` (Task 5).
- Produces: `<KwSection control={control} state={kwState} source={kwSource} onSourceChange={fn} onFileSelected={fn} onRetry={fn} onUseDocumentArea={fn} areaMismatch={{form: number, doc: number} | null} />` — presentation component; ALL fetch/state logic lives in `new-valuation-form.tsx` (mirrors `SubjectSection` split).
- State machine `KwFetchState = { status: "idle" | "loading" } | { status: "done"; summary: string; typeMismatch: boolean } | { status: "invalidDoc"; message: string } | { status: "error"; message: string }`.
- Feature flag: upload buttons render only when `process.env.NEXT_PUBLIC_KW_UPLOAD !== "off"` (mirrors `NEXT_PUBLIC_SUBJECT_AUTOFETCH`); manual mode always renders.

- [ ] **Step 1: Write failing RTL tests**

Create `apps/web/tests/rtl-kw-section.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import { KwSection, type KwFetchState } from "@/app/valuations/new/kw-section";

type FormInput = z.input<typeof valuationFormSchema>;

function Harness(props: {
  state?: KwFetchState;
  source?: "akt" | "odpis_kw" | "reczny";
  areaMismatch?: { form: number; doc: number } | null;
  deweloperski?: boolean;
  onSourceChange?: (s: "akt" | "odpis_kw" | "reczny") => void;
  onUseDocumentArea?: () => void;
}) {
  const { control } = useForm<FormInput>({
    defaultValues: props.deweloperski
      ? { kw: { deweloperski: true, source: "akt" } as FormInput["kw"] }
      : {},
  });
  return (
    <KwSection
      control={control}
      state={props.state ?? { status: "idle" }}
      source={props.source ?? "reczny"}
      onSourceChange={props.onSourceChange ?? (() => {})}
      onFileSelected={() => {}}
      onRetry={() => {}}
      onUseDocumentArea={props.onUseDocumentArea ?? (() => {})}
      areaMismatch={props.areaMismatch ?? null}
    />
  );
}

describe("KwSection", () => {
  it("renders the three source options and manual kwNumber input by default", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /wgraj akt notarialny/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /wgraj odpis kw/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /wpisz ręcznie/i })).toBeDefined();
    expect(screen.getByLabelText(/numer księgi wieczystej/i)).toBeDefined();
  });

  it("switching source calls onSourceChange (hard reset lives in the parent)", async () => {
    const onSourceChange = vi.fn();
    render(<Harness onSourceChange={onSourceChange} />);
    await userEvent.click(screen.getByRole("button", { name: /wgraj akt notarialny/i }));
    expect(onSourceChange).toHaveBeenCalledWith("akt");
  });

  it("shows extraction states: loading, done with type mismatch warning, invalidDoc, error", () => {
    const { rerender } = render(<Harness source="akt" state={{ status: "loading" }} />);
    expect(screen.getByTestId("kw-fetch-status").textContent).toContain("⏳");
    rerender(
      <Harness
        source="akt"
        state={{ status: "done", summary: "2 KW, pow. 69,56 m²", typeMismatch: true }}
      />,
    );
    expect(screen.getByTestId("kw-fetch-status").textContent).toContain("do potwierdzenia");
    expect(screen.getByTestId("kw-type-mismatch")).toBeDefined();
    rerender(
      <Harness source="akt" state={{ status: "invalidDoc", message: "To nie wygląda na akt." }} />,
    );
    expect(screen.getByTestId("kw-fetch-status").textContent).toContain("ℹ");
    rerender(<Harness source="akt" state={{ status: "error", message: "Błąd." }} />);
    expect(screen.getByRole("button", { name: /spróbuj ponownie/i })).toBeDefined();
  });

  it("shows the developer banner when kw.deweloperski is set", () => {
    render(<Harness source="akt" deweloperski />);
    expect(screen.getByTestId("kw-developer-banner").textContent).toContain("księgi macierzystej");
  });

  it("area mismatch warning shows both values and fires onUseDocumentArea", async () => {
    const onUse = vi.fn();
    render(
      <Harness source="akt" areaMismatch={{ form: 70, doc: 69.56 }} onUseDocumentArea={onUse} />,
    );
    const warning = screen.getByTestId("kw-area-mismatch");
    expect(warning.textContent).toContain("70");
    expect(warning.textContent).toContain("69,56");
    await userEvent.click(screen.getByRole("button", { name: /użyj wartości z dokumentu/i }));
    expect(onUse).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run tests/rtl-kw-section.test.tsx`
Expected: FAIL — module `kw-section` doesn't exist

- [ ] **Step 3: Implement `kw-section.tsx`**

```tsx
"use client";

import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { valuationFormSchema } from "@/lib/valuation-form-schema";

type FormInput = z.input<typeof valuationFormSchema>;
type FormOutput = z.output<typeof valuationFormSchema>;

export type KwSource = "akt" | "odpis_kw" | "reczny";

export type KwFetchState =
  | { status: "idle" | "loading" }
  | { status: "done"; summary: string; typeMismatch: boolean }
  | { status: "invalidDoc"; message: string }
  | { status: "error"; message: string };

interface KwSectionProps {
  control: Control<FormInput, unknown, FormOutput>;
  state: KwFetchState;
  source: KwSource;
  onSourceChange: (source: KwSource) => void;
  onFileSelected: (file: File) => void;
  onRetry: () => void;
  onUseDocumentArea: () => void;
  areaMismatch: { form: number; doc: number } | null;
}

const nf = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SOURCES: Array<{ value: KwSource; label: string }> = [
  { value: "akt", label: "Wgraj akt notarialny" },
  { value: "odpis_kw", label: "Wgraj odpis KW" },
  { value: "reczny", label: "Wpisz ręcznie" },
];

const uploadEnabled = process.env.NEXT_PUBLIC_KW_UPLOAD !== "off";

function KwFetchStatusBar({ state, onRetry }: { state: KwFetchState; onRetry: () => void }) {
  switch (state.status) {
    case "idle":
      return null;
    case "loading":
      return (
        <p data-testid="kw-fetch-status" className="text-sm text-muted-foreground">
          ⏳ Odczytuję dokument (może potrwać do pół minuty)…
        </p>
      );
    case "done":
      return (
        <div className="flex flex-col gap-1">
          <p data-testid="kw-fetch-status" className="text-sm text-muted-foreground">
            ✓ Odczytano: {state.summary} — do potwierdzenia
          </p>
          {state.typeMismatch ? (
            <p data-testid="kw-type-mismatch" className="text-sm text-amber-600">
              ⚠ Dokument wygląda na inny typ niż wybrany — dane wypełniono według typu wykrytego.
            </p>
          ) : null}
        </div>
      );
    case "invalidDoc":
      return (
        <p data-testid="kw-fetch-status" className="text-sm text-muted-foreground">
          ℹ {state.message}
        </p>
      );
    case "error":
      return (
        <div data-testid="kw-fetch-status" className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-amber-600">⚠ {state.message}</p>
          <Button type="button" variant="outline" onClick={onRetry}>
            Spróbuj ponownie
          </Button>
        </div>
      );
  }
}

const EXTRACT_TEXT_FIELDS = [
  { name: "kw.kwLokalu", id: "kw-lokalu", label: "Nr KW lokalu" },
  { name: "kw.kwGruntu", id: "kw-gruntu", label: "Nr KW gruntu (księga macierzysta)" },
  { name: "kw.udzial", id: "kw-udzial", label: "Udział w nieruchomości wspólnej" },
  { name: "kw.sad", id: "kw-sad", label: "Sąd rejonowy" },
  { name: "kw.wydzial", id: "kw-wydzial", label: "Wydział ksiąg wieczystych" },
] as const;

/**
 * "Stan prawny (KW)" section (Slice 6, mockup v3-r4 KwSourcePicker).
 * Presentation-only: upload/fetch/reset logic lives in the parent form —
 * this mirrors the SubjectSection split so RTL tests need no network.
 */
export function KwSection(props: KwSectionProps) {
  const { control, state, source, onSourceChange } = props;
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-medium">Stan prawny (KW)</legend>

      <div className="flex flex-wrap gap-2">
        {SOURCES.filter((s) => uploadEnabled || s.value === "reczny").map((s) => (
          <Button
            key={s.value}
            type="button"
            variant={source === s.value ? "default" : "outline"}
            onClick={() => onSourceChange(s.value)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {source !== "reczny" && uploadEnabled ? (
        <input
          type="file"
          accept="application/pdf"
          aria-label="Plik dokumentu (PDF)"
          data-testid="kw-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) props.onFileSelected(file);
          }}
        />
      ) : null}

      <KwFetchStatusBar state={state} onRetry={props.onRetry} />

      {source === "reczny" ? (
        <Controller
          control={control}
          name="kwNumber"
          render={({ field, fieldState }) => (
            <div className="flex flex-col gap-1">
              <label htmlFor="kw-number" className="text-sm">
                Numer księgi wieczystej
              </label>
              <Input id="kw-number" {...field} value={field.value ?? ""} />
              {fieldState.error ? (
                <p className="text-sm text-destructive">{fieldState.error.message}</p>
              ) : null}
            </div>
          )}
        />
      ) : (
        <>
          <Controller
            control={control}
            name="kw.deweloperski"
            render={({ field }) =>
              field.value ? (
                <p
                  data-testid="kw-developer-banner"
                  className="rounded-md border border-amber-500 bg-amber-500/10 p-2 text-sm"
                >
                  Lokal bez własnej KW (zakup deweloperski) — dane z księgi macierzystej gruntu.
                </p>
              ) : (
                <span />
              )
            }
          />
          {EXTRACT_TEXT_FIELDS.map((f) => (
            <Controller
              key={f.name}
              control={control}
              name={f.name}
              render={({ field }) => (
                <div className="flex flex-col gap-1">
                  <label htmlFor={f.id} className="text-sm">
                    {f.label}
                  </label>
                  <Input
                    id={f.id}
                    {...field}
                    value={field.value == null ? "" : String(field.value)}
                  />
                </div>
              )}
            />
          ))}
          {props.areaMismatch ? (
            <div
              data-testid="kw-area-mismatch"
              className="flex flex-col gap-2 rounded-md border border-amber-500 bg-amber-500/10 p-2 text-sm"
            >
              <p>
                Powierzchnia w formularzu ({nf.format(props.areaMismatch.form)} m²) różni się od
                powierzchni w dokumencie ({nf.format(props.areaMismatch.doc)} m²).
              </p>
              <Button type="button" variant="outline" onClick={props.onUseDocumentArea}>
                Użyj wartości z dokumentu
              </Button>
            </div>
          ) : null}
        </>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 4: Wire into `new-valuation-form.tsx`**

In the form component (state + handlers colocated with the existing subject autofetch logic):

```tsx
const [kwSource, setKwSource] = useState<KwSource>("reczny");
const [kwState, setKwState] = useState<KwFetchState>({ status: "idle" });
const lastKwFile = useRef<File | null>(null);

const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:8000";

function resetKwSection(nextSource: KwSource) {
  // Hard reset on source change (Slice-5 lesson: the source is the section key).
  setKwSource(nextSource);
  setKwState({ status: "idle" });
  lastKwFile.current = null;
  setValue("kw", undefined);
  setValue("kwMeta", undefined);
}

async function runKwExtraction(file: File, expectedType: "akt" | "odpis_kw") {
  lastKwFile.current = file;
  setKwState({ status: "loading" });
  const minted = await mintKwUploadToken();
  if ("error" in minted) {
    setKwState({ status: "error", message: minted.error });
    return;
  }
  const result = await extractKw({ file, expectedType, token: minted.token, workerUrl });
  if (result.kind === "invalidDoc") {
    setKwState({ status: "invalidDoc", message: result.message });
    return;
  }
  if (result.kind === "error") {
    setKwState({ status: "error", message: result.message });
    return;
  }
  setValue("kw", result.extract, { shouldDirty: true });
  setValue("kwMeta", result.meta, { shouldDirty: true });
  const area = getValues("area");
  if (
    result.extract.powUzytkowaKw != null &&
    (area === undefined || area === "" || area === null)
  ) {
    setValue("area", result.extract.powUzytkowaKw, { shouldDirty: true });
  }
  const kwCount = [
    result.extract.kwLokalu,
    result.extract.kwGruntu,
    ...result.extract.kwInne,
  ].filter(Boolean).length;
  const pow = result.extract.powUzytkowaKw;
  setKwState({
    status: "done",
    summary: `${kwCount} KW${pow != null ? `, pow. ${pow.toString().replace(".", ",")} m²` : ""}`,
    typeMismatch: result.typeMismatch,
  });
}

const kwValues = watch("kw");
const areaValue = watch("area");
const areaMismatch =
  kwValues?.powUzytkowaKw != null &&
  areaValue !== undefined &&
  areaValue !== "" &&
  Number(areaValue) !== kwValues.powUzytkowaKw
    ? { form: Number(areaValue), doc: kwValues.powUzytkowaKw }
    : null;
```

Render (replacing the existing bare kwNumber input — move it INTO the section):

```tsx
<KwSection
  control={control}
  state={kwState}
  source={kwSource}
  onSourceChange={resetKwSection}
  onFileSelected={(file) => runKwExtraction(file, kwSource === "odpis_kw" ? "odpis_kw" : "akt")}
  onRetry={() => {
    if (lastKwFile.current) {
      runKwExtraction(lastKwFile.current, kwSource === "odpis_kw" ? "odpis_kw" : "akt");
    }
  }}
  onUseDocumentArea={() => {
    if (kwValues?.powUzytkowaKw != null) {
      setValue("area", kwValues.powUzytkowaKw, { shouldDirty: true });
    }
  }}
  areaMismatch={areaMismatch}
/>
```

Imports: `mintKwUploadToken`, `extractKw`, `KwSection` + types. The old standalone kwNumber `<Input>` block is removed (it now lives inside KwSection's manual branch — grep the form for `kwNumber` to find it).

- [ ] **Step 5: Run RTL tests + full gate**

Run: `pnpm --filter web exec vitest run tests/rtl-kw-section.test.tsx`
Expected: PASS
Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: green (the e2e smoke fills kwNumber — the manual branch is default, so the selector still resolves; if the smoke fails on a changed label/id, update `e2e/smoke.spec.ts` in THIS task, same-task rule from Slice 1).

- [ ] **Step 6: Commit + push + CI**

```bash
git add apps/web/src/app/valuations/new apps/web/tests/rtl-kw-section.test.tsx
git commit -m "feat: kw source picker section - upload, states, developer banner, area warning"
git push && gh run watch --exit-status
```

---

### Task 8: Detail page — KwCard, repo/action/button bulk confirm

**Files:**

- Modify: `apps/web/src/ports/valuation.ts` (PortValuation)
- Modify: `apps/web/src/adapters/valuation-drizzle.ts`
- Create: `apps/web/src/app/actions/confirm-kw.ts`
- Modify: `apps/web/src/app/valuations/[id]/page.tsx`
- Modify: `apps/web/src/app/valuations/[id]/valuation-actions.tsx`
- Modify: `apps/web/tests/valuation-repo.test.ts` (add cases)

**Interfaces:**

- Consumes: `confirmKwProvenance` (Task 4).
- Produces: `PortValuation.confirmKw(id: string, ownerId: string): Promise<Valuation | null>` (byte-mirror of `confirmSubject` — null for not-found/not-owner, throws for non-draft); server action `confirmKw(id: string): Promise<{ error: string } | undefined>`; detail page renders a "Stan prawny (KW)" card when `inputs.kw` present with `GroupProvenanceBadge label="Stan prawny (KW)"` and a "Potwierdź dane KW" button next to the existing bulk confirms.

- [ ] **Step 1: Write failing repo tests** — append to `valuation-repo.test.ts`, mirroring the file's existing `confirmSubject` cases (create draft with `inputs.kw` + `provenance.kw: to_verify`, call `repo.confirmKw`, expect flipped; non-owner → null; approved → throws).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run tests/valuation-repo.test.ts`
Expected: FAIL — `confirmKw` is not a function

- [ ] **Step 3: Implement**

- `ports/valuation.ts`: add `confirmKw(id: string, ownerId: string): Promise<Valuation | null>;` to `PortValuation` (next to `confirmSubject`).
- `adapters/valuation-drizzle.ts`: add `confirmKw` as a byte-mirror of the existing `confirmSubject` method, delegating to `confirmKwProvenance` (same fresh-read → domain mutation → UPDATE shape; do not re-implement — copy the sibling and swap the domain call).
- `actions/confirm-kw.ts` (byte-mirror of `confirm-subject.ts`):

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";

export type ConfirmKwResult = { error: string } | undefined;

/**
 * Bulk-confirm the KW extract (mirrors confirmSample/confirmSubject):
 * flips the draft's kw group — and document-sourced area — to confirmed.
 */
export async function confirmKw(id: string): Promise<ConfirmKwResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const updated = await valuationRepository.confirmKw(id, session.user);
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("confirmKw failed", error);
    return { error: "Nie udało się potwierdzić danych KW — spróbuj ponownie." };
  }

  revalidatePath(`/valuations/${id}`);
}
```

- `[id]/page.tsx`: add a `KwCard` component (mirror the existing subject card structure) rendered when `inputs.kw != null`: rows for KW lokalu (or the developer note "lokal bez własnej KW — księga macierzysta" when `deweloperski`), KW gruntu, udział, sąd/wydział, data dokumentu, dział III (list `tresc` or "brak wpisów"), dział IV likewise; header `<GroupProvenanceBadge label="Stan prawny (KW)" status={inputs.provenance?.kw?.status} />`.
- `valuation-actions.tsx`: add the "Potwierdź dane KW" button following the exact pattern of the existing "Potwierdź dane przedmiotu" (visible only for drafts with `inputs.kw` and `provenance.kw?.status === "to_verify"`; calls `confirmKw`).

- [ ] **Step 4: Run tests + full gate**

Run: `pnpm --filter web exec vitest run tests/valuation-repo.test.ts`
Expected: PASS
Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: green

- [ ] **Step 5: Commit + push + CI**

```bash
git add apps/web/src
git add apps/web/tests/valuation-repo.test.ts
git commit -m "feat: kw card on detail page with bulk confirm trio (repo, action, button)"
git push && gh run watch --exit-status
```

---

### Task 9: Template — 8.2 badanie KW block (wiki-repo `build_template.py`) + integrity RED

> ⚠️ Two-repo task (Slice-5 T7+T8 pattern). Wiki-repo changes stay UNCOMMITTED
> there (they ride with the S6 wiki PR). App-repo commit for Tasks 9+10 is
> pushed ONCE, after Task 10 (the F-12 sections test is expected-RED between
> them). NBSP in template strings: write via Python file I/O only.

**Files:**

- Modify (wiki repo): `/Users/michalczekala/Development/wyceny/tools/spike/2026-07-15-template-koscielna/build_template.py`
- Regenerate: `apps/web/templates/operat-szablon.docx`
- Modify: `apps/web/tests/f12-template-integrity.test.ts`

**Interfaces:**

- Produces (template tags Task 10's model must fill — names are FINAL):
  scalars `{udzial_kw}`, `{pow_uzytkowa_kw}`, `{kw_zrodlo}`, `{kw_lokalu}`, `{kw_gruntu}`, `{kw_sad}`, `{kw_wydzial}`, `{kw_data_dok}`; booleans/sections `{#kw_badanie}...{/kw_badanie}`, `{#kw_deweloperski}...{/kw_deweloperski}`, `{#kw_standard}...{/kw_standard}`, `{#dzial3_brak}...{/dzial3_brak}`, `{#dzial4_brak}...{/dzial4_brak}`; loops `{#dzial3_wpisy}{.}{/dzial3_wpisy}`, `{#dzial4_wpisy}{.}{/dzial4_wpisy}`.
- Existing `{nr_kw}` stub paragraph STAYS (legacy path renders exactly as today).

- [ ] **Step 1: Extend `build_template.py`**

(a) In the `FACTS_82` list, replace the fixed line
`"Udział w nieruchomości wspólnej — wg odpisu księgi wieczystej."` with:

```python
    "Udział w nieruchomości wspólnej: {udzial_kw}.",
    "Powierzchnia użytkowa lokalu (wg dokumentu KW/aktu): {pow_uzytkowa_kw}.",
```

(b) Add a new stage function after `add_82_facts_block` (same anchoring style — insert after the `STUB_KW` paragraph):

```python
BADANIE_KW = [
    "{#kw_badanie}Badanie ksiąg wieczystych przeprowadzono na podstawie: {kw_zrodlo}"
    " (data dokumentu: {kw_data_dok}).",
    "{#kw_standard}Księga wieczysta lokalu: {kw_lokalu}. Księga wieczysta gruntu: "
    "{kw_gruntu}.{/kw_standard}",
    "{#kw_deweloperski}Lokal nie posiada założonej księgi wieczystej (nabycie od dewelopera) — "
    "badaniem objęto księgę macierzystą gruntu: {kw_gruntu}.{/kw_deweloperski}",
    "Księgi prowadzi: {kw_sad}, {kw_wydzial}.",
    "{#dzial3_brak}Dział III (prawa, roszczenia i ograniczenia): brak wpisów.{/dzial3_brak}",
    "{#dzial3_wpisy}Dział III — wpis: {.}{/dzial3_wpisy}",
    "{#dzial4_brak}Dział IV (hipoteki): brak wpisów.{/dzial4_brak}",
    "{#dzial4_wpisy}Dział IV — wpis: {.}{/dzial4_wpisy}",
    "{/kw_badanie}",
]


def add_kw_badanie_block(body):
    """Slice 6: KW examination block right after the {nr_kw} stub paragraph
    (before the 8.2 facts block inserted by add_82_facts_block — call THIS
    stage after it so insertion order puts badanie between stub and facts,
    or adjust the anchor accordingly; assert final order in verify())."""
    anchor = None
    for p in body.iter(qn("w:p")):
        if para_text(p).startswith(STUB_KW[:40]):
            anchor = p
    check(anchor is not None, "kw badanie block: {nr_kw} stub paragraph found")
    insert_paras_after(body, anchor, BADANIE_KW, "kw badanie block")
```

(follow the file's actual helper names — `para_text`/`qn` exist there under
possibly different spellings; mirror `add_82_facts_block`'s body verbatim and
only swap the constant + label). Register the stage in the main build sequence
next to `add_82_facts_block`, extend the script's `PLACEHOLDERS` list with the
8 new scalar tags, and extend its `verify()` counts the same way the S5 tags
were added.

- [ ] **Step 2: Regenerate the template**

Run (wiki repo): `cd /Users/michalczekala/Development/wyceny/tools/spike/2026-07-15-template-koscielna && python3 build_template.py`
Expected: build OK, verify() green, output copied per the script's convention to `apps/web/templates/operat-szablon.docx` (check the script's output path — Slice 5 copied manually; do the same `cp` it documents).

- [ ] **Step 3: Extend `f12-template-integrity.test.ts`**

Add the new tags to the required-placeholder list (the test file has an explicit array of expected tags — extend it):

```typescript
  "{udzial_kw}",
  "{pow_uzytkowa_kw}",
  "{kw_zrodlo}",
  "{kw_lokalu}",
  "{kw_gruntu}",
  "{kw_sad}",
  "{kw_wydzial}",
  "{kw_data_dok}",
  "{#kw_badanie}",
  "{#kw_deweloperski}",
  "{#kw_standard}",
  "{#dzial3_brak}",
  "{#dzial4_brak}",
  "{#dzial3_wpisy}",
  "{#dzial4_wpisy}",
```

- [ ] **Step 4: Run integrity + sections tests**

Run: `pnpm --filter web exec vitest run tests/f12-template-integrity.test.ts tests/f12-document-sections.test.ts`
Expected: integrity PASS; **sections test RED** (unresolved `{#kw_badanie}` etc. — the model doesn't provide them yet). This RED is the designed handoff to Task 10. Do NOT push yet.

- [ ] **Step 5: Commit locally (no push)**

```bash
git add apps/web/templates/operat-szablon.docx apps/web/tests/f12-template-integrity.test.ts
git commit -m "feat: operat template kw examination block in 8.2 (f-12 red handoff)"
```

---

### Task 10: `DocumentModel` kw fields + GREEN + push Tasks 9–10

**Files:**

- Modify: `apps/web/src/domain/document-model.ts`
- Modify: `apps/web/tests/f12-document-sections.test.ts`, `apps/web/tests/f12-document-masking.test.ts` (add cases)

**Interfaces:**

- Consumes: template tags from Task 9 (names above are final), `KwSnapshot` from `inputs.kw`.
- Produces: `DocumentModel` gains exactly: `kw_badanie: boolean; kw_standard: boolean; kw_deweloperski: boolean; kw_zrodlo: string; kw_lokalu: string; kw_gruntu: string; kw_sad: string; kw_wydzial: string; kw_data_dok: string; udzial_kw: string; pow_uzytkowa_kw: string; dzial3_brak: boolean; dzial3_wpisy: string[]; dzial4_brak: boolean; dzial4_wpisy: string[];`

- [ ] **Step 1: Add model tests** (append to `f12-document-sections.test.ts`, following its build-and-render pattern):
  - extract present (standard): render with `inputs.kw` → output contains "Księga wieczysta lokalu:", both numbers, "Dział IV — wpis:", no unresolved tags; `kw_standard` and `kw_deweloperski` mutually exclusive.
  - developer variant: `kwLokalu: null, deweloperski: true` → "księgę macierzystą gruntu", no "Księga wieczysta lokalu:".
  - legacy (no `inputs.kw`): renders exactly as today — `{nr_kw}` line present, no badanie content, `udzial_kw` renders "wg odpisu księgi wieczystej", `pow_uzytkowa_kw` renders "—".
  - masking (`f12-document-masking.test.ts`): serialize the model built from a kw fixture whose `dzial3.tresc` contains the scrub marker case — assert the serialized model contains no 11-digit runs (`/\d{11}/` never matches `JSON.stringify(model)`).

- [ ] **Step 2: Run to verify RED** (sections test still failing from Task 9 + new cases)

- [ ] **Step 3: Implement in `document-model.ts`**

Add to the `DocumentModel` type the fields listed in Interfaces, and in `buildDocumentModel` (after the mpzp block):

```typescript
const kw = inputs.kw ?? null;
const KW_ZRODLO_TEXT = { akt: "akt notarialny", odpis_kw: "odpis księgi wieczystej" } as const;
```

and in the returned object:

```typescript
    kw_badanie: kw != null,
    kw_standard: kw != null && !kw.deweloperski,
    kw_deweloperski: kw != null && kw.deweloperski,
    kw_zrodlo: kw ? KW_ZRODLO_TEXT[kw.source] : DASH,
    kw_lokalu: kw?.kwLokalu ?? DASH,
    kw_gruntu: kw?.kwGruntu ?? DASH,
    kw_sad: kw?.sad ?? DASH,
    kw_wydzial: kw?.wydzial ?? DASH,
    kw_data_dok: kw?.dataDokumentu ? formatDatePl(kw.dataDokumentu) : DASH,
    udzial_kw: kw?.udzial ?? "wg odpisu księgi wieczystej",
    pow_uzytkowa_kw: kw?.powUzytkowaKw != null ? formatNumber(kw.powUzytkowaKw, 2) : DASH,
    dzial3_brak: kw != null && (kw.dzial3 == null || !kw.dzial3.wpisy),
    dzial3_wpisy: kw?.dzial3?.wpisy ? kw.dzial3.tresc : [],
    dzial4_brak: kw != null && (kw.dzial4 == null || !kw.dzial4.wpisy),
    dzial4_wpisy: kw?.dzial4?.wpisy ? kw.dzial4.tresc : [],
```

(Mutual exclusivity is structural: `kw_standard`/`kw_deweloperski` derive from one boolean; `dzialN_brak` is false whenever `kw` is null so the legacy render adds nothing.)

- [ ] **Step 4: GREEN + full gate**

Run: `pnpm --filter web exec vitest run tests/f12-document-sections.test.ts tests/f12-document-masking.test.ts`
Expected: PASS
Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: green

- [ ] **Step 5: Commit + push BOTH tasks + CI**

```bash
git add apps/web/src/domain/document-model.ts apps/web/tests
git commit -m "feat: document model kw examination fields with legacy fallback"
git push && gh run watch --exit-status
```

---

### Task 11: e2e flag, smoke regression, env documentation

**Files:**

- Modify: `.github/workflows/*` e2e job env (add `NEXT_PUBLIC_KW_UPLOAD: off` next to `NEXT_PUBLIC_SUBJECT_AUTOFETCH: off`)
- Modify: `apps/web/playwright.config.ts` (same env for local runs, mirroring the SUBJECT_AUTOFETCH entry)
- Modify: `apps/web/e2e/smoke.spec.ts` — only if Task 7 changed the manual kwNumber selector; the manual path MUST keep passing unchanged
- Modify: `README.md` (or the env section the repo already uses): document `WORKER_SHARED_SECRET` (web + worker), `ANTHROPIC_API_KEY` (worker only), `NEXT_PUBLIC_WORKER_URL` (web build), `CORS_ALLOW_ORIGINS` (worker)

**Interfaces:**

- Consumes: the `NEXT_PUBLIC_KW_UPLOAD !== "off"` gate from Task 7.

- [ ] **Step 1: Add env entries** to both CI e2e job and playwright config (copy the SUBJECT_AUTOFETCH lines and adapt).
- [ ] **Step 2: Run e2e locally**: `pnpm --filter web e2e` — Expected: smoke passes on the manual path with upload buttons hidden.
- [ ] **Step 3: README env table** — add the four variables with one-line descriptions and where they live (Vercel / Railway).
- [ ] **Step 4: Full gates (web + worker) one last time**; commit + push + CI:

```bash
git add .github apps/web/playwright.config.ts apps/web/e2e README.md
git commit -m "chore: kw upload e2e flag, smoke regression guard, env docs"
git push && gh run watch --exit-status
```

---

## After Task 11 (not tasks — stage gates)

- **Final whole-branch review** (SDD convention): fresh reviewer over the full range; triage deferred Minors.
- **S5 deploy (USER-GATED — secrets checkpoint):** set on Railway worker: `ANTHROPIC_API_KEY`, `WORKER_SHARED_SECRET`, `CORS_ALLOW_ORIGINS=https://wyceny-mu.vercel.app,http://localhost:3000`; on Vercel: `WORKER_SHARED_SECRET`, `NEXT_PUBLIC_WORKER_URL=https://worker-v2-production.up.railway.app`. Order: worker → web (no migration). Prod QA = spec DoD: (1) akt wtórny Suchy Las E2E → operat, (2) akt deweloperski → księga matka, (3) odpis → działy III/IV, (4) manual regression; then `SELECT` prod DB: no 11-digit runs in `inputs`.
- **S6 wiki PR:** log/timeline/tech page/roadmap NOW→DONE + spike `2026-07-17-kw-ekstrakcja/` + `build_template.py` changes ride along.

## Self-Review Notes (already applied)

- Spec coverage: all spec sections map to tasks (picker/upload→7, extraction→2-3, HMAC→2/3/6, model→4-5, confirm→8, document→9-10, RTL→1/7, e2e flag→11, secrets→post-stage). Cost limits, file storage, per-field badges: out of scope per spec.
- Type consistency: `KwExtractPayload` (worker) ↔ `wireSchema` (client) ↔ `kwSchema` (form) ↔ `KwSnapshot` (domain) field names verified identical; template tags Task 9 ↔ model fields Task 10 verified identical.
- Known judgment calls: `.superRefine` forces the `valuationFormObject` split (called out in Task 5); `kw_zrodlo` text via lookup table; area-match equality (not tolerance) is deliberate and tested.

---

## Amendments — independent plan review 2026-07-17 (BINDING)

An adversarial reviewer verified this plan against the live codebase. The
corrections below OVERRIDE the task bodies above; per-task briefs MUST fold
in the items for their task. (K1/K2 — F-9 fixture literals — are already
applied inline in this file.)

- **W1 (Task 5):** zod 4 `.pick()` THROWS at runtime on a schema with
  refinements. Do the `valuationFormObject` (plain object) +
  `valuationFormSchema = valuationFormObject.superRefine(...)` split and
  migrate BOTH pick call sites: `get-subject-data.ts` AND
  `get-sample-proposal.ts:10`. `.shape` access keeps working on the refined
  schema — test usages survive.
- **W2 (Task 3):** `main.py` has NO module-level `logger` (it calls
  `logging.getLogger("uvicorn.error")` inline). Add
  `logger = logging.getLogger("uvicorn.error")` at module level (plus
  `import logging` if absent) before using `logger.error` in the endpoint.
- **W3 (Task 5):** extending `assignProvenance`'s Pick with required `area`
  breaks the EXISTING calls in `assign-provenance.test.ts` (~7 call sites) —
  update them to pass `area`, keeping their assertions unchanged.
- **W4 (Task 7):** upload mode + no file + submit = silent dead-end. Point
  the `superRefine` issue at BOTH paths `["kwNumber"]` and `["kw"]`, and
  render the `kw` root error inside `KwSection` in upload mode ("Wgraj
  dokument albo przełącz na wpis ręczny."). Add an RTL case for it.
- **W5 (Task 7):** add a Controller CHECKBOX for `kw.deweloperski` (spec:
  manual toggle; disables the `kw.kwLokalu` input when checked). Worker rule
  stays akt-only (auto-forcing on odpis would silently swallow a bad
  extract's missing kwLokalu) — the manual checkbox is the odpis escape
  hatch. Add an RTL case.
- **W6 (Task 7):** add editable textareas for `kw.dzial3.tresc` /
  `kw.dzial4.tresc` (render joined with newlines, split on change) — the
  GDPR scrub design depends on appraiser editability. Add an RTL case.
- **W7 (Task 7):** `resetKwSection` must use `resetField("kw")` +
  `resetField("kwMeta")` (NOT `setValue(..., undefined)`) — RHF does not
  reliably clear registered nested objects. Add a regression test: extract →
  switch to manual → submitted values contain no `kw` (write-once inputs
  poisoning class from Slice 5).
- **W8 (Tasks 9–10):** the unconditional `pow_uzytkowa_kw` line in FACTS_82
  would print "…: —." into LEGACY operats (spec forbids legacy regression).
  Wrap it in its own condition: `{#pow_kw_present}Powierzchnia użytkowa
lokalu (wg dokumentu KW/aktu): {pow_uzytkowa_kw}.{/pow_kw_present}`; add
  `pow_kw_present: kw?.powUzytkowaKw != null` to the model (Task 10) and the
  pair to both placeholder lists. Legacy `udzial_kw` fallback text is fine.
- **W9 (Task 7):** the smoke spec locates `#kwNumber`
  (`e2e/smoke.spec.ts:19`). Keep `id="kwNumber"` on the manual input (do NOT
  rename to `kw-number`) and run `pnpm --filter web e2e` locally in Task 7
  before pushing.
- **D1 (Tasks 4/5):** real helper names differ from the plan's test sketches:
  f4 tests build inline GateInput objects (`manualRows(12)`,
  `confirmedScalars`); lifecycle helpers are `draftWith(inputs, overrides)`
  (inputs FIRST arg), `rcnInputs()`, `subjectInputs()`; form-schema test uses
  a `valid` const; assign-provenance test has no fixture helpers. The plan's
  CASES and ASSERTIONS are binding; its helper names are not — follow each
  file's actual style.
- **D2 (Task 9):** `build_template.py` already copies the output to
  `apps/web/templates/operat-szablon.docx` (`shutil.copyfile`) — no manual cp.
- **D3 (Task 9):** add CLOSING tags (`{/kw_badanie}`, `{/kw_deweloperski}`,
  `{/kw_standard}`, `{/dzial3_brak}`, `{/dzial3_wpisy}`, `{/dzial4_brak}`,
  `{/dzial4_wpisy}`, `{/pow_kw_present}`) alongside openers in BOTH the
  script's `PLACEHOLDERS` list and the integrity test array (repo convention
  lists pairs).
- **D4 (Task 9):** mirror `add_82_facts_block` EXACTLY (`W_P` constant,
  `para_text(p).strip().startswith(...)`, `break` on first match). Intended
  final order: STUB_KW → BADANIE_KW → 8.2 facts block — call
  `add_kw_badanie_block` so insertion order yields that, and add an order
  assertion to `verify()`.
- **D5 (Task 7):** the form uses `useWatch({ control })`, not a destructured
  `watch` — follow the file's existing pattern for the new watches. RTL
  harness: type the form as `useForm<FormInput, unknown, FormOutput>()` so
  `Control` matches `KwSection`'s prop.
- **D6 (Task 2):** the `ur\.` branch is dead (`\b` after a dot never
  matches before a space). Move `\b` into the branches:
  `(?:PESEL\b|urodzon\w+\b|ur\.|syn(?:a|owi)?\b|c[óo]r(?:ka|ki|ce)\b)[^,;.]*`.
  Add tests: "ur. " fragment removed; spaced PESEL after the "PESEL" marker
  removed by the context rule.
- **D8 (Task 5):** the "never null in practice" comment is wrong — an extract
  with both KW numbers null yields `kwNumber = null` (column is nullable;
  `documentFieldBlockers` gates approval). Keep the sync expression, fix the
  comment.
- **D9 (Task 7):** accepted MVP deviations from the spec's error table
  (single retry button for all errors; no auto-retry on 401). ADD the cheap
  client-side pre-checks in `onFileSelected`: reject non-PDF and
  `file.size > 32 * 1024 * 1024` with an inline Polish message before any
  network call.
- **D10 (Task 9):** add sample anti-literals to the template integrity
  forbidden list (template scan only, fixtures unaffected): `"14651/29359"`
  and `"146,5100"`.
- **D7 (accepted, backlog):** HMAC token has no nonce store / no user
  binding — replay within 300 s can only burn LLM cost; log for the
  worker-auth hardening backlog (nonce log + rate limit).
