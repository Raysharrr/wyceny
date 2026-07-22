# Slice 10 — Oględziny: zdjęcia + notatka (FR-2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3 sekcje zdjęć z oględzin (otoczenie/budynek/wnętrza) z realnym uploadem browser→worker + notatka, renderowane w operacie wiernie jak w oryginale Anety; EXIF strip dowiedziony testem; determinizm approve↔sign objęty.

**Architecture:** Upload wzorcem KW (HMAC token, plik wprost do workera); worker (Pillow) robi `exif_transpose → downscale 1200 px → JPEG q85` i zwraca bajty; server action waliduje trust-boundary (magic bytes, brak APP1/EXIF, wymiary) i zapisuje do `document` (bytea) od razu w drafcie; **manifest kluczy w `inputs.inspection`** (PortStorage nie listuje — manifest jest jedynym źródłem kompletu); render przez istniejący moduł image z aspect-preserving `getSize`; szablon wyłącznie przez `build_template.py` (wiki-repo).

**Tech Stack:** Next 16 (App Router, server actions), Drizzle/Postgres, docxtemplater + docxtemplater-image-module-free, FastAPI + Pillow (NOWA zależność workera), vitest + RTL + pytest.

## Global Constraints

- **F-1 NIETYKALNE:** golden 1 044 400 zł byte-identical; logika `computeKcs` bez zmian (typ `KcsInput` DOSTAJE pole `inspection` — computeKcs go nigdy nie czyta, golden snapshotuje output).
- **F-7 NIETYKALNE:** triggery DB bez zmian; każda mutacja wyceny w tx z wpisem audytu; `AUDIT_ACTIONS` rozszerzone o DOKŁADNIE jedną akcję `inspection_updated`.
- **F-9:** fixture'y WYŁĄCZNIE syntetyczne (konstruowane w teście bajt po bajcie albo Pillow w pytest); ZERO realnych fotografii; ZERO literałów base64 dłuższych niż istniejące 1×1 (PNG_1PX/JPG_1PX z `docx-render-maps.test.ts` — reużywaj te); KW tylko `PO1P/1/6`; zero 11-cyfrowych ciągów.
- **F-11:** worker nie zwraca żadnej wartości rynkowej (endpoint zdjęć zwraca tylko obraz+wymiary).
- **F-12:** szablon TYLKO przez `build_template.py` (wiki-repo `tools/spike/2026-07-15-template-koscielna/`); zmiana buildera UNCOMMITTED w wiki-repo do S6; binarka `apps/web/templates/operat-szablon.docx` commitowana w app-repo. Tagi sekcji w OSOBNYCH akapitach; `{%img}` NIGDY w jednym `w:t` z tagiem sekcji.
- Kod/commity ANGIELSKIE (conventional, lowercase, ≤100 znaków, bez atrybucji); UI/operat POLSKI (pełne diakrytyki).
- Per task (web): `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push → `gh run list --branch main --limit 3 --json databaseId,headSha` → `gh run watch <id> --exit-status` (run z TWOIM sha). Worker: `cd apps/worker && uv run pytest -q && uv run ruff check .`. Prettier pre-commit: `pnpm exec prettier --write <pliki>`.
- Web testy NIE mają `clearMocks` — `mock.calls` akumulują się między testami: używaj `.findLast()`. Automocki `_deps`: `storage.get` resolwuje `undefined` zamiast rzucać — zawsze guard `Buffer.isBuffer`.
- Stałe limitów (spec): `MAX_INSPECTION_PHOTOS = 50` (łącznie), wejście ≤ 10 MB (worker 413), wyjście ≤ 2 MB (server action), resize `1200` px dłuższy bok, JPEG `quality=85`, box renderu `600×450` px.

## File map (co powstaje / co się zmienia)

| Plik                                                                          | Odpowiedzialność                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/worker/app/photo.py` (nowy)                                             | czysta obróbka: transpose→resize→JPEG re-encode (strip przez re-encode)                                |
| `apps/worker/app/main.py`                                                     | endpoint `POST /photo-process` (wzorzec `/kw-extract`)                                                 |
| `apps/web/src/lib/jpeg.ts` (nowy)                                             | czyste utile bajtowe: `isJpeg`, `hasExifApp1`, `jpegDimensions`, `fitBox`                              |
| `apps/web/src/domain/inspection.ts` (nowy)                                    | typ `InspectionSnapshot` + `RenderPhotos`, sekcje, klucze, `EMPTY_INSPECTION`, `totalInspectionPhotos` |
| `apps/web/src/lib/load-inspection-photos.ts` (nowy)                           | manifest → zamrożone bajty (twardy błąd integralności przy braku klucza)                               |
| `apps/web/src/app/api/docs/[key]/route.ts`                                    | gałąź autoryzacji kluczy zdjęć (manifest-gated) — miniatury (Task 8b)                                  |
| `apps/web/src/domain/valuation.ts`                                            | `applyInspectionOp` (sibling confirm*), `AUDIT_ACTIONS` +`inspection_updated`                          |
| `apps/web/src/domain/kcs.ts`                                                  | `KcsInput.inspection?: InspectionSnapshot \| null` (tylko typ)                                         |
| `apps/web/src/domain/document-model.ts`                                       | pola notatki: `ma_uwagi_ogledzin`, `uwagi_ogledzin`                                                    |
| `apps/web/src/ports/valuation.ts` + `adapters/valuation-drizzle.ts`           | `updateInspection(id, user, op)` — tx + CAS + audit                                                    |
| `apps/web/src/app/actions/inspection.ts` (nowy)                               | 3 server actions: upload/remove/note (trust-boundary)                                                  |
| `apps/web/src/lib/photo-process-client.ts` (nowy)                             | klient przeglądarkowy `POST /photo-process` (wzorzec `kw-extract-client`)                              |
| `apps/web/src/app/valuations/[id]/inspection-section.tsx` (nowy) + `page.tsx` | karta „Oględziny" (szkic, owner)                                                                       |
| `apps/web/src/adapters/docx-render.ts`                                        | `photos` w opts, markery pętli, aspect-preserving `getSize`                                            |
| `apps/web/src/app/actions/approve-valuation.ts` / `sign-valuation.ts`         | odczyt manifestu → bajty → render; sign abort przy braku klucza                                        |
| wiki-repo `tools/spike/2026-07-15-template-koscielna/build_template.py`       | Stage 13: bloki foto + uwagi, usunięcie 4× STUB_FOTO                                                   |
| `.github/workflows/ci.yml` + `playwright.config.ts`                           | `NEXT_PUBLIC_PHOTO_UPLOAD: "off"` w e2e                                                                |

Fakty o szablonie (zbadane 2026-07-22, potrzebne w Taskach 6-7): `STUB_FOTO` („Dokumentacja fotograficzna i kartograficzna zostanie uzupełniona po oględzinach.") występuje w document.xml DOKŁADNIE 4× w kolejności dokumentu: §8.1 (przed „Położenie szczegółowe"), §8.3 (między stubem stanu technicznego a „Opis lokalu mieszkalnego"), §8.4, §15. Zdanie „Szczegółowy opis układu funkcjonalnego zostanie uzupełniony po oględzinach." występuje 2× (Wyciąg r6 + §8.3 — kotwica wnętrz = OSTATNIE wystąpienie). Blok map kończy akapit o treści `{^mapy}Dokumentacja kartograficzna zostanie uzupełniona.{/mapy}` (1×) — kotwica bloku otoczenia (zdjęcia „za mapami").

---

### Task 0: Guard na wyścig podglądu map (follow-up Slice 9)

**Files:**

- Modify: `apps/web/src/app/valuations/new/new-valuation-form.tsx:258-265`
- Test: `apps/web/tests/rtl-map-preview-race.test.tsx` (nowy)

**Interfaces:** brak nowych — fix zamknięty w `fetchSubject`.

- [ ] **Step 1: Failing test** — pełny formularz (wzorzec mocków z `tests/rtl-features-section.test.tsx:22-35` — otwórz go i skopiuj CAŁĄ listę `vi.mock(...)` modułów akcji, potem nadpisz dwa poniższe):

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// [SKOPIUJ TU pełny zestaw vi.mock(...) z rtl-features-section.test.tsx]
// a te dwa zdefiniuj tak:
const getSubjectDataMock = vi.fn();
const getMapPreviewMock = vi.fn();
vi.mock("@/app/actions/get-subject-data", () => ({
  getSubjectData: (...a: unknown[]) => getSubjectDataMock(...a),
}));
vi.mock("@/app/actions/get-map-preview", () => ({
  getMapPreview: (...a: unknown[]) => getMapPreviewMock(...a),
}));

import { NewValuationForm } from "@/app/valuations/new/new-valuation-form";

afterEach(cleanup);

const proposal = (obreb: string) => ({
  proposal: {
    parcel: { parcelId: "x", obreb, arkusz: "1", nrDzialki: "1", powEwidHa: 0.1, uzytek: "B" },
    building: null,
    mpzp: null,
    meta: {
      x: 1,
      y: 2,
      teryt: "306401",
      fetchedAt: "2026-07-22T10:00:00Z",
      source: "t",
      mpzpAbsent: true,
    },
  },
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("map preview race (Slice 9 follow-up)", () => {
  it("drops a stale map-preview response when a newer address fetch started", async () => {
    const first = deferred<{ ewidencyjna: string; orto: string }>();
    getSubjectDataMock.mockResolvedValue(proposal("Jeżyce"));
    getMapPreviewMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce({
      ewidencyjna: "bmV3ZXI=",
      orto: "bmV3ZXIy",
    });

    render(<NewValuationForm />);
    const address = screen.getByLabelText(/Adres/);
    fireEvent.change(address, { target: { value: "Kościelna 33" } });
    fireEvent.blur(address);
    await waitFor(() => expect(getMapPreviewMock).toHaveBeenCalledTimes(1));

    fireEvent.change(address, { target: { value: "Głogowska 40" } });
    fireEvent.blur(address);
    await waitFor(() => expect(getMapPreviewMock).toHaveBeenCalledTimes(2));
    // newer preview settled first…
    await waitFor(() =>
      expect((screen.getByAltText("Mapa ewidencyjna działki") as HTMLImageElement).src).toContain(
        "bmV3ZXI=",
      ),
    );
    // …then the STALE first response resolves late — must NOT clobber it
    first.resolve({ ewidencyjna: "c3RhbGU=", orto: "c3RhbGUy" });
    await waitFor(() =>
      expect((screen.getByAltText("Mapa ewidencyjna działki") as HTMLImageElement).src).toContain(
        "bmV3ZXI=",
      ),
    );
    expect((screen.getByAltText("Mapa ewidencyjna działki") as HTMLImageElement).src).not.toContain(
      "c3RhbGU=",
    );
  });
});
```

Uwaga dla implementera (advisor M-3): `rtl-features-section.test.tsx` ustawia `process.env.NEXT_PUBLIC_SUBJECT_AUTOFETCH = "off"` DIRECT-ASSIGNEM na module-scope (nie `vi.stubEnv`) i NIE mockuje `get-map-preview` — kopiując harness (a) NIE przenoś tego przypisania / nadpisz je pustym stringiem PRZED renderem (autofetch musi być WŁĄCZONY), (b) własne mocki `get-subject-data`/`get-map-preview` z tego planu są obowiązkowe. Czerwony `waitFor(getMapPreviewMock).toHaveBeenCalledTimes(1)` = autofetch został wyłączony. Label adresu dopasuj do faktycznego w formularzu (sprawdź `new-valuation-form.tsx`).

- [ ] **Step 2: Run — FAIL** — `pnpm vitest run tests/rtl-map-preview-race.test.tsx` → ostatnia asercja czerwona (stale nadpisuje).
- [ ] **Step 3: Fix** — w `fetchSubject` (`new-valuation-form.tsx:258-265`) domknij `seq` w callbacku:

```tsx
setMapPreview({ status: "loading" });
void getMapPreview({ address }).then((preview) => {
  if (seq !== fetchSeq.current) return; // stale preview — a newer fetch owns the section
  setMapPreview(
    "unavailable" in preview
      ? { status: "unavailable", message: preview.unavailable }
      : { status: "done", ewidencyjna: preview.ewidencyjna, orto: preview.orto },
  );
});
```

- [ ] **Step 4: Run — PASS** — cały plik + `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`.
- [ ] **Step 5: Commit** — `fix(web): drop stale map preview response after address change`

---

### Task 1: Worker — czysta obróbka zdjęcia (Pillow)

**Files:**

- Modify: `apps/worker/pyproject.toml` (dependencies: + `"pillow>=11.0"`)
- Create: `apps/worker/app/photo.py`
- Test: `apps/worker/tests/test_photo_core.py`

**Interfaces:**

- Produces: `photo.process_photo(data: bytes) -> tuple[bytes, int, int]` (JPEG bytes, width, height); `photo.MAX_PHOTO_BYTES = 10 * 1024 * 1024`. Rzuca wyjątek Pillow na nie-obrazie/bombie (endpoint w Task 2 mapuje na 415).

- [ ] **Step 1: Add dep** — `cd apps/worker && uv add "pillow>=11.0"` (aktualizuje pyproject + uv.lock; Dockerfile bez zmian — manylinux wheel).
- [ ] **Step 2: Failing tests** — `apps/worker/tests/test_photo_core.py`:

```python
"""Photo processing core tests (Slice 10, FR-2).

EXIF fixtures are SYNTHETIC — generated by Pillow in-test (F-9: no real
photos, no real GPS). Stripping is proven by marker-level scan of the output
bytes (no APP1/Exif segment), which covers GPS a fortiori.
"""

from io import BytesIO

import pytest
from PIL import Image

from app.photo import MAX_PHOTO_BYTES, process_photo


def jpeg_with_exif(width: int, height: int, orientation: int | None = None) -> bytes:
    img = Image.new("RGB", (width, height), (120, 30, 30))
    exif = Image.Exif()
    exif[0x010F] = "TestCam"          # Make — device metadata (RODO target)
    exif[0x0110] = "TestCam Model X"  # Model
    if orientation is not None:
        exif[0x0112] = orientation
    out = BytesIO()
    img.save(out, format="JPEG", exif=exif.tobytes())
    return out.getvalue()


def png_with_alpha(width: int, height: int) -> bytes:
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))  # fully transparent
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def has_app1_exif(data: bytes) -> bool:
    """Marker-level scan: any APP1 segment starting with b'Exif' before SOS."""
    i = 2
    while i + 4 < len(data) and data[i] == 0xFF:
        marker, seglen = data[i + 1], int.from_bytes(data[i + 2 : i + 4], "big")
        if marker == 0xDA:
            break
        if marker == 0xE1 and data[i + 4 : i + 8] == b"Exif":
            return True
        i += 2 + seglen
    return False


def test_output_is_jpeg_without_exif():
    src = jpeg_with_exif(300, 200)
    assert has_app1_exif(src)  # sanity: the fixture really carries EXIF
    out, w, h = process_photo(src)
    assert out[:3] == b"\xff\xd8\xff"
    assert not has_app1_exif(out)
    assert Image.open(BytesIO(out)).getexif() == {}  # belt and suspenders
    assert (w, h) == (300, 200)


def test_downscales_long_side_to_1200():
    out, w, h = process_photo(jpeg_with_exif(2400, 1600))
    assert (w, h) == (1200, 800)
    assert Image.open(BytesIO(out)).size == (1200, 800)


def test_never_upscales():
    _, w, h = process_photo(jpeg_with_exif(800, 600))
    assert (w, h) == (800, 600)


def test_orientation_transposed_before_strip():
    # Orientation=6 (90° CW): a 400x300 sensor image must come out 300x400.
    _, w, h = process_photo(jpeg_with_exif(400, 300, orientation=6))
    assert (w, h) == (300, 400)


def test_png_alpha_flattened_to_white_jpeg():
    out, w, h = process_photo(png_with_alpha(50, 40))
    img = Image.open(BytesIO(out))
    assert img.format == "JPEG"
    assert img.getpixel((25, 20)) == (255, 255, 255)


def test_garbage_raises():
    with pytest.raises(Exception):
        process_photo(b"not an image at all")


def test_max_photo_bytes_constant():
    assert MAX_PHOTO_BYTES == 10 * 1024 * 1024
```

- [ ] **Step 3: Run — FAIL** — `uv run pytest tests/test_photo_core.py -q` → `ModuleNotFoundError: app.photo`.
- [ ] **Step 4: Implement** — `apps/worker/app/photo.py`:

```python
"""Photo processing core (Slice 10, FR-2): EXIF-orientation transpose ->
downscale -> JPEG re-encode.

RODO: the re-encode is the strip — Pillow's save() writes NO metadata unless
an exif= argument is passed, so GPS/device EXIF (JPEG) and textual chunks
(PNG) cannot survive by construction. exif_transpose runs FIRST, otherwise
phone photos (Orientation 3/6/8) would lose their rotation with the metadata.

Pure — no I/O, no FastAPI import (endpoint lives in main.py). Pillow's
default MAX_IMAGE_PIXELS decompression-bomb guard stays active; a bomb
raises like any other unreadable input and main.py maps it to 415.
"""

from io import BytesIO

from PIL import Image, ImageOps

MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_LONG_SIDE = 1200
JPEG_QUALITY = 85


def process_photo(data: bytes) -> tuple[bytes, int, int]:
    img = Image.open(BytesIO(data))
    img = ImageOps.exif_transpose(img)
    img.thumbnail((MAX_LONG_SIDE, MAX_LONG_SIDE))  # downscale-only, keeps aspect
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")
    out = BytesIO()
    img.save(out, format="JPEG", quality=JPEG_QUALITY)
    return out.getvalue(), img.width, img.height
```

- [ ] **Step 5: Run — PASS** — `uv run pytest tests/test_photo_core.py -q && uv run ruff check .`
- [ ] **Step 6: Commit** — `feat(worker): photo processing core - exif strip via re-encode, 1200px downscale (fr-2)` (dodaj też `pyproject.toml`/`uv.lock`).

---

### Task 2: Worker — endpoint `POST /photo-process`

**Files:**

- Modify: `apps/worker/app/main.py` (za `/kw-extract`, `main.py:411`)
- Test: `apps/worker/tests/test_photo_process.py`

**Interfaces:**

- Consumes: `photo.process_photo`, `kw_core.verify_token` (istnieje, `kw.py`).
- Produces: `POST /photo-process` multipart `{file, token}` → JSON `{"photo": <base64 JPEG>, "width": int, "height": int}`; 401 zły token, 413 >10 MB, 415 zły typ/nieczytelny obraz. **F-11: żadnych wartości rynkowych.**

- [ ] **Step 1: Failing tests** — `apps/worker/tests/test_photo_process.py` (wzorzec tokenów/klienta z `tests/test_kw_extract.py` — sprawdź tam jak monkeypatchowany jest `WORKER_SHARED_SECRET` i zbuduj token identycznie):

```python
import base64
import hashlib
import hmac
import time
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)
SECRET = "test-secret"


def make_token(secret: str = SECRET, exp_delta: int = 300) -> str:
    exp = int(time.time()) + exp_delta
    sig = hmac.new(secret.encode(), f"{exp}.n0nce".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.n0nce.{sig}"


def jpeg_bytes(w: int = 20, h: int = 10) -> bytes:
    out = BytesIO()
    Image.new("RGB", (w, h), (10, 20, 30)).save(out, format="JPEG")
    return out.getvalue()


def post_photo(data: bytes, token: str, content_type: str = "image/jpeg"):
    return client.post(
        "/photo-process",
        files={"file": ("p.jpg", data, content_type)},
        data={"token": token},
    )


def test_valid_upload_returns_processed_base64(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    r = post_photo(jpeg_bytes(2400, 1200), make_token())
    assert r.status_code == 200
    body = r.json()
    assert (body["width"], body["height"]) == (1200, 600)
    out = base64.standard_b64decode(body["photo"])
    assert out[:3] == b"\xff\xd8\xff"
    assert set(body) == {"photo", "width", "height"}  # F-11: nothing else


def test_bad_token_401(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    assert post_photo(jpeg_bytes(), "1.2.deadbeef").status_code == 401


def test_expired_token_401(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    assert post_photo(jpeg_bytes(), make_token(exp_delta=-10)).status_code == 401


def test_wrong_content_type_415(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    assert post_photo(b"%PDF-1.4", make_token(), "application/pdf").status_code == 415


def test_unreadable_image_415(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    assert post_photo(b"garbage-bytes", make_token()).status_code == 415


def test_oversize_413(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", SECRET)
    big = jpeg_bytes() + b"\x00" * (10 * 1024 * 1024)
    assert post_photo(big, make_token()).status_code == 413
```

- [ ] **Step 2: Run — FAIL** — `uv run pytest tests/test_photo_process.py -q` → 404 na `/photo-process`.
- [ ] **Step 3: Implement** — `apps/worker/app/main.py`: import `from app import photo as photo_core` (obok istniejących), po `/kw-extract`:

```python
class PhotoProcessResponse(BaseModel):
    """Processed inspection photo (Slice 10, FR-2). F-11: images only, no market values."""

    photo: str  # base64 JPEG — resized to <=1200 px long side, EXIF stripped by re-encode
    width: int
    height: int


@app.post("/photo-process")
def photo_process(
    file: UploadFile = File(...),
    token: str = Form(...),
) -> PhotoProcessResponse:
    secret = os.environ.get("WORKER_SHARED_SECRET", "")
    if not secret or not kw_core.verify_token(token, secret, time.time()):
        raise HTTPException(
            status_code=401,
            detail="Nieprawidłowy lub wygasły token — odśwież stronę i spróbuj ponownie.",
        )
    if file.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(status_code=415, detail="Obsługiwane są wyłącznie zdjęcia JPEG i PNG.")
    data = file.file.read()
    if len(data) > photo_core.MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Plik jest za duży (limit 10 MB).")
    try:
        jpeg, width, height = photo_core.process_photo(data)
    except Exception as exc:  # unreadable image / decompression bomb — same user answer
        logger.error("photo processing failed: %s", exc)
        raise HTTPException(
            status_code=415,
            detail="Nie udało się odczytać zdjęcia — wgraj plik JPEG lub PNG.",
        ) from exc
    # File bytes are never persisted or logged: `data` dies with this request (RODO).
    return PhotoProcessResponse(
        photo=base64.standard_b64encode(jpeg).decode(), width=width, height=height
    )
```

- [ ] **Step 4: Run — PASS** — `uv run pytest -q && uv run ruff check .` (CAŁY suite — bez regresji).
- [ ] **Step 5: Commit** — `feat(worker): post /photo-process endpoint - hmac token, 10mb limit (fr-2)`

---

### Task 3: Web — czysta warstwa: jpeg utils + domena inspekcji + audyt

**Files:**

- Create: `apps/web/src/lib/jpeg.ts`
- Create: `apps/web/src/domain/inspection.ts`
- Modify: `apps/web/src/domain/kcs.ts:71-74` (po `kwMeta`), `apps/web/src/domain/valuation.ts` (po `confirmFeaturesProvenance` i w `AUDIT_ACTIONS`)
- Test: `apps/web/tests/jpeg-utils.test.ts`, `apps/web/tests/inspection-domain.test.ts`

**Interfaces (Produces):**

```ts
// lib/jpeg.ts
export function isJpeg(buf: Buffer): boolean;
export function hasApp1(buf: Buffer): boolean; // KAŻDY APP1 (Exif ORAZ XMP — XMP też niesie GPS; advisor I-2)
export function jpegDimensions(buf: Buffer): { width: number; height: number } | null;
export function fitBox(
  dims: { width: number; height: number },
  box: [number, number],
): [number, number];

// domain/inspection.ts
export const INSPECTION_SECTIONS = ["otoczenie", "budynekZewn", "wnetrza"] as const;
export type InspectionSection = (typeof INSPECTION_SECTIONS)[number];
export type InspectionSnapshot = {
  note: string | null;
  photos: Record<InspectionSection, string[]>; // document-table keys, upload order
};
/** Bajty per sekcja do renderu — typ ŻYJE W DOMENIE (czysty, type-only Buffer), bo
 *  depcruise zabrania importów lib→adapters nawet dla typów (advisor BLOCKER 1). */
export type RenderPhotos = Record<InspectionSection, Buffer[]>;
export const EMPTY_INSPECTION: InspectionSnapshot;
export const MAX_INSPECTION_PHOTOS = 50;
export function totalInspectionPhotos(i: InspectionSnapshot | null | undefined): number;
export function buildPhotoKey(
  section: InspectionSection,
  uuid: string,
  valuationId: string,
): string; // ogledziny-{slug}-{uuid}-{valuationId}.jpg ; slug: otoczenie|budynek|wnetrza
export function isOwnPhotoKey(key: string, valuationId: string): boolean; // key.endsWith(`-${valuationId}.jpg`)

// domain/valuation.ts
export type InspectionOp =
  | { kind: "add_photo"; section: InspectionSection; key: string }
  | { kind: "remove_photo"; section: InspectionSection; key: string }
  | { kind: "set_note"; note: string };
export function applyInspectionOp(v: Valuation, op: InspectionOp): Valuation; // assertDraft + throw on missing inputs / cap / duplicate
export class InspectionLimitError extends Error {}
// AUDIT_ACTIONS: + "inspection_updated"
```

- [ ] **Step 1: Failing tests** — `tests/jpeg-utils.test.ts` (bufory konstruowane bajt po bajcie — F-9-czyste):

```ts
import { describe, expect, it } from "vitest";
import { fitBox, hasApp1, isJpeg, jpegDimensions } from "../src/lib/jpeg";

/** Minimal marker stream: SOI + segments; SOF0 carries [prec, H, H, W, W]. */
function jpegOf(segments: Array<{ marker: number; payload: Buffer }>): Buffer {
  const parts = [Buffer.from([0xff, 0xd8])];
  for (const s of segments) {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(s.payload.length + 2);
    parts.push(Buffer.from([0xff, s.marker]), len, s.payload);
  }
  return Buffer.concat(parts);
}
const sof0 = (w: number, h: number) => {
  const p = Buffer.alloc(5);
  p[0] = 8;
  p.writeUInt16BE(h, 1);
  p.writeUInt16BE(w, 3);
  return { marker: 0xc0, payload: p };
};
const exifApp1 = {
  marker: 0xe1,
  payload: Buffer.concat([Buffer.from("Exif\0\0"), Buffer.alloc(4)]),
};
const xmpApp1 = { marker: 0xe1, payload: Buffer.from("http://ns.adobe.com/xap/1.0/\0") };

describe("jpeg utils", () => {
  it("isJpeg checks the SOI+marker magic", () => {
    expect(isJpeg(jpegOf([sof0(10, 20)]))).toBe(true);
    expect(isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(Buffer.alloc(0))).toBe(false);
  });
  it("hasApp1 rejects EVERY APP1 segment — Exif AND XMP (XMP carries GPS too)", () => {
    expect(hasApp1(jpegOf([exifApp1, sof0(10, 20)]))).toBe(true);
    expect(hasApp1(jpegOf([xmpApp1, sof0(10, 20)]))).toBe(true); // advisor I-2: XMP-GPS bypass
    expect(hasApp1(jpegOf([sof0(10, 20)]))).toBe(false);
  });
  it("jpegDimensions reads SOF0 landscape and portrait", () => {
    expect(jpegDimensions(jpegOf([sof0(1200, 800)]))).toEqual({ width: 1200, height: 800 });
    expect(jpegDimensions(jpegOf([exifApp1, sof0(600, 900)]))).toEqual({ width: 600, height: 900 });
    expect(jpegDimensions(Buffer.from("plain text"))).toBeNull();
  });
  it("fitBox preserves aspect, landscape and portrait, and never upscales", () => {
    expect(fitBox({ width: 1200, height: 800 }, [600, 450])).toEqual([600, 400]);
    expect(fitBox({ width: 800, height: 1200 }, [600, 450])).toEqual([300, 450]);
    expect(fitBox({ width: 300, height: 200 }, [600, 450])).toEqual([300, 200]);
  });
});
```

`tests/inspection-domain.test.ts` — na fikcyjnej wycenie draft (wzorzec fixture z `tests/fixtures/valuation-inputs.ts` — użyj `approvableInput()` jako `inputs`):

```ts
import { describe, expect, it } from "vitest";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput } from "./fixtures/valuation-inputs";
import { AUDIT_ACTIONS, InspectionLimitError, applyInspectionOp } from "../src/domain/valuation";
import {
  EMPTY_INSPECTION,
  MAX_INSPECTION_PHOTOS,
  buildPhotoKey,
  isOwnPhotoKey,
  totalInspectionPhotos,
} from "../src/domain/inspection";

const VID = "11111111-2222-3333-4444-555555555555";
const draft = (): Valuation =>
  ({
    id: VID,
    status: "in_progress",
    ownerId: "owner-1",
    inputs: approvableInput(),
  }) as unknown as Valuation;

describe("applyInspectionOp", () => {
  it("add_photo appends the key to the right section, creating the snapshot lazily", () => {
    const key = buildPhotoKey("wnetrza", "u-1", VID);
    const v = applyInspectionOp(draft(), { kind: "add_photo", section: "wnetrza", key });
    expect(v.inputs!.inspection!.photos.wnetrza).toEqual([key]);
    expect(v.inputs!.inspection!.photos.otoczenie).toEqual([]);
    expect(v.inputs!.inspection!.note).toBeNull();
  });
  it("add_photo refuses a duplicate key and the 50-photo cap", () => {
    let v = draft();
    const key = buildPhotoKey("otoczenie", "u-dup", VID);
    v = applyInspectionOp(v, { kind: "add_photo", section: "otoczenie", key });
    expect(() => applyInspectionOp(v, { kind: "add_photo", section: "otoczenie", key })).toThrow();
    for (let i = 1; i < MAX_INSPECTION_PHOTOS; i++) {
      v = applyInspectionOp(v, {
        kind: "add_photo",
        section: "wnetrza",
        key: buildPhotoKey("wnetrza", `u-${i}`, VID),
      });
    }
    expect(totalInspectionPhotos(v.inputs!.inspection)).toBe(MAX_INSPECTION_PHOTOS);
    expect(() =>
      applyInspectionOp(v, {
        kind: "add_photo",
        section: "budynekZewn",
        key: buildPhotoKey("budynekZewn", "u-over", VID),
      }),
    ).toThrow(InspectionLimitError);
  });
  it("remove_photo drops the key; removing a missing key is a no-op", () => {
    const key = buildPhotoKey("budynekZewn", "u-2", VID);
    let v = applyInspectionOp(draft(), { kind: "add_photo", section: "budynekZewn", key });
    v = applyInspectionOp(v, { kind: "remove_photo", section: "budynekZewn", key });
    expect(v.inputs!.inspection!.photos.budynekZewn).toEqual([]);
    expect(() =>
      applyInspectionOp(v, { kind: "remove_photo", section: "budynekZewn", key: "nope" }),
    ).not.toThrow();
  });
  it("set_note trims and stores null for the empty string", () => {
    const v = applyInspectionOp(draft(), { kind: "set_note", note: "  Lokal po remoncie.  " });
    expect(v.inputs!.inspection!.note).toBe("Lokal po remoncie.");
    const cleared = applyInspectionOp(v, { kind: "set_note", note: "   " });
    expect(cleared.inputs!.inspection!.note).toBeNull();
  });
  it("refuses non-draft and missing inputs (F-7 siblings' contract)", () => {
    const signed = { ...draft(), status: "signed" } as Valuation;
    expect(() => applyInspectionOp(signed, { kind: "set_note", note: "x" })).toThrow(/not a draft/);
    const noInputs = { ...draft(), inputs: null } as Valuation;
    expect(() => applyInspectionOp(noInputs, { kind: "set_note", note: "x" })).toThrow(/no inputs/);
  });
});

describe("inspection keys + audit action", () => {
  it("buildPhotoKey/isOwnPhotoKey embed and detect the valuation id", () => {
    const key = buildPhotoKey("budynekZewn", "abc", VID);
    expect(key).toBe(`ogledziny-budynek-abc-${VID}.jpg`);
    expect(isOwnPhotoKey(key, VID)).toBe(true);
    expect(isOwnPhotoKey(key, "other-id")).toBe(false);
  });
  it("AUDIT_ACTIONS gained exactly inspection_updated", () => {
    expect(AUDIT_ACTIONS).toContain("inspection_updated");
    expect(AUDIT_ACTIONS).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run — FAIL** — `pnpm vitest run tests/jpeg-utils.test.ts tests/inspection-domain.test.ts`.
- [ ] **Step 3: Implement** — `apps/web/src/lib/jpeg.ts`:

```ts
/**
 * Byte-level JPEG helpers (Slice 10) — the SERVER-SIDE trust boundary for
 * inspection photos. Processed bytes arrive from the CLIENT (unlike maps,
 * which the server fetched itself), so the RODO guarantee "no EXIF/GPS in
 * the operat" must be enforced here, independently of the worker: magic
 * bytes, APP1/Exif absence, and dimensions all checked on raw bytes.
 * Pure — no I/O, no deps (F-10-friendly, usable from domain-adjacent code).
 */

export function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * Walks JPEG segments up to SOS; true iff ANY APP1 segment exists. APP1
 * carries Exif (GPS/device) but ALSO XMP — and XMP can carry GPS too
 * (exif:GPSLatitude), so an "Exif"-only check would leave an XMP bypass
 * (advisor I-2). The worker's Pillow re-encode emits NO APP1 at all, so
 * rejecting every APP1 has zero false positives on legit uploads.
 */
export function hasApp1(buf: Buffer): boolean {
  if (!isJpeg(buf)) return false;
  let off = 2;
  while (off + 4 < buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    if (marker === 0xda) break; // SOS — entropy-coded data, no more metadata
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xe1) {
      return true;
    }
    off += 2 + len;
  }
  return false;
}

/** Reads dimensions from the first SOF0-SOF15 frame header (C4/C8/CC are not SOFs). */
export function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (!isJpeg(buf)) return null;
  let off = 2;
  while (off + 9 < buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    if (marker === 0xda) break;
    const len = buf.readUInt16BE(off + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

/** Scales dims to fit box (w,h), preserving aspect; never upscales. */
export function fitBox(
  dims: { width: number; height: number },
  box: [number, number],
): [number, number] {
  const scale = Math.min(box[0] / dims.width, box[1] / dims.height, 1);
  return [Math.round(dims.width * scale), Math.round(dims.height * scale)];
}
```

`apps/web/src/domain/inspection.ts`:

```ts
/**
 * Inspection snapshot (Slice 10, FR-2) — the photo-key MANIFEST + note.
 *
 * The manifest is load-bearing, not cosmetic: PortStorage has only
 * put/get/delete (no listing), so inputs.inspection is the ONLY place the
 * complete key set lives. Approve reads it live; sign reads it from the
 * FROZEN inputs — approve↔sign determinism follows from the same keys.
 * Keys embed the owning valuationId: an inherited key (versioning, Slice 8
 * newVersionOf copies inputs) fails isOwnPhotoKey and must never be
 * storage.delete()d by the new version.
 */

export const INSPECTION_SECTIONS = ["otoczenie", "budynekZewn", "wnetrza"] as const;
export type InspectionSection = (typeof INSPECTION_SECTIONS)[number];

export type InspectionSnapshot = {
  note: string | null;
  /** document-table keys per section; array order = upload order = render order. */
  photos: Record<InspectionSection, string[]>;
};

export const EMPTY_INSPECTION: InspectionSnapshot = {
  note: null,
  photos: { otoczenie: [], budynekZewn: [], wnetrza: [] },
};

/** Global cap (benchmark: the reference operat carries 42 photos). */
export const MAX_INSPECTION_PHOTOS = 50;

const SECTION_SLUG: Record<InspectionSection, string> = {
  otoczenie: "otoczenie",
  budynekZewn: "budynek",
  wnetrza: "wnetrza",
};

export function totalInspectionPhotos(i: InspectionSnapshot | null | undefined): number {
  if (!i) return 0;
  return INSPECTION_SECTIONS.reduce((sum, s) => sum + i.photos[s].length, 0);
}

export function buildPhotoKey(
  section: InspectionSection,
  uuid: string,
  valuationId: string,
): string {
  return `ogledziny-${SECTION_SLUG[section]}-${uuid}-${valuationId}.jpg`;
}

export function isOwnPhotoKey(key: string, valuationId: string): boolean {
  return key.endsWith(`-${valuationId}.jpg`);
}
```

`domain/kcs.ts` — w `KcsInput` po `kwMeta` (import type z `./inspection`):

```ts
  /** Inspection photos manifest + note (Slice 10, FR-2) — display/render only; computeKcs never reads this. */
  inspection?: InspectionSnapshot | null;
```

`domain/valuation.ts` — `AUDIT_ACTIONS` + `"inspection_updated"` (po `"features_confirmed"`), oraz po `confirmFeaturesProvenance`:

```ts
export class InspectionLimitError extends Error {
  constructor() {
    super(`Inspection photo limit reached (${MAX_INSPECTION_PHOTOS})`);
    this.name = "InspectionLimitError";
  }
}

export type InspectionOp =
  | { kind: "add_photo"; section: InspectionSection; key: string }
  | { kind: "remove_photo"; section: InspectionSection; key: string }
  | { kind: "set_note"; note: string };

/**
 * Draft-only inspection mutation (Slice 10) — the manifest sibling of the
 * confirm* family: assertDraft + throw-on-missing-inputs, pure, persisted
 * by the adapter in one tx with the `inspection_updated` audit row.
 */
export function applyInspectionOp(v: Valuation, op: InspectionOp): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  }
  const current = v.inputs.inspection ?? EMPTY_INSPECTION;
  let inspection: InspectionSnapshot;
  if (op.kind === "add_photo") {
    if (totalInspectionPhotos(current) >= MAX_INSPECTION_PHOTOS) {
      throw new InspectionLimitError();
    }
    if (INSPECTION_SECTIONS.some((s) => current.photos[s].includes(op.key))) {
      throw new Error(`Photo key already present: ${op.key}`);
    }
    inspection = {
      ...current,
      photos: { ...current.photos, [op.section]: [...current.photos[op.section], op.key] },
    };
  } else if (op.kind === "remove_photo") {
    inspection = {
      ...current,
      photos: {
        ...current.photos,
        [op.section]: current.photos[op.section].filter((k) => k !== op.key),
      },
    };
  } else {
    const note = op.note.trim();
    inspection = { ...current, note: note.length > 0 ? note : null };
  }
  return { ...v, inputs: { ...v.inputs, inspection } };
}
```

(importy w `valuation.ts`: `EMPTY_INSPECTION, INSPECTION_SECTIONS, MAX_INSPECTION_PHOTOS, totalInspectionPhotos, type InspectionSection, type InspectionSnapshot` z `./inspection`.)

- [ ] **Step 4: Run — PASS** — oba pliki + pełny gate web.
- [ ] **Step 5: Commit** — `feat(web): inspection domain - photo manifest, jpeg trust-boundary utils, audit action (fr-2)`

---

### Task 4: Repo — `updateInspection` (tx + CAS + audit)

**Files:**

- Modify: `apps/web/src/ports/valuation.ts` (interfejs), `apps/web/src/adapters/valuation-drizzle.ts` (po `confirmFeatures`)
- Test: `apps/web/tests/valuation-repo.test.ts` (rozszerzenie — dopasuj do konwencji setupu tego pliku)

**Interfaces:**

- Produces: `PortValuation.updateInspection(id: string, user: SessionUser, op: InspectionOp): Promise<Valuation | null>` — null = brak/nie-owner/CAS przegrany; throw z domeny (nie-draft, cap, duplikat).

- [ ] **Step 1: Failing tests** — do `tests/valuation-repo.test.ts` dopisz describe (użyj tego samego helpera tworzenia drafta co testy `confirmSample` w tym pliku; wzoruj asercje audytu na istniejących):

```ts
describe("updateInspection", () => {
  it("adds a photo key, audits inspection_updated with op meta, in one tx", async () => {
    // create draft (existing helper), then:
    const key = buildPhotoKey("wnetrza", "u-1", created.id);
    const updated = await repo.updateInspection(created.id, owner, {
      kind: "add_photo",
      section: "wnetrza",
      key,
    });
    expect(updated!.inputs!.inspection!.photos.wnetrza).toEqual([key]);
    // audit row: action inspection_updated, meta { op: "photo_added", section: "wnetrza", total: 1 }
  });
  it("returns null for a non-owner and refuses a non-draft (throw)", async () => {
    // mirror confirmSample's ownership-null + status-throw cases
  });
  it("set_note persists the trimmed note", async () => {
    const updated = await repo.updateInspection(created.id, owner, {
      kind: "set_note",
      note: " N ",
    });
    expect(updated!.inputs!.inspection!.note).toBe("N");
  });
});
```

(Kompletny kod dopasowuje implementer do faktycznych helperów pliku — asercja audytu przez select z `schema.auditLog` jak w istniejących testach audytu; patrz `tests/audit-log.test.ts`.)

- [ ] **Step 2: Run — FAIL**.
- [ ] **Step 3: Implement** — `ports/valuation.ts` (import type `InspectionOp` z `../domain/valuation`):

```ts
  /**
   * Applies a draft-only inspection mutation (photo add/remove, note) and
   * records ONE `inspection_updated` audit row in the same transaction.
   * Same null/throw contract as `confirmSample`.
   */
  updateInspection(id: string, user: SessionUser, op: InspectionOp): Promise<Valuation | null>;
```

`adapters/valuation-drizzle.ts` (po `confirmFeatures`; import `applyInspectionOp`, `totalInspectionPhotos` — ten drugi z `../domain/inspection`):

```ts
    async updateInspection(id, user, op) {
      return db.transaction(async (tx) => {
        // .for("update") — UNLIKE the confirm* siblings: the manifest is a
        // read-modify-write on inputs jsonb and photo uploads repeat, so two
        // tabs adding photos concurrently would lose a manifest key (last
        // write wins) and orphan its bytes (advisor I-1). The row lock
        // serializes writers; confirm* flips are idempotent so they stay as-is.
        const [row] = await tx
          .select()
          .from(schema.valuation)
          .where(eq(schema.valuation.id, id))
          .for("update");
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = applyInspectionOp(valuation, op);
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "inspection_updated",
          meta: {
            op:
              op.kind === "add_photo"
                ? "photo_added"
                : op.kind === "remove_photo"
                  ? "photo_removed"
                  : "note_updated",
            ...(op.kind !== "set_note" ? { section: op.section } : {}),
            total: totalInspectionPhotos(updated.inputs?.inspection),
          },
        });
        return toValuation(saved);
      });
    },
```

- [ ] **Step 4: Run — PASS** — plik + pełny gate.
- [ ] **Step 5: Commit** — `feat(web): valuation repo updateInspection - cas draft guard + audit in tx (fr-2)`

---

### Task 5: Server actions + klient przeglądarkowy

**Files:**

- Create: `apps/web/src/app/actions/inspection.ts`
- Create: `apps/web/src/lib/photo-process-client.ts`
- Test: `apps/web/tests/inspection-actions.test.ts`

**Interfaces:**

- Produces (server actions, wszystkie session-gated):
  - `uploadInspectionPhoto(valuationId: string, section: InspectionSection, form: FormData /* "photo": File|Blob */): Promise<{ key: string } | { error: string }>`
  - `removeInspectionPhoto(valuationId: string, section: InspectionSection, key: string): Promise<{ error: string } | undefined>`
  - `saveInspectionNote(valuationId: string, note: string): Promise<{ error: string } | undefined>`
- Produces (klient): `processPhoto(args: { file: File; token: string; workerUrl: string }): Promise<{ kind: "ok"; blob: Blob } | { kind: "error"; message: string; retryable: boolean }>`

- [ ] **Step 1: Failing tests** — `tests/inspection-actions.test.ts`, wzorzec automocków 1:1 z `tests/approve-valuation-action.test.ts:30-52` (`vi.mock("@/auth/session")`, `vi.mock("@/app/valuations/_deps")`, `next/cache`/`next/navigation`; `.findLast()` na mock.calls). Fixture JPEG: zbuduj funkcją `jpegOf`/`sof0` jak w `tests/jpeg-utils.test.ts` (wyekstrahuj te helpery do `tests/fixtures/jpeg-fixtures.ts` i importuj w OBU testach). Przypadki:

```ts
// happy path: valid JPEG (no EXIF, 800x600) -> storage.put called with key
//   matching /^ogledziny-budynek-[0-9a-f-]+-vid\.jpg$/, repo.updateInspection
//   called with { kind: "add_photo", section: "budynekZewn", key: <same> },
//   returns { key }
// trust boundary — each returns { error } and NEVER calls storage.put:
//   - PNG magic bytes (0x89 0x50...) -> "Nieprawidłowy plik zdjęcia."
//   - JPEG with EXIF APP1 (jpegOf([exifApp1, sof0(800,600)])) -> error
//   - JPEG with XMP APP1 (jpegOf([xmpApp1, sof0(800,600)])) -> error (XMP-GPS bypass, advisor I-2)
//   - JPEG 1600x900 (dims > 1200) -> error
//   - payload > 2 MB (jpegOf + 2MB padding after SOS... simplest: Buffer.concat([validJpeg, Buffer.alloc(2*1024*1024)]) -> size check fires first) -> error
// cap: repo.updateInspection throws InspectionLimitError -> { error: "Limit 50 zdjęć..." } AND storage.delete(key) called (compensation)
// repo returns null (not owner / not draft / CAS lost) -> { error } + storage.delete(key) compensation
// removeInspectionPhoto: repo null -> error; own key -> storage.delete called;
//   inherited key (ends with different id) -> storage.delete NOT called
// saveInspectionNote: note > 5000 chars -> { error }; happy -> repo op set_note
```

Napisz je jako pełne testy vitest (jak w approve-action-teście), z `getMock.mockResolvedValue(draftValuation)` itd.

- [ ] **Step 2: Run — FAIL**.
- [ ] **Step 3: Implement** — `app/actions/inspection.ts`:

```ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, valuationRepository } from "@/app/valuations/_deps";
import { InspectionLimitError } from "@/domain/valuation";
import {
  MAX_INSPECTION_PHOTOS,
  buildPhotoKey,
  isOwnPhotoKey,
  type InspectionSection,
  INSPECTION_SECTIONS,
} from "@/domain/inspection";
import { hasApp1, isJpeg, jpegDimensions } from "@/lib/jpeg";

/** Processed-photo hard ceiling: worker emits ~150-250 KB at 1200 px q85. */
const MAX_PROCESSED_BYTES = 2 * 1024 * 1024;
const MAX_NOTE_CHARS = 5000;
const MAX_DIM = 1200;

export type UploadInspectionPhotoResult = { key: string } | { error: string };

/**
 * TRUST BOUNDARY (spec §Bezpieczeństwo): unlike maps (server-fetched), these
 * bytes come from the CLIENT — a tampered client could bypass the worker and
 * post an unprocessed photo with GPS EXIF straight into a legal document.
 * Every guarantee is therefore re-checked here on raw bytes: JPEG magic,
 * APP1/Exif absence (the RODO guarantee), size and dimensions.
 */
export async function uploadInspectionPhoto(
  valuationId: string,
  section: InspectionSection,
  form: FormData,
): Promise<UploadInspectionPhotoResult> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!INSPECTION_SECTIONS.includes(section)) {
    return { error: "Nieznana sekcja zdjęć." };
  }
  const photo = form.get("photo");
  if (!(photo instanceof Blob)) {
    return { error: "Brak pliku zdjęcia." };
  }
  const bytes = Buffer.from(await photo.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_PROCESSED_BYTES) {
    return { error: "Nieprawidłowy plik zdjęcia." };
  }
  const dims = jpegDimensions(bytes);
  if (!isJpeg(bytes) || hasApp1(bytes) || !dims || Math.max(dims.width, dims.height) > MAX_DIM) {
    return { error: "Nieprawidłowy plik zdjęcia." };
  }

  const key = buildPhotoKey(section, randomUUID(), valuationId);
  try {
    await storage.put(key, bytes);
    const updated = await valuationRepository.updateInspection(valuationId, session.user, {
      kind: "add_photo",
      section,
      key,
    });
    if (!updated) {
      await storage.delete(key); // compensation — no manifest entry, no orphan bytes
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    if (error instanceof InspectionLimitError) {
      return { error: `Limit ${MAX_INSPECTION_PHOTOS} zdjęć na wycenę został osiągnięty.` };
    }
    console.error("uploadInspectionPhoto failed", error);
    return { error: "Nie udało się zapisać zdjęcia — spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${valuationId}`);
  return { key };
}

export async function removeInspectionPhoto(
  valuationId: string,
  section: InspectionSection,
  key: string,
): Promise<{ error: string } | undefined> {
  const session = await getSession();
  if (!session) redirect("/login");
  try {
    const updated = await valuationRepository.updateInspection(valuationId, session.user, {
      kind: "remove_photo",
      section,
      key,
    });
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
    // Manifest first, bytes second: a failed delete leaves an unreferenced
    // row (harmless), the reverse would leave a manifest key with no bytes
    // (sign would abort). Inherited keys (versioning) are NEVER deleted —
    // they belong to the superseded valuation's frozen history.
    if (isOwnPhotoKey(key, valuationId)) {
      await storage.delete(key);
    }
  } catch (error) {
    console.error("removeInspectionPhoto failed", error);
    return { error: "Nie udało się usunąć zdjęcia — spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${valuationId}`);
}

export async function saveInspectionNote(
  valuationId: string,
  note: string,
): Promise<{ error: string } | undefined> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (note.length > MAX_NOTE_CHARS) {
    return { error: `Notatka może mieć najwyżej ${MAX_NOTE_CHARS} znaków.` };
  }
  try {
    const updated = await valuationRepository.updateInspection(valuationId, session.user, {
      kind: "set_note",
      note,
    });
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("saveInspectionNote failed", error);
    return { error: "Nie udało się zapisać notatki — spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${valuationId}`);
}
```

`lib/photo-process-client.ts` (wzorzec `kw-extract-client.ts`):

```ts
/**
 * Browser-side client for the worker's POST /photo-process (Slice 10). The
 * file goes straight to the worker (Vercel body limit bypass, KW pattern);
 * the base64 response is decoded to a Blob the upload server action accepts.
 */

const GENERIC_ERROR = "Nie udało się przetworzyć zdjęcia — spróbuj ponownie.";

export type ProcessPhotoResult =
  { kind: "ok"; blob: Blob } | { kind: "error"; message: string; retryable: boolean };

async function detailOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail;
  } catch {
    return undefined;
  }
}

export async function processPhoto(args: {
  file: File;
  token: string;
  workerUrl: string;
}): Promise<ProcessPhotoResult> {
  const form = new FormData();
  form.set("file", args.file);
  form.set("token", args.token);
  let response: Response;
  try {
    response = await fetch(`${args.workerUrl}/photo-process`, { method: "POST", body: form });
  } catch {
    return { kind: "error", message: GENERIC_ERROR, retryable: true };
  }
  if (!response.ok) {
    return {
      kind: "error",
      message: (await detailOf(response)) ?? GENERIC_ERROR,
      retryable: response.status >= 500,
    };
  }
  const body = (await response.json()) as { photo?: string };
  if (!body.photo) {
    return { kind: "error", message: GENERIC_ERROR, retryable: false };
  }
  const bytes = Uint8Array.from(atob(body.photo), (c) => c.charCodeAt(0));
  return { kind: "ok", blob: new Blob([bytes], { type: "image/jpeg" }) };
}
```

- [ ] **Step 4: Run — PASS** — plik + pełny gate.
- [ ] **Step 5: Commit** — `feat(web): inspection server actions - trust-boundary validation, compensating delete (fr-2)`

---

### Task 6: Szablon — Stage 13 (bloki foto + uwagi) w `build_template.py`

**Files:**

- Modify (WIKI-REPO, `/Users/michalczekala/Development/wyceny/tools/spike/2026-07-15-template-koscielna/build_template.py`) — NIE commituj w wiki-repo (S6 PR); po przebudowie skopiuj binarkę do app-repo.
- Modify (app-repo, commit): `apps/web/templates/operat-szablon.docx` (regenerat)

**Interfaces:**

- Produces (tagi w szablonie, konsumowane w Task 7): sekcje bool `{#ma_foto_otoczenie}`/`{#ma_foto_budynek}`/`{#ma_foto_wnetrza}`/`{#ma_uwagi_ogledzin}`; pętle `{#foto_otoczenie}`/`{#foto_budynek}`/`{#foto_wnetrza}` po obiektach `{img: marker}` z tagiem obrazu `{%img}`; tekst `{uwagi_ogledzin}`. Po stage 13 `STUB_FOTO` NIE występuje w dokumencie.

- [ ] **Step 1:** W `build_template.py`, za Stage 12 (`apply_map_tags`, ~`:975`), dodaj Stage 13:

```python
# --------------------------------------------------------------------------
# Stage 13: inspection photo blocks (Slice 10, FR-2) — zip post-process like
# stage 12. Faithful to the source operat (brainstorm decision 5): road/
# surroundings photos in §8.1 AFTER the map block, building photos at the
# §8.3 STUB_FOTO spot, interior photos after the §8.3 "Opis lokalu" prose,
# note ("Uwagi z oględzin") after the interiors. All four STUB_FOTO
# paragraphs are removed (honest silence, decision 6) — which also removes
# the §8.1 duplicate-stub wording next to MAP_STUB (Slice 9 follow-up 0b).
# --------------------------------------------------------------------------
FOTO_INTRO_OTOCZENIE = ("Poniżej dokumentacja fotograficzna drogi dojazdowej oraz "
                        "bezpośredniego otoczenia, wg stanu aktualnego:")
FOTO_INTRO_BUDYNEK = ("Poniżej przedstawiono dokumentację fotograficzną budynku oraz "
                      "bezpośredniego otoczenia, wg stanu aktualnego:")
FOTO_INTRO_WNETRZA = ("Poniżej przedstawiono dokumentację fotograficzną lokalu "
                      "mieszkalnego, wg stanu aktualnego:")
UWAGI_LABEL = "Uwagi z oględzin:"
# The §8.3 interiors anchor: this sentence exists twice (Wyciąg r6 cell +
# §8.3 body) — the LAST occurrence is the §8.3 one.
WNETRZA_ANCHOR = "Szczegółowy opis układu funkcjonalnego zostanie uzupełniony po oględzinach."
OTOCZENIE_ANCHOR = "{^mapy}" + MAP_STUB + "{/mapy}"


def _plain_para(text: str, keep_next: bool = False) -> str:
    # Left-aligned body paragraph (photo intros / note) — _map_para centers.
    props = "<w:pPr><w:keepNext/></w:pPr>" if keep_next else ""
    return f'<w:p>{props}<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'


def _foto_block(section: str, intro: str) -> str:
    # Section tags in their OWN paragraphs; {%img} NEVER shares a w:t with
    # section tags (Slice 8 lesson) — same rules as MAP_BLOCK.
    return (
        _plain_para("{#ma_foto_" + section + "}")
        + _plain_para(intro, keep_next=True)
        + _plain_para("{#foto_" + section + "}")
        + _map_para("{%img}")
        + _plain_para("{/foto_" + section + "}")
        + _plain_para("{/ma_foto_" + section + "}")
    )


UWAGI_BLOCK = (
    _plain_para("{#ma_uwagi_ogledzin}")
    + _plain_para(UWAGI_LABEL, keep_next=True)
    + _plain_para("{uwagi_ogledzin}")
    + _plain_para("{/ma_uwagi_ogledzin}")
)


def _para_bounds(xml: str, pos: int) -> tuple[int, int]:
    start = max(xml.rfind("<w:p ", 0, pos), xml.rfind("<w:p>", 0, pos))
    check(start != -1, "photo-stage paragraph start found")
    end = xml.index("</w:p>", pos) + len("</w:p>")
    return start, end


def inject_photo_tags(xml: str) -> str:
    # 1) STUB_FOTO x4 in document order: 8.1, 8.3, 8.4, 15. Replace #2 (8.3)
    #    with the building block, drop the rest (honest silence).
    positions = [i for i in range(len(xml)) if xml.startswith(STUB_FOTO, i)]
    check(len(positions) == 4, f"photo stubs found 4x (got {len(positions)})")
    replacements = {1: _foto_block("budynek", FOTO_INTRO_BUDYNEK)}
    for i in reversed(range(4)):
        start, end = _para_bounds(xml, positions[i])
        xml = xml[:start] + replacements.get(i, "") + xml[end:]
    # 2) surroundings block AFTER the map block (decision 5: photos za mapami)
    hits = xml.count(OTOCZENIE_ANCHOR)
    check(hits == 1, f"otoczenie anchor found exactly once (hits={hits})")
    end = xml.index("</w:p>", xml.index(OTOCZENIE_ANCHOR)) + len("</w:p>")
    xml = xml[:end] + _foto_block("otoczenie", FOTO_INTRO_OTOCZENIE) + xml[end:]
    # 3) interiors + note after the LAST (=§8.3) occurrence of the lokal prose
    hits = xml.count(WNETRZA_ANCHOR)
    check(hits == 2, f"wnetrza anchor found exactly twice (hits={hits})")
    end = xml.index("</w:p>", xml.rindex(WNETRZA_ANCHOR)) + len("</w:p>")
    xml = xml[:end] + _foto_block("wnetrza", FOTO_INTRO_WNETRZA) + UWAGI_BLOCK + xml[end:]
    check(STUB_FOTO not in xml, "no STUB_FOTO survives stage 13")
    return xml


def apply_photo_tags(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        data = {n: z.read(n) for n in names}
    data["word/document.xml"] = inject_photo_tags(
        data["word/document.xml"].decode("utf-8")
    ).encode("utf-8")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, data[n])
```

W miejscu wywołań stage'ów (znajdź `apply_map_tags(` w mainie skryptu) dodaj `apply_photo_tags(...)` bezpośrednio PO `apply_map_tags`, na tej samej ścieżce pliku. Zaktualizuj docstring "Stages:" na górze pliku o linijkę stage 13.

- [ ] **Step 2: Rebuild** — `cd /Users/michalczekala/Development/wyceny/tools/spike/2026-07-15-template-koscielna && python3 build_template.py` → wszystkie checki `[ok]`, w tym nowe (4 stuby, kotwice 1×/2×, zero STUB_FOTO).
- [ ] **Step 3: Copy** — skopiuj wyprodukowany `operat-szablon.docx` do `~/Development/wyceny-app/apps/web/templates/operat-szablon.docx` (sprawdź w skrypcie/README spike'a dokładną ścieżkę outputu).
- [ ] **Step 4: Verify web suite GREEN** — pełny gate web w app-repo: istniejące F-12 testy muszą przejść bez zmian (sekcje foto są warunkowe — bez danych model nie ma `ma_foto_*`, expressions parser zwraca undefined → falsy → sekcje znikają; render bez zdjęć NIE zawiera już zdania STUB_FOTO, czego żaden test nie asertuje — zweryfikowane grep-em 2026-07-22). Jeśli coś czerwone — najpierw przeczytaj asercję, nie szablon.
- [ ] **Step 5: Commit (app-repo)** — `feat(web): template stage 13 - inspection photo blocks + note, stub removal (fr-2)` (sama binarka `templates/operat-szablon.docx`; builder w wiki-repo zostaje uncommitted do S6).

---

### Task 7: Render — `photos` w `docx-render.ts` + pola notatki w modelu

**Files:**

- Modify: `apps/web/src/adapters/docx-render.ts`
- Modify: `apps/web/src/domain/document-model.ts` (typ `DocumentModel` ~`:144` + return `buildDocumentModel` ~`:288`)
- Test: `apps/web/tests/docx-render-photos.test.ts`

**Interfaces:**

- Produces: `renderOperatDocx(model, opts?: { signature?; maps?; photos?: RenderPhotos | null })`; `docx-render.ts` RE-EKSPORTUJE `RenderPhotos` z domeny (`export type { RenderPhotos } from "../domain/inspection"`) dla wygody akcji. `DocumentModel` + `ma_uwagi_ogledzin: boolean` i `uwagi_ogledzin: string` (z `input.inputs.inspection?.note`).
- Consumes: tagi z Task 6; `fitBox`/`jpegDimensions` z Task 3; typ `RenderPhotos` z `domain/inspection` (advisor BLOCKER 1: typ w domenie, bo depcruise zabrania lib→adapters).

- [ ] **Step 1: Failing tests** — `tests/docx-render-photos.test.ts` (fixture'y: reuse `JPG_1PX`/`PNG_1PX` — przenieś je do `tests/fixtures/jpeg-fixtures.ts` jeśli jeszcze nie w Task 5 — oraz `syntheticDocumentInput()`):

```ts
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { renderOperatDocx, type RenderMaps, type RenderPhotos } from "../src/adapters/docx-render";
import { buildDocumentModel } from "../src/domain/document-model";
import { syntheticDocumentInput } from "./fixtures/document-model-fixture";
// JPG_1PX / PNG_1PX like docx-render-maps.test.ts

const MAPS: RenderMaps = { ewidencyjna: PNG_1PX, orto: JPG_1PX };
const PHOTOS: RenderPhotos = {
  otoczenie: [JPG_1PX],
  budynekZewn: [JPG_1PX, JPG_1PX],
  wnetrza: [JPG_1PX, JPG_1PX, JPG_1PX],
};
// zipOf / generatedMedia / textOf — same helpers as docx-render-maps.test.ts

const model = buildDocumentModel(syntheticDocumentInput());
const modelWithNote = buildDocumentModel({
  ...syntheticDocumentInput(),
  inputs: {
    ...syntheticDocumentInput().inputs,
    inspection: {
      note: "Lokal po remoncie.",
      photos: { otoczenie: [], budynekZewn: [], wnetrza: [] },
    },
  },
});

describe("renderOperatDocx photos (Slice 10, F-12 media leg)", () => {
  it("embeds maps + N photos, all JPEG magic for photos, resolvable rels", () => {
    const docx = renderOperatDocx(model, { maps: MAPS, photos: PHOTOS });
    expect(generatedMedia(docx).length).toBe(2 + 6);
  });
  it("renders section intros only for non-empty sections", () => {
    const withPhotos = textOf(renderOperatDocx(model, { photos: PHOTOS }));
    const onlyInterior = textOf(
      renderOperatDocx(model, { photos: { otoczenie: [], budynekZewn: [], wnetrza: [JPG_1PX] } }),
    );
    const without = textOf(renderOperatDocx(model));
    expect(withPhotos).toContain("dokumentację fotograficzną budynku");
    expect(withPhotos).toContain("dokumentacja fotograficzna drogi dojazdowej");
    expect(onlyInterior).toContain("dokumentację fotograficzną lokalu mieszkalnego");
    expect(onlyInterior).not.toContain("dokumentację fotograficzną budynku");
    expect(without).not.toContain("dokumentacja fotograficzna");
    expect(without).not.toContain("Dokumentacja fotograficzna i kartograficzna");
    expect(without).not.toContain("{%img}");
  });
  it("renders the note block only when a note exists", () => {
    const withNote = textOf(renderOperatDocx(modelWithNote));
    const without = textOf(renderOperatDocx(model));
    expect(withNote).toContain("Uwagi z oględzin:");
    expect(withNote).toContain("Lokal po remoncie.");
    expect(without).not.toContain("Uwagi z oględzin:");
  });
  it("keeps approve/sign text identical with photos and adds exactly one medium on sign", () => {
    const approved = renderOperatDocx(model, { maps: MAPS, photos: PHOTOS });
    const signed = renderOperatDocx(model, { maps: MAPS, photos: PHOTOS, signature: PNG_1PX });
    expect(textOf(signed)).toBe(textOf(approved));
    expect(generatedMedia(signed).length).toBe(9);
  });
  it("sizes photos by their real aspect ratio (1x1 -> square 450x450 EMU box, not 600x450)", () => {
    const docx = renderOperatDocx(model, {
      photos: { otoczenie: [JPG_1PX], budynekZewn: [], wnetrza: [] },
    });
    const xml = zipOf(docx).file("word/document.xml")!.asText();
    // 450 px @96dpi = 4286250 EMU; a stretched 600x450 would emit cx=5715000
    expect(xml).toContain('cx="4286250"');
    expect(xml).not.toContain('cx="5715000" cy="4286250"');
  });
});
```

(EMU: `px * 9525`. 1×1 JPG → fitBox → [450,450] → cx=cy=4286250. Jeśli moduł image liczy EMU inaczej, dostosuj oczekiwaną liczbę do `px*9525` — najpierw sprawdź jedną wartością.)

- [ ] **Step 2: Run — FAIL**.
- [ ] **Step 3: Implement** — `document-model.ts`: do typu `DocumentModel` dodaj

```ts
/** §8.3 "Uwagi z oględzin" block (Slice 10) — conditional, honest silence when empty. */
ma_uwagi_ogledzin: boolean;
uwagi_ogledzin: string;
```

a w return `buildDocumentModel`:

```ts
    ma_uwagi_ogledzin: Boolean(input.inputs.inspection?.note),
    uwagi_ogledzin: input.inputs.inspection?.note ?? "",
```

`docx-render.ts` — pełna nowa wersja rdzenia (zastępuje obecne `images`/`doc.render` fragmenty):

```ts
import { fitBox, jpegDimensions } from "../lib/jpeg";
import type { InspectionSection, RenderPhotos } from "../domain/inspection";

export type { RenderPhotos } from "../domain/inspection";

/** Print box for an inspection photo, px @96dpi — aspect-preserved inside. */
const PHOTO_BOX: [number, number] = [600, 450];

export function renderOperatDocx(
  model: DocumentModel,
  opts?: { signature?: Buffer | null; maps?: RenderMaps | null; photos?: RenderPhotos | null },
): Buffer {
  const signature = opts?.signature ?? null;
  const maps = opts?.maps ?? null;
  const photos = opts?.photos ?? null;
  const images: Record<string, Buffer> = {
    ...(signature ? { podpis: signature } : {}),
    ...(maps ? { mapa_ewidencyjna: maps.ewidencyjna, mapa_orto: maps.orto } : {}),
  };
  // Photo loop items are string markers (Slice 8 contract) dispatched by
  // tagVALUE (all photo tags share tagName "img"); bytes flow via photoMap.
  const photoMap: Record<string, Buffer> = {};
  const fotoLoop = (section: InspectionSection) =>
    (photos?.[section] ?? []).map((buf, i) => {
      const marker = `foto-${section}-${i}`;
      photoMap[marker] = buf;
      return { img: marker };
    });
  const foto = {
    foto_otoczenie: fotoLoop("otoczenie"),
    foto_budynek: fotoLoop("budynekZewn"),
    foto_wnetrza: fotoLoop("wnetrza"),
  };
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    parser: expressionParser,
    modules: [
      new ImageModule({
        centered: false,
        getImage: (tagValue: string, tagName: string) =>
          tagName === "img" ? photoMap[tagValue] : images[tagName],
        getSize: (buf: Buffer, tagValue: string, tagName: string) => {
          if (tagName === "podpis") return SIGNATURE_SIZE;
          if (tagName === "img") {
            const dims = jpegDimensions(buf);
            return dims ? fitBox(dims, PHOTO_BOX) : PHOTO_BOX;
          }
          return MAP_SIZE;
        },
      }),
    ],
  });
  doc.render({
    ...model,
    podpis: signature ? "sygnatariusz" : null,
    mapy: Boolean(maps),
    mapa_ewidencyjna: maps ? "mapa_ewidencyjna" : null,
    mapa_orto: maps ? "mapa_orto" : null,
    ...foto,
    ma_foto_otoczenie: foto.foto_otoczenie.length > 0,
    ma_foto_budynek: foto.foto_budynek.length > 0,
    ma_foto_wnetrza: foto.foto_wnetrza.length > 0,
  });
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
```

(Sekcje `ma_foto_*` liczone z FAKTYCZNIE dostarczonych bajtów — nie z manifestu w inputs; manifest→bajty spina Task 8. `ma_uwagi_ogledzin` idzie z modelu — czysty tekst.)

- [ ] **Step 4: Run — PASS** — nowy plik + `docx-render-maps.test.ts` + `docx-render-signature.test.ts` + pełny gate.
- [ ] **Step 5: Commit** — `feat(web): render inspection photos + note - aspect-preserving sizes, f-12 media leg (fr-2)`

---

### Task 8: Approve + sign — manifest → bajty → render

**Files:**

- Modify: `apps/web/src/app/actions/approve-valuation.ts` (po bloku map, `~:97-110`), `apps/web/src/app/actions/sign-valuation.ts` (po bloku map, `~:81-95`)
- Test: rozszerz `apps/web/tests/approve-valuation-action.test.ts` i `apps/web/tests/sign-valuation-action.test.ts`

**Interfaces:**

- Consumes: `RenderPhotos` (Task 7), `totalInspectionPhotos`/`INSPECTION_SECTIONS` (Task 3), `storage.get` (guard `Buffer.isBuffer` — automock!).

- [ ] **Step 1: Failing tests** — do approve-testu: draft z `inputs.inspection` (2 klucze) → `storage.get` mockowany per klucz → render zawiera 2+N mediów (przez PizZip jak istniejące asercje) i `storage.get` wołany dokładnie dla kluczy manifestu; oraz: manifest wskazuje klucz, `storage.get` rzuca `StorageNotFoundError` → approve zwraca `{ error: ... }` i **repo.approve NIE jest wołane**. Do sign-testu: manifest w frozen inputs + `storage.get` rzuca `StorageNotFoundError` na kluczu zdjęcia → sign zwraca error i **repo.sign NIE wołane** (twarda różnica vs mapy — tam StorageNotFoundError = legalny brak); happy path z Buffer.isBuffer-fake (get → undefined) → error, nie crash.
- [ ] **Step 2: Run — FAIL**.
- [ ] **Step 3: Implement** — helper w OBU akcjach identyczny (świadoma duplikacja 12 linii — akcje nie dzielą modułów pomocniczych; alternatywnie `src/lib/load-inspection-photos.ts` z jedną funkcją — wybierz bibliotekę, bo używają jej dwa pliki):

`apps/web/src/lib/load-inspection-photos.ts`:

```ts
import type { PortStorage } from "@/ports/storage";
import {
  INSPECTION_SECTIONS,
  totalInspectionPhotos,
  type InspectionSnapshot,
  type RenderPhotos,
} from "@/domain/inspection";

/**
 * Manifest -> frozen bytes. Photos differ from maps here: a manifest key
 * that fails to resolve is a HARD integrity error (the manifest is written
 * in the same tx as the bytes; maps could legally be absent via skipMaps).
 * Callers catch and refuse to approve/sign — never render a legal document
 * missing photos its inputs claim to have.
 */
export async function loadInspectionPhotos(
  storage: PortStorage,
  inspection: InspectionSnapshot | null | undefined,
): Promise<RenderPhotos | null> {
  if (!inspection || totalInspectionPhotos(inspection) === 0) return null;
  const photos = { otoczenie: [], budynekZewn: [], wnetrza: [] } as RenderPhotos;
  for (const section of INSPECTION_SECTIONS) {
    for (const key of inspection.photos[section]) {
      const bytes = await storage.get(key);
      if (!Buffer.isBuffer(bytes)) {
        throw new Error(`Inspection photo missing or unreadable: ${key}`);
      }
      photos[section].push(bytes);
    }
  }
  return photos;
}
```

W `approve-valuation.ts` po bloku map (przed `renderOperatDocx`):

```ts
let photos: RenderPhotos | null = null;
try {
  photos = await loadInspectionPhotos(storage, valuation.inputs.inspection);
} catch (error) {
  console.error("approveValuation: reading inspection photos failed", error);
  return {
    error: "Nie udało się odczytać zdjęć z oględzin — odśwież stronę i spróbuj ponownie.",
  };
}
const docx = renderOperatDocx(model, { maps, photos });
```

W `sign-valuation.ts` analogicznie po bloku map (StorageNotFoundError NIE jest tu łykany — każdy błąd zdjęcia abortuje podpis):

```ts
let photos: RenderPhotos | null = null;
try {
  photos = await loadInspectionPhotos(storage, valuation.inputs.inspection);
} catch (error) {
  console.error("signValuationAction: reading frozen inspection photos failed", error);
  return {
    error: "Nie udało się odczytać zamrożonych zdjęć operatu — spróbuj ponownie.",
  };
}
const docx = renderOperatDocx(model, { signature: signature.bytes, maps, photos });
```

- [ ] **Step 4: Run — PASS** — oba pliki testów + pełny gate. (Uwaga M-2: adapter `worker-http.ts` NIE ustawia timeoutu na `convertToPdf` — zweryfikowane 2026-07-22, fetch bez AbortSignal — więc większy DOCX ze zdjęciami nie zostanie ucięty; latencję konwersji mierzy QA w S5.)
- [ ] **Step 5: Commit** — `feat(web): approve/sign embed inspection photos from frozen manifest (fr-2)`

---

### Task 8b: Serwowanie miniatur — autoryzacja kluczy zdjęć w `/api/docs/[key]` (advisor BLOCKER 2)

**Files:**

- Modify: `apps/web/src/app/api/docs/[key]/route.ts` (gałąź przed `getByDocKey`)
- Test: `apps/web/tests/docs-route.test.ts` (rozszerzenie — wzorzec mocków już w pliku)

**Interfaces:**

- Consumes: `valuationRepository.get` (istnieje — robi `canSee`: owner + admin, F-8), `storage.get`, manifest z `inputs.inspection`.
- Kontekst: `getByDocKey` matchuje TYLKO `docUrl`/`docxUrl` (`valuation-drizzle.ts:120`) — klucz zdjęcia żyje w manifeście, więc bez tej gałęzi każda miniatura dostaje 404.

- [ ] **Step 1: Failing tests** — do `tests/docs-route.test.ts` (mocki jak w istniejących case'ach):

```ts
// photo-key branch (Slice 10):
// 1. key "ogledziny-budynek-u1-<vid>.jpg", repo.get(vid) -> draft OWNED by session
//    user, manifest zawiera key -> 200, Content-Type image/jpeg, body = storage.get bytes
// 2. same key, manifest NIE zawiera key (osierocony/wyłudzany klucz) -> 404
// 3. repo.get -> null (nie-owner/nie istnieje) -> 404 (bez existence leak)
// 4. malformed: "ogledziny-costam.jpg" (brak UUID wyceny) -> spada do getByDocKey -> 404
// 5. wersjonowanie: klucz z id WYCENY v1, żądany przez ownera (repo.get(v1) widoczny,
//    manifest v1 zawiera klucz) -> 200 — miniatury odziedziczone w v2 działają, bo
//    <img> pokazuje klucz v1, a owner v2 == owner v1
```

Napisz jako pełne testy (repo.get/storage.get mockowane; asercja `Content-Type`).

- [ ] **Step 2: Run — FAIL**.
- [ ] **Step 3: Implement** — w `route.ts` przed wywołaniem `getByDocKey` dodaj:

```ts
// Inspection photo keys (Slice 10) live in inputs.inspection (manifest),
// never in docUrl/docxUrl — getByDocKey can't see them. The key embeds its
// owning valuationId; authorize via repo.get (owner + admin, F-8) AND
// membership in that valuation's manifest (no fishing for orphaned keys).
const PHOTO_KEY_RX =
  /^ogledziny-(?:otoczenie|budynek|wnetrza)-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$/;

const photoMatch = PHOTO_KEY_RX.exec(key);
if (photoMatch) {
  const valuation = await valuationRepository.get(photoMatch[1], session.user);
  const manifest = valuation?.inputs?.inspection?.photos;
  const inManifest = manifest && Object.values(manifest).some((keys) => keys.includes(key));
  if (!inManifest) {
    return new NextResponse("Not found", { status: 404 });
  }
  const bytes = await storage.get(key);
  return new NextResponse(bytes, {
    headers: { "Content-Type": "image/jpeg", "Content-Disposition": "inline" },
  });
}
```

(Dopasuj kształt zwrotek/try-catch do istniejącego stylu route'a — 404 na `StorageNotFoundError` jak w obecnym kodzie; sprawdź jak route obsługuje brak sesji i błędy storage i zrób identycznie.)

- [ ] **Step 4: Run — PASS** — plik + pełny gate.
- [ ] **Step 5: Commit** — `feat(web): serve inspection photo thumbnails - manifest-gated auth in docs route (fr-2)`

---

### Task 9: UI — karta „Oględziny" + kill-switch + CI flag

**Files:**

- Create: `apps/web/src/app/valuations/[id]/inspection-section.tsx`
- Modify: `apps/web/src/app/valuations/[id]/page.tsx` (render karty dla `isDraft && isOwner`, nad `<ValuationActions>`; przekaż `valuation.id` i `valuation.inputs?.inspection ?? null`; `isOwner` = `valuation.ownerId === session.user.id` — sprawdź jak page liczy sesję)
- Modify: `.github/workflows/ci.yml` (job `e2e` env, po `MAPS_FETCH`), `playwright.config.ts:26` (env)
- Test: `apps/web/tests/rtl-inspection-section.test.tsx`

**Interfaces:**

- Consumes: akcje z Task 5, `processPhoto` z Task 5, `mintKwUploadToken` (REUSE — token jest generyczny HMAC, nie KW-specyficzny; nie zmieniaj nazwy w tym slice), `MAX_INSPECTION_PHOTOS`/`INSPECTION_SECTIONS`/`totalInspectionPhotos`.
- Produces: `<InspectionSection valuationId={string} inspection={InspectionSnapshot | null} />` (self-contained client component).

- [ ] **Step 1: Failing tests** — `tests/rtl-inspection-section.test.tsx` (pragma jsdom, `afterEach(cleanup)`, mocki: `@/app/actions/inspection`, `@/app/actions/mint-kw-token`, `@/lib/photo-process-client`; `vi.stubEnv` dla flagi):

```ts
// cases:
// 1. renders 3 sections (headings: "Otoczenie i droga dojazdowa", "Budynek z zewnątrz",
//    "Wnętrza"), the note textarea, and the amber hint
//    "operat bez dokumentacji fotograficznej" when total is 0
// 2. renders thumbnails (<img src="/api/docs/<encoded key>">) and the counter
//    "3/50" for a snapshot with 3 keys; NO amber hint
// 3. remove button calls removeInspectionPhoto(id, section, key)
// 4. note save button calls saveInspectionNote(id, value)
// 5. NEXT_PUBLIC_PHOTO_UPLOAD=off hides ALL file inputs, note stays editable
// 6. upload flow: selecting a file calls mintKwUploadToken -> processPhoto ->
//    uploadInspectionPhoto (mock all three, assert order/args with .findLast())
```

Napisz jako pełne testy (wzorzec `rtl-kw-section.test.tsx` dla struktury; komponent jest self-contained, więc render bez harnessu RHF).

- [ ] **Step 2: Run — FAIL**.
- [ ] **Step 3: Implement** — `inspection-section.tsx` (self-contained client; sekwencyjny upload z licznikiem; PO każdej udanej akcji stan odświeża się przez `revalidatePath` w akcji — komponent trzyma TYLKO stan przejściowy uploadu):

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  removeInspectionPhoto,
  saveInspectionNote,
  uploadInspectionPhoto,
} from "@/app/actions/inspection";
import { mintKwUploadToken } from "@/app/actions/mint-kw-token";
import { processPhoto } from "@/lib/photo-process-client";
import {
  INSPECTION_SECTIONS,
  MAX_INSPECTION_PHOTOS,
  totalInspectionPhotos,
  type InspectionSection as Section,
  type InspectionSnapshot,
} from "@/domain/inspection";

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:8000";
// Mirrors NEXT_PUBLIC_KW_UPLOAD: upload UI renders only when enabled; the
// note stays editable (no worker involved) so e2e/air-gapped keep working.
const uploadEnabled = process.env.NEXT_PUBLIC_PHOTO_UPLOAD !== "off";

const SECTION_LABELS: Record<Section, string> = {
  otoczenie: "Otoczenie i droga dojazdowa",
  budynekZewn: "Budynek z zewnątrz",
  wnetrza: "Wnętrza",
};

export function InspectionSection({
  valuationId,
  inspection,
}: {
  valuationId: string;
  inspection: InspectionSnapshot | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null); // "2/5" progress
  const [note, setNote] = useState(inspection?.note ?? "");
  const [isPending, startTransition] = useTransition();
  const inputRefs = useRef<Partial<Record<Section, HTMLInputElement | null>>>({});

  const total = totalInspectionPhotos(inspection);

  const uploadFiles = async (section: Section, files: FileList) => {
    setError(null);
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setUploading(`${i + 1}/${list.length}`);
      const minted = await mintKwUploadToken();
      if ("error" in minted) {
        setError(minted.error);
        break;
      }
      const processed = await processPhoto({
        file: list[i],
        token: minted.token,
        workerUrl: WORKER_URL,
      });
      if (processed.kind !== "ok") {
        setError(processed.message);
        break;
      }
      const form = new FormData();
      form.set("photo", processed.blob);
      const result = await uploadInspectionPhoto(valuationId, section, form);
      if ("error" in result) {
        setError(result.error);
        break;
      }
    }
    setUploading(null);
    const input = inputRefs.current[section];
    if (input) input.value = "";
  };

  return (
    <section data-testid="inspection-section" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Oględziny</h2>
        <span data-testid="inspection-counter" className="text-sm text-muted-foreground">
          {total}/{MAX_INSPECTION_PHOTOS}
        </span>
      </div>
      {total === 0 ? (
        <p data-testid="inspection-hint" className="text-sm text-amber-600">
          ⚠ Operat bez dokumentacji fotograficznej — dodaj zdjęcia z oględzin.
        </p>
      ) : null}
      {INSPECTION_SECTIONS.map((section) => (
        <div key={section} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{SECTION_LABELS[section]}</h3>
          <div className="flex flex-wrap gap-2">
            {(inspection?.photos[section] ?? []).map((key) => (
              <figure key={key} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- bytea-served thumbnail, not an optimizable asset */}
                <img
                  src={`/api/docs/${encodeURIComponent(key)}`}
                  alt={`Zdjęcie — ${SECTION_LABELS[section]}`}
                  className="h-24 w-32 rounded-md border object-cover"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Usuń zdjęcie"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await removeInspectionPhoto(valuationId, section, key);
                      if (r?.error) setError(r.error);
                    })
                  }
                >
                  Usuń
                </Button>
              </figure>
            ))}
          </div>
          {uploadEnabled ? (
            <input
              ref={(el) => {
                inputRefs.current[section] = el;
              }}
              type="file"
              multiple
              accept="image/jpeg,image/png"
              aria-label={`Dodaj zdjęcia — ${SECTION_LABELS[section]}`}
              disabled={uploading !== null || total >= MAX_INSPECTION_PHOTOS}
              onChange={(e) => {
                if (e.target.files?.length) void uploadFiles(section, e.target.files);
              }}
            />
          ) : null}
        </div>
      ))}
      {uploading ? (
        <p data-testid="inspection-progress" className="text-sm text-muted-foreground">
          ⏳ Przetwarzam zdjęcie {uploading}…
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="inspection-note" className="text-sm font-medium">
          Notatka z oględzin
        </label>
        <textarea
          id="inspection-note"
          className="min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base md:text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const r = await saveInspectionNote(valuationId, note);
              if (r?.error) setError(r.error);
            })
          }
        >
          Zapisz notatkę
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
```

`page.tsx`: import + render w gałęzi draft (obok innych sekcji, przed `ValuationActions`) tylko dla ownera. `ci.yml` (job e2e env) + `playwright.config.ts` env: dodaj `NEXT_PUBLIC_PHOTO_UPLOAD: "off"` z komentarzem wzorem `NEXT_PUBLIC_KW_UPLOAD` (przyciski uploadu renderuje klient — flaga inlined przy build).

- [ ] **Step 4: Run — PASS** — RTL plik + pełny gate + `pnpm exec playwright test` lokalnie jeśli skonfigurowane (smoke nie dotyka karty — total 0 → tylko hint, zero sieci).
- [ ] **Step 5: Commit** — `feat(web): inspection card - sectioned photo upload, note, amber hint, kill-switch (fr-2)`

---

## Zależności między taskami

```
Task 0 (mapSeq)                — niezależny
Task 1 → Task 2                (worker)
Task 3 → Task 4 → Task 5       (web: domena → repo → akcje)
Task 6 → Task 7 → Task 8 → 8b  (szablon → render → approve/sign → route miniatur; Task 7 wymaga też Task 3)
Task 5 + Task 8b → Task 9      (UI na końcu — miniatury wymagają route'a z 8b)
```

Wykonanie SEKWENCYJNE 0→1→2→3→4→5→6→7→8→8b→9 spełnia wszystkie zależności (SDD default).

## Advisor-review (2026-07-22) — naniesione poprawki

Advisor (świeży agent, adwersaryjnie, z dowodami empirycznymi) znalazł i plan wchłonął:
**B1** `RenderPhotos` przeniesione do `domain/inspection.ts` (depcruise: zakaz lib→adapters, także type-only — dowiedzione plikiem-sondą); **B2** nowy Task 8b (miniatury 404-owałyby: `getByDocKey` matchuje tylko `docUrl`/`docxUrl`); **I-1** `.for("update")` w `updateInspection` (lost update manifestu z dwóch tabów); **I-2** `hasApp1` odrzuca KAŻDY APP1 (XMP też niesie GPS); **M-1** constraint F-1 doprecyzowany (typ `KcsInput` rośnie, logika nie); **M-2** brak timeoutu na `convertToPdf` odnotowany w Task 8; **M-3** kruchość env-harnessu w Task 0 opisana. Advisor oczyścił: F-9 w pliku planu (12-cyfrowy UUID nie matchuje `\b[0-9]{11}\b`), zieloność F-12 po Task 6, kontrakt modułu image (EMU=px*9525, pętla per-instancja), workera (Dockerfile bez zmian, token zgodny z `verify_token`), wersjonowanie.

## Self-review (wykonany przy pisaniu)

1. **Spec coverage:** model danych → T3; storage/determinizm/cykl kluczy → T4/T5/T8; EXIF/Pillow → T1/T2; prowenancja bez bramki → (brak zmian w gate — potwierdzone: `approvalGate` nie czyta inspection); miejsce w operacie → T6/T7; honest silence + amber → T6/T7/T9; task 0 → T0 + (0b w T6, `STUB_FOTO` removal); trust boundary → T5; CI flag → T9; audit → T3/T4. Deploy/prod QA = S5 (poza planem kodu).
2. **Placeholdery:** dwa świadome „dopasuj do harnessu" (T0 mocki, T4 helpery repo-testu) — wskazane DOKŁADNE pliki źródłowe wzorca; reszta kompletna.
3. **Spójność typów:** `InspectionSection`/`InspectionSnapshot`/`InspectionOp`/`RenderPhotos`/`updateInspection`/`loadInspectionPhotos` — zdefiniowane raz, konsumowane po nazwach zgodnie z blokami Interfaces.
