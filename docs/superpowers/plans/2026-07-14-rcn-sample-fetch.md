# RCN Sample Auto-Fetch (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Address → the sample fetches itself": a worker endpoint geocodes the address, pulls live transactions from the GUGiK RCN WFS, applies the spike-proven v2 selection, and the web form fills its comparables with ≥12 provenance-tagged proposals persisted write-once in the `inputs` snapshot (F-5).

**Architecture:** Worker gains a pure-core `rcn.py` (parse + select are offline-testable; geocode + fetch are thin I/O wrappers) and a `POST /sample-proposal` endpoint (never returns WR — F-11). Web gains `PortSampleProposal` + HTTP adapter + a Server Action + a "Pobierz próbę z RCN" button that fills the existing comparables fieldArray. No DDL migration — `inputs` jsonb absorbs the new provenance fields via zod.

**Tech Stack:** Python 3.12 stdlib (urllib, re — same as the spike; NO new deps), FastAPI, pytest (offline, monkeypatched I/O); Next 16 Server Actions, react-hook-form, zod 4.

**Spec:** `docs/superpowers/specs/2026-07-14-rcn-sample-fetch-design.md`
**Spike evidence:** wiki repo `tools/spike/2026-07-14-rcn-live-revalidation/RAPORT.md` (+ `2026-05-14-kcs/spike.py` — the source being ported)

## Global Constraints

- Code/comments/commit messages **English**; UI copy **Polish** (full diacritics). Conventional commits; lefthook hooks active (prettier staged, commitlint).
- **Production RCN parameters (spike-pinned, do not "improve"):** WFS `https://mapy.geoportal.gov.pl/wss/service/PZGIK/RCiWN/WFS/Transactions` (verify constant name/value from `tools/spike/2026-05-14-kcs/spike.py` lines 1-30 in the wiki repo — copy `WFS_URL`, `NOMINATIM`, `USER_AGENT` verbatim), `typenames=ms:lokale`, `count=5000`, `sortBy=dok_data D`, `srsName=EPSG:2180`, bbox `EPSG:4326` = (lat−0.018, lon−0.029, lat+0.018, lon+0.029), price column **`lok_cena_brutto`**, filter `lok_funkcja == "mieszkalna"`.
- **Selection v2 (spike-proven, exact rules):** (1) mieszkalna + `cena_per_m2 > 0`; (2) date sanity `today−24mo ≤ dok_data_msc ≤ today` — **mandatory, RCN contains garbage future dates like 5201-07**; (3) area band `[0.7·P, 1.3·P]`; (4) IQR trim on `cena_per_m2` (`[Q1−1.5·IQR, Q3+1.5·IQR]`, only when pool ≥8); (5) sort date DESC → pool 19 → return; the WEB takes the first 12.
- **F-11:** worker never returns WR — new endpoint returns transactions + meta only.
- **No network in any test** (pytest or vitest or CI) — GUGiK/Nominatim only from production code paths.
- Worker tests: `uv run pytest -q` + `uv run ruff check . && uv run ruff format --check .` must stay green. Web: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` green before every commit; push + `gh run watch --exit-status` per task.
- Polish error copy for user-visible failures: geocoding/WFS failure → `"Nie udało się pobrać próby z RCN — spróbuj ponownie albo wpisz transakcje ręcznie."`; too few candidates → `"Za mało transakcji w okolicy (znaleziono N) — zawęź adres albo uzupełnij próbę ręcznie."`

---

### Task 1: Worker — pure core `rcn.py` (parse + select) with offline tests

**Files:**

- Create: `apps/worker/app/rcn.py`, `apps/worker/tests/test_rcn_core.py`

**Interfaces:**

- Produces: `parse_gml(gml: str) -> list[dict]` (keys: `transaction_id, price_total, area, price_per_m2, date, date_month, function, x, y`), `select_sample(transactions, subject_area: float, today_month: str) -> list[dict]` (pure, deterministic — `today_month` like `"2026-07"` is a PARAMETER, never `datetime.now()` inside), constants `POOL_N = 19`, `AREA_BAND_PCT = 0.30`, `DATE_WINDOW_MONTHS = 24`. Task 2 wires I/O around these.

- [ ] **Step 1: Write the failing tests — `apps/worker/tests/test_rcn_core.py`**

```python
"""Offline tests for the RCN pure core. NO network — GML is built in-test.

Pins the two spike discoveries that make or break production:
garbage future dates in RCN (5201-07) and IQR outlier rejection.
"""

from app.rcn import AREA_BAND_PCT, POOL_N, parse_gml, select_sample


def make_member(
    price=700000.0,
    area=55.5,
    date="2026-04-15",
    function="mieszkalna",
    tid="PL.X.123",
    pos="52.41 16.90",
):
    return f"""<wfs:member>
      <ms:lokale>
        <ms:tran_lokalny_id_iip>{tid}</ms:tran_lokalny_id_iip>
        <ms:teryt>306401_1</ms:teryt>
        <ms:lok_cena_brutto>{price}</ms:lok_cena_brutto>
        <ms:lok_pow_uzyt>{area}</ms:lok_pow_uzyt>
        <ms:dok_data>{date}T00:00:00</ms:dok_data>
        <ms:lok_funkcja>{function}</ms:lok_funkcja>
        <ms:tran_rodzaj_trans>sprzedaż</ms:tran_rodzaj_trans>
        <gml:pos>{pos}</gml:pos>
      </ms:lokale>
    </wfs:member>"""


def wrap(members):
    return f"<wfs:FeatureCollection>{''.join(members)}</wfs:FeatureCollection>"


def test_parse_gml_extracts_fields_and_skips_invalid():
    gml = wrap(
        [
            make_member(price=650000, area=50.0, tid="A"),
            make_member(price=0, tid="B"),  # invalid price -> skipped
            "<wfs:member><ms:lokale></ms:lokale></wfs:member>",  # empty -> skipped
        ]
    )
    out = parse_gml(gml)
    assert len(out) == 1
    t = out[0]
    assert t["transaction_id"] == "A"
    assert t["price_per_m2"] == 13000.0
    assert t["date_month"] == "2026-04"
    assert t["function"] == "mieszkalna"


def _valid_pool(n, price=13000.0, area=70.0, months=("2026-01", "2026-02", "2026-03")):
    return [
        {
            "transaction_id": f"T{i}",
            "price_per_m2": price + i,  # slight spread, no outliers
            "area": area,
            "date": f"{months[i % len(months)]}-1{i % 9}",
            "date_month": months[i % len(months)],
            "function": "mieszkalna",
        }
        for i in range(n)
    ]


def test_select_rejects_garbage_future_dates():
    pool = _valid_pool(14)
    pool.append({**pool[0], "transaction_id": "GARBAGE", "date": "5201-07-01", "date_month": "5201-07"})
    sel = select_sample(pool, subject_area=70.0, today_month="2026-07")
    assert all(t["transaction_id"] != "GARBAGE" for t in sel)


def test_select_rejects_stale_nonresidential_and_out_of_band():
    pool = _valid_pool(14)
    pool.append({**pool[0], "transaction_id": "OLD", "date_month": "2023-01"})
    pool.append({**pool[1], "transaction_id": "SHOP", "function": "usługowa"})
    pool.append({**pool[2], "transaction_id": "HUGE", "area": 70.0 * (1 + AREA_BAND_PCT) + 1})
    sel = select_sample(pool, subject_area=70.0, today_month="2026-07")
    ids = {t["transaction_id"] for t in sel}
    assert not ids & {"OLD", "SHOP", "HUGE"}


def test_select_iqr_trims_price_outliers():
    pool = _valid_pool(14)
    pool.append({**pool[0], "transaction_id": "SPIKE_PRICE", "price_per_m2": 99000.0})
    sel = select_sample(pool, subject_area=70.0, today_month="2026-07")
    assert all(t["transaction_id"] != "SPIKE_PRICE" for t in sel)


def test_select_returns_newest_pool_capped_at_pool_n():
    pool = _valid_pool(30)
    sel = select_sample(pool, subject_area=70.0, today_month="2026-07")
    assert len(sel) == POOL_N
    dates = [t["date"] for t in sel]
    assert dates == sorted(dates, reverse=True)


def test_select_is_deterministic():
    pool = _valid_pool(20)
    a = select_sample(pool, subject_area=70.0, today_month="2026-07")
    b = select_sample(list(pool), subject_area=70.0, today_month="2026-07")
    assert a == b
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/worker && uv run pytest tests/test_rcn_core.py -q`
Expected: FAIL — `ModuleNotFoundError: app.rcn`.

- [ ] **Step 3: Implement `apps/worker/app/rcn.py` (pure core half)**

Port `parse_gml` from the spike (wiki repo `tools/spike/2026-05-14-kcs/spike.py:184-217`) renaming output keys to English (`transaction_id, price_total, area, price_per_m2, date, date_month, function, x, y`; source fields stay `ms:lok_cena_brutto` etc. — copy the regex logic verbatim, price column `lok_cena_brutto` is the spike-pinned trap). Implement `select_sample` exactly per Global Constraints (date-sanity floor computed from `today_month` minus `DATE_WINDOW_MONTHS`; IQR only when pool ≥8; sort DESC by `date`; cap at `POOL_N`). Module docstring must cite both spikes and the garbage-dates discovery.

- [ ] **Step 4: GREEN + lint**

Run: `uv run pytest tests/test_rcn_core.py -q` → all pass; `uv run pytest -q` → whole suite green; `uv run ruff check . && uv run ruff format --check .` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): rcn pure core - gml parser and v2 sample selection"
git push origin main && gh run watch --exit-status
```

---

### Task 2: Worker — geocode/fetch I/O + `POST /sample-proposal` endpoint

**Files:**

- Modify: `apps/worker/app/rcn.py` (append I/O half), `apps/worker/app/main.py`
- Create: `apps/worker/tests/test_sample_proposal.py`

**Interfaces:**

- Consumes: Task 1 core.
- Produces: `POST /sample-proposal` `{address: str, area: float}` → 200 `{transactions: [{date, area, pricePerM2, transactionId}], meta: {lat, lon, fetchedAt, source: "rcn-wfs-gugik", query: {bbox, count, sort}}}`; 422 on invalid body (FastAPI default); 502 `{detail: "<Polish message>"}` on geocode/WFS failure; 404-style 502 variant when selection < 12 with the "Za mało transakcji…" message including the count. The web adapter (Task 3) relies on these exact shapes.

- [ ] **Step 1: Write failing contract tests — `apps/worker/tests/test_sample_proposal.py`**

TestClient + monkeypatch — no network:

```python
import pytest
from fastapi.testclient import TestClient

from app import rcn
from app.main import app
from tests.test_rcn_core import _valid_pool

client = TestClient(app)


@pytest.fixture
def happy_io(monkeypatch):
    monkeypatch.setattr(rcn, "geocode", lambda address: (52.41614, 16.90455))
    monkeypatch.setattr(rcn, "fetch_rcn", lambda bbox: "<gml/>")
    monkeypatch.setattr(rcn, "parse_gml", lambda gml: _valid_pool(16))


def test_returns_transactions_with_meta_and_never_wr(happy_io):
    r = client.post("/sample-proposal", json={"address": "Poznań, ul. Kościelna 33A", "area": 71.63})
    assert r.status_code == 200
    body = r.json()
    assert len(body["transactions"]) >= 12
    t = body["transactions"][0]
    assert set(t) == {"date", "area", "pricePerM2", "transactionId"}
    assert body["meta"]["source"] == "rcn-wfs-gugik"
    assert body["meta"]["query"]["count"] == 5000
    assert "fetchedAt" in body["meta"]
    # F-11: no market-value key anywhere in the payload (worker must never compute WR)
    assert '"wr"' not in r.text.lower()
    assert "marketvalue" not in r.text.lower()


def test_too_few_candidates_returns_polish_502(monkeypatch):
    monkeypatch.setattr(rcn, "geocode", lambda address: (52.4, 16.9))
    monkeypatch.setattr(rcn, "fetch_rcn", lambda bbox: "<gml/>")
    monkeypatch.setattr(rcn, "parse_gml", lambda gml: _valid_pool(5))
    r = client.post("/sample-proposal", json={"address": "x", "area": 70.0})
    assert r.status_code == 502
    assert "Za mało transakcji" in r.json()["detail"]
    assert "5" in r.json()["detail"]


def test_wfs_failure_returns_polish_502(monkeypatch):
    monkeypatch.setattr(rcn, "geocode", lambda address: (52.4, 16.9))

    def boom(bbox):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(rcn, "fetch_rcn", boom)
    r = client.post("/sample-proposal", json={"address": "x", "area": 70.0})
    assert r.status_code == 502
    assert "Nie udało się pobrać próby z RCN" in r.json()["detail"]


def test_invalid_body_is_422():
    r = client.post("/sample-proposal", json={"address": "x"})
    assert r.status_code == 422
```

- [ ] **Step 2: RED**

Run: `uv run pytest tests/test_sample_proposal.py -q` → FAIL (endpoint absent).

- [ ] **Step 3: Implement**

In `rcn.py` append `geocode(address)` (port of spike `geocode_nominatim` lines 220-248: structured street/city query + `q=` fallback, `USER_AGENT` header, 30 s timeout) and `fetch_rcn(bbox)` (port of `fetch_rcn_wgs84` lines 159-181 with `count=5000`, `sort="dok_data D"` defaults, 30 s timeout). In `main.py` add pydantic models and the route; the route computes `today_month` from `datetime.now(timezone.utc)` (I/O boundary — core stays pure), calls `geocode → bbox → fetch_rcn → parse_gml → select_sample`, maps errors to the two Polish 502 messages from Global Constraints, requires `len(selection) >= 12` else the "Za mało transakcji (znaleziono N)" 502. Route calls module functions VIA the `rcn` module namespace (`rcn.geocode(...)`) so monkeypatching works.

- [ ] **Step 4: GREEN + full worker suite + lint**

`uv run pytest -q` all green (old F-11 tests untouched); ruff clean.

- [ ] **Step 5: Commit + push + CI watch**

```bash
git add apps/worker
git commit -m "feat(worker): sample-proposal endpoint fetching rcn transactions"
git push origin main && gh run watch --exit-status
```

---

### Task 3: Web — port + HTTP adapter + wiring

**Files:**

- Create: `apps/web/src/ports/sample.ts`, `apps/web/src/adapters/sample-http.ts`, `apps/web/tests/sample-contract.test.ts`
- Modify: `apps/web/src/app/valuations/_deps.ts`

**Interfaces:**

- Produces: types `SampleTransaction { date: string; area: number; pricePerM2: number; transactionId: string }`, `SampleMeta { lat: number; lon: number; fetchedAt: string; source: string; query: { bbox: number[]; count: number; sort: string } }`, `SampleProposal { transactions: SampleTransaction[]; meta: SampleMeta }`, interface `PortSampleProposal { fetchProposal(address: string, area: number): Promise<SampleProposal> }`; `_deps.ts` exports `sampleProposal` singleton. Mirror the `PortWorker`/`worker-http.ts` pattern exactly (same error style: throw `Error` with status text on `!response.ok`; on 502 include the backend's Polish `detail` in the error message so the action can surface it).

- [ ] **Step 1: Failing contract test** (`sample-contract.test.ts` — mirror `worker-contract.test.ts` style: mocked `global.fetch`, assert request URL/method/body and response mapping; one test for the 502-with-detail path asserting the Polish detail lands in the thrown error message).
- [ ] **Step 2: RED** → `pnpm --filter web test -- sample-contract` fails.
- [ ] **Step 3: Implement port + adapter (`httpSampleProposal(baseUrl)`) + wire `export const sampleProposal = httpSampleProposal(process.env.WORKER_URL ?? "http://localhost:8000");` in `_deps.ts`.**
- [ ] **Step 4: GREEN + `pnpm depcruise`** (ports stay pure; adapter imported only from app layer).
- [ ] **Step 5: Commit + push + CI watch** — `feat(web): sample proposal port and http adapter`

---

### Task 4: Web — schema provenance + Server Action

**Files:**

- Modify: `apps/web/src/lib/valuation-form-schema.ts` (comparable gains optional `source: z.enum(["rcn","manual"]).optional()`, `transactionId: z.string().optional()`; new exported `sampleMetaSchema` optional on the form schema as `sampleMeta`), `apps/web/src/app/actions/create-valuation.ts` (pass provenance through to `inputs`: comparables keep their `source`/`transactionId`; `inputs.sampleMeta = parsed.data.sampleMeta ?? null`), `apps/web/src/domain/kcs.ts` (extend `Comparable` with the two optional fields; `KcsInput` gains optional `sampleMeta` — engine ignores them; document that in one comment line)
- Create: `apps/web/src/app/actions/get-sample-proposal.ts`, `apps/web/tests/get-sample-proposal-action.test.ts`, extend `apps/web/tests/valuation-form-schema.test.ts` and `apps/web/tests/kcs-reproducibility.test.ts`

**Interfaces:**

- Produces: Server Action `getSampleProposal(input: { address: string; area: number }): Promise<{ proposal: SampleProposal } | { error: string }>` — session-gated (redirect to /login like createValuation), zod-validated (reuse address/area rules from the shared schema via `.pick()`), calls `sampleProposal.fetchProposal`, maps thrown adapter errors to `{ error }` with the Polish detail when present, generic fallback `"Nie udało się pobrać próby z RCN — spróbuj ponownie albo wpisz transakcje ręcznie."`.
- **F-5(b) lands here:** extend `kcs-reproducibility.test.ts` with a case persisting a valuation whose `inputs` carries 12 comparables with `source: "rcn"`, `transactionId` and a `sampleMeta` — read back and assert all provenance fields round-trip and `comparables.length >= 12`.

- [ ] **Step 1: Failing tests** — schema tests (provenance fields accepted, unknown `source` rejected), action tests (session-mocked like `create-valuation-action.test.ts`: happy path returns proposal from mocked `_deps.sampleProposal` via `vi.mock("@/app/valuations/_deps")`; adapter throw → Polish `{error}`), F-5 roundtrip test.
- [ ] **Step 2: RED** → run the three files.
- [ ] **Step 3: Implement** (schema fields, engine type extension, the new action, createValuation passthrough).
- [ ] **Step 4: GREEN**: `pnpm turbo lint typecheck test --env-mode=loose && pnpm depcruise`.
- [ ] **Step 5: Commit + push + CI watch** — `feat(web): sample provenance in snapshot and get-sample-proposal action (F-5)`

---

### Task 5: Web — form UI: „Pobierz próbę z RCN"

**Files:**

- Modify: `apps/web/src/app/valuations/new/new-valuation-form.tsx`, `apps/web/e2e/smoke.spec.ts` (only if selectors shift — manual-entry flow MUST keep passing unchanged)

**Interfaces (structural spec — follow the file's existing conventions):**

- Button `Pobierz próbę z RCN` (`type="button"`, id `fetch-sample`, shadcn Button variant outline, placed next to `Dodaj transakcję`), disabled while pending with label `Pobieranie…`.
- onClick: client-side guard — address + area must currently validate (`trigger(["address","area"])`); if not, show the field errors and do nothing else. Then call `getSampleProposal({address, area})`.
- Success: `replace()` the comparables fieldArray with `proposal.transactions.map(t => ({date: t.date, area: String(t.area), pricePerM2: String(t.pricePerM2), source: "rcn", transactionId: t.transactionId}))` (first 12 — the worker returns up to 19; keep the rest OUT — user can re-fetch), store `proposal.meta` in a `useState` and register it into the form value `sampleMeta` via `setValue`; rows stay fully editable/removable (manual edits keep `source: "rcn"` — fidelity of hand-edits is a later gating-slice concern, note it in a comment).
- Failure: Polish error text under the button (`role="alert"`, same pattern as `submitError`).
- Amber warning when comparables count < 12 (same style as the weights warning): `Operat wymaga co najmniej 12 transakcji — masz {n}.` — shows for BOTH manual and fetched samples; zod minimum stays ≥3.
- Live stats (Cmin/Cmax/Cśr) must react to the replaced rows (they watch the fieldArray already).

- [ ] **Step 1: Implement per spec above** (this is UI wiring — no new unit tests; the action/adapter/schema layers are covered by Tasks 3-4; browser QA covers the visual flow).
- [ ] **Step 2: Full check** `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`; local e2e (manual-entry smoke) → `1 passed`.
- [ ] **Step 3: Commit + push + CI watch** — `feat(web): fetch sample from rcn button fills comparables with provenance`

---

### Task 6: Deploy + live QA + wiki (S5/S6 — human-gated)

⛔ **CHECKPOINTS: confirm with the user before each deploy step.**

- [ ] **Step 1:** CI green on HEAD (`gh run watch`).
- [ ] **Step 2 (⛔):** deploy WORKER to Railway — first worker redeploy since Slice 0: `cd apps/worker && railway link --project wyceny` (service: the worker service, NOT Postgres) `&& railway up`. Verify `https://worker-production-c672.up.railway.app/health` → `{"ok":true}` and a manual `curl -X POST .../sample-proposal -d '{"address":"Poznań, ul. Kościelna 33A","area":71.63}' -H 'Content-Type: application/json'` returns ≥12 transactions (live GUGiK — expect ~5-10 s).
- [ ] **Step 3 (⛔):** deploy web: `vercel deploy --prod` from the monorepo ROOT (project `wyceny`; NEVER create a root vercel.json).
- [ ] **Step 4: Live QA (browser, controller as user):** login → new valuation → Kościelna 33A + 71,63 → „Pobierz próbę z RCN" → ≥12 rows filled with live data + stats update → adjust features per reference table → create → **WR within ±10% of 1 044 400** (spike calibration: +6,5%) + breakdown renders + `inputs.sampleMeta` persisted (verify via detail page render or repo query). Corner: bogus address → Polish error, form still usable; manual entry still works end-to-end.
- [ ] **Step 5: Wiki S6 (branch + PR — protected main):** per `docs-update-checklist`: log.md, timeline.md, new tech page `wiki/topics/tech/rcn-sample-fetch-slice.md` (cite BOTH spikes), roadmap: this NOW → ✅ DONE; **NEW NOW promotion decision for the user**; roadmap NEXT gains explicit entry: „**Dane przedmiotu: EGiB/MPZP** — wymaga SPIKE-FIRST (zbadać: usługi WFS/API EGiB i MPZP, auth, pola, pokrycie Poznania, latencja) zanim powstanie kod produkcyjny" + backlog items from the spec's Non-goals section (verbatim — user rule: deferred items must be fully documented). Include the `2026-07-14-rcn-live-revalidation` spike wiki page (`wiki/topics/tech/spike-2026-07-14-rcn-live-revalidation.md`, frontmatter per wiki CLAUDE.md §3, link to `tools/spike/`).

---

## Definition of Done (mirrors the spec)

- [ ] Worker: `POST /sample-proposal` live on Railway; pytest offline green; ruff clean; F-11 intact.
- [ ] Web: button fills ≥12 provenance-tagged comparables; manual fallback untouched; amber <12 warning.
- [ ] F-5 in CI: selection tests (garbage dates! IQR!) + snapshot provenance roundtrip.
- [ ] Prod live QA: Kościelna fetch → WR in ±10% band; bogus-address error path; smoke E2E (manual flow) green in CI.
- [ ] Wiki updated via PR (incl. spike page + EGiB/MPZP spike-first backlog entry).
