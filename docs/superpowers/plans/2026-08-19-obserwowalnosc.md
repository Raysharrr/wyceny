# Obserwowalność — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every request carries an 8-char traceId visible to the user on failure; failures and AI-proposal fingerprints persist in Postgres; `pnpm trace <id>` reconstructs a run.

**Architecture:** Two sinks with different jobs. Structured JSON to stdout (pino in web, structlog in worker) carries everything; a new `event_log` table carries only what must outlive hosting retention. traceId lives in `AsyncLocalStorage` (web) / `contextvars` (worker) and crosses the boundary as the `X-Request-Id` header. All log fields pass an **allowlist** — never a denylist.

**Tech Stack:** Next 16 (Node runtime only, no edge, no middleware), pino, Drizzle/Postgres, vitest, Playwright; worker: FastAPI + uvicorn, structlog, pytest, ruff.

**Spec:** `docs/superpowers/specs/2026-08-19-obserwowalnosc-design.md`
**Brief:** `GOAL.md` (repo root)

## Global Constraints

- **Allowlist, never denylist.** Permitted log keys, exhaustively: `event, traceId, valuationId, actorId, ms, status, count, section, model, errName, errMessage, errStack`. Anything else is dropped. pino's `redact` is rejected by design — do not introduce it.
- **`errMessage` truncated to 300 chars.** Assumption on record: staging, cheap to fix. Revisit for production with real client data.
- **AI proposals are stored as `sha256` hashes, never plaintext.** No addresses, no land-registry data, no comparable transactions in `event_log`.
- **Event writes happen OUTSIDE the mutation transaction.** A rollback must not erase the record of its own failure.
- **`audit_log` is untouched.** Closed action enum, append-only trigger, legal artifact (FR-12).
- **No logging in `apps/web/src/domain/**`.** F-10 is enforced by `pnpm depcruise`.
- **`apps/web/src/lib/**` must not import `apps/web/src/adapters/**`** (F-10 rule `adapters-wired-only-at-app-layer`). The stdout logger and the Postgres event sink are therefore separate units, composed in `src/app/`.
- **traceId is 8 hex chars** — `crypto.randomUUID().slice(0, 8)`. It is read aloud over the phone.
- **Migration number is `0012`.** Additive. No append-only trigger on `event_log`.
- **Repo is public (F-9).** No real addresses, land-registry numbers, or personal data in code, tests, or fixtures.
- **Language:** code and comments English (NFR-10); UI copy Polish.

---

### Task 0: Spike — pino bundling + ALS propagation + `X-Request-Id`

Throwaway. Its output is an answer, not code we keep. Two unverified assumptions carry this whole design; both must hold before anything else is written.

**Files:**

- Create (throwaway): `apps/web/src/app/spike-obs/page.tsx`, `apps/web/src/app/spike-obs/action.ts`
- Modify (throwaway, only if bundler complains): `apps/web/next.config.ts`
- Modify (throwaway): `apps/worker/app/main.py` — log the incoming header in `/health`

**PASS criteria — fixed BEFORE running, all three must hold:**

1. `pnpm turbo build --filter=web` completes with no bundler warning about pino.
2. A pino line appears in Vercel logs as JSON after hitting the page on staging.
3. **The same 8 chars appear in the worker's log line** on Railway.

- [ ] **Step 1: Add pino**

```bash
cd apps/web && pnpm add pino
```

- [ ] **Step 2: Write the throwaway action**

```ts
// apps/web/src/app/spike-obs/action.ts
"use server";

import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";

const als = new AsyncLocalStorage<{ traceId: string }>();
const logger = pino();

export async function spikeAction() {
  const traceId = crypto.randomUUID().slice(0, 8);
  return als.run({ traceId }, async () => {
    logger.info({ event: "spike.start", traceId }, "spike");
    // The load-bearing bit: traceId is read AFTER an await, from a nested
    // call that was never passed it.
    await new Promise((r) => setTimeout(r, 10));
    const res = await callWorker();
    logger.info({ event: "spike.done", traceId, status: res }, "spike");
    return traceId;
  });
}

async function callWorker() {
  const traceId = als.getStore()?.traceId ?? "NONE";
  const base = process.env.WORKER_URL ?? "http://localhost:8000";
  const r = await fetch(`${base}/health`, { headers: { "X-Request-Id": traceId } });
  return r.status;
}
```

- [ ] **Step 3: Minimal page calling it**

```tsx
// apps/web/src/app/spike-obs/page.tsx
import { spikeAction } from "./action";

export default function Page() {
  return (
    <form
      action={async () => {
        "use server";
        await spikeAction();
      }}
    >
      <button type="submit">spike</button>
    </form>
  );
}
```

- [ ] **Step 4: Worker echoes the header**

```python
# apps/worker/app/main.py — inside health()
@app.get("/health")
def health(request: Request) -> dict[str, bool]:
    logger.info("spike health x-request-id=%s", request.headers.get("x-request-id"))
    return {"ok": True}
```

- [ ] **Step 5: Build locally**

Run: `pnpm turbo build --filter=web --env-mode=loose`
Expected: PASS, no pino/bundler warning. If it fails, add `serverExternalPackages: ["pino"]` to `next.config.ts` and note it — that is a spike finding, not a silent fix.

- [ ] **Step 6: Deploy and verify live**

Web deploys from the branch preview; **worker `worker-v2` must be pushed manually** (no repo `source` on the Railway service). Hit the page, then read both logs.

- [ ] **Step 7: Record the verdict**

Write findings to the spec (`## Task zerowy` section): which of the three criteria held, whether `serverExternalPackages` was needed.
**On FAIL → STOP and return to the user.** Fallback is a ~30-line in-house logger behind the identical wrapper interface, or explicit traceId threading through five port interfaces. Do not improvise.

- [ ] **Step 8: Delete the spike**

```bash
git rm -r apps/web/src/app/spike-obs && git checkout apps/worker/app/main.py
git commit -m "chore: remove observability spike scaffolding"
```

---

### Task 1: Log wrapper with allowlist + `no-console` lint rule (F-13)

**Files:**

- Create: `apps/web/src/lib/log.ts`
- Modify: `apps/web/eslint.config.mjs`
- Test: `apps/web/tests/log.test.ts`

**Interfaces:**

- Produces: `log.info(fields: LogFields): void`, `log.warn(fields)`, `log.error(fields)`, `type LogFields`, `const ALLOWED_KEYS: readonly string[]`, `function pickAllowed(input: Record<string, unknown>): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/log.test.ts
import { describe, expect, it } from "vitest";
import { pickAllowed } from "../src/lib/log";

describe("log allowlist", () => {
  it("keeps permitted keys", () => {
    expect(pickAllowed({ event: "a", traceId: "b", ms: 12 })).toEqual({
      event: "a",
      traceId: "b",
      ms: 12,
    });
  });

  it("drops anything not on the list — this is the RODO gate", () => {
    const out = pickAllowed({ event: "a", address: "ul. Testowa 1", kwNumber: "PO1P/000/1" });
    expect(out).toEqual({ event: "a" });
  });

  it("truncates errMessage to 300 chars", () => {
    const out = pickAllowed({ event: "a", errMessage: "x".repeat(500) });
    expect((out.errMessage as string).length).toBe(300);
  });

  it("drops a permitted key carrying an object — allowlist is by key AND shape", () => {
    expect(pickAllowed({ event: "a", ms: { nested: 1 } })).toEqual({ event: "a" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/log.test.ts`
Expected: FAIL — cannot resolve `../src/lib/log`

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/log.ts
import pino from "pino";

/**
 * Every field that may ever reach a log line. This is an ALLOWLIST, and the
 * direction matters: pino's `redact` enumerates what to hide, so one
 * forgotten path is a leak. Here a forgotten field is merely absent from the
 * log. Addresses, land-registry data and prose text are simply not on the
 * list, so they cannot escape through an oversight (spec §Bramka RODO).
 */
export const ALLOWED_KEYS = [
  "event",
  "traceId",
  "valuationId",
  "actorId",
  "ms",
  "status",
  "count",
  "section",
  "model",
  "errName",
  "errMessage",
  "errStack",
] as const;

const MAX_ERR_MESSAGE = 300;
const MAX_ERR_STACK = 2000;

export type LogFields = Partial<Record<(typeof ALLOWED_KEYS)[number], string | number>> & {
  event: string;
};

/** Second layer behind the TypeScript type: strips at runtime what the type
 *  cannot (a value widened to `any`, a spread of untyped input). */
export function pickAllowed(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    const value = input[key];
    // Scalars only: an object on a permitted key could smuggle a whole
    // valuation payload through a legitimate name.
    if (typeof value !== "string" && typeof value !== "number") continue;
    if (key === "errMessage" && typeof value === "string") {
      out[key] = value.slice(0, MAX_ERR_MESSAGE);
    } else if (key === "errStack" && typeof value === "string") {
      out[key] = value.slice(0, MAX_ERR_STACK);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// eslint-disable-next-line no-console -- this module IS the sanctioned console.
const pinoLogger = pino({ base: undefined });

export const log = {
  info: (fields: LogFields) => pinoLogger.info(pickAllowed(fields)),
  warn: (fields: LogFields) => pinoLogger.warn(pickAllowed(fields)),
  error: (fields: LogFields) => pinoLogger.error(pickAllowed(fields)),
};

/** Flattens an unknown thrown value into allowlisted fields. */
export function errFields(error: unknown): Pick<LogFields, "errName" | "errMessage" | "errStack"> {
  if (error instanceof Error) {
    return { errName: error.name, errMessage: error.message, errStack: error.stack ?? "" };
  }
  return { errName: "NonError", errMessage: String(error) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run tests/log.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Add the lint rule that makes the wrapper mandatory**

```js
// apps/web/eslint.config.mjs — append inside defineConfig([...])
  {
    // F-13: the allowlist is only a gate if it cannot be bypassed. A bare
    // console.* would put an unfiltered object straight into the log.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/log.ts"],
    rules: { "no-console": "error" },
  },
```

- [ ] **Step 6: Verify the rule bites**

Run: `cd apps/web && pnpm lint`
Expected: FAIL, listing the 21 existing `console.error` sites. That failure is the proof the rule works; Task 3 clears it.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/log.ts apps/web/tests/log.test.ts apps/web/eslint.config.mjs apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): log wrapper with an allowlist, and a lint rule that makes it mandatory"
```

---

### Task 2: traceId in `AsyncLocalStorage`

**Files:**

- Create: `apps/web/src/lib/trace.ts`
- Test: `apps/web/tests/trace.test.ts`

**Interfaces:**

- Produces: `newTraceId(): string`, `withTrace<T>(fn: () => Promise<T>): Promise<T>`, `currentTraceId(): string | undefined`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/trace.test.ts
import { describe, expect, it } from "vitest";
import { currentTraceId, newTraceId, withTrace } from "../src/lib/trace";

describe("trace context", () => {
  it("is 8 hex chars — short enough to read over the phone", () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("survives an await in a nested call that was never passed it", async () => {
    const seen = await withTrace(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return nested();
    });
    expect(seen).toMatch(/^[0-9a-f]{8}$/);
  });

  it("keeps concurrent runs isolated — the whole point of ALS", async () => {
    const [a, b] = await Promise.all([
      withTrace(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return nested();
      }),
      withTrace(async () => {
        await new Promise((r) => setTimeout(r, 1));
        return nested();
      }),
    ]);
    expect(a).not.toBe(b);
  });

  it("returns undefined outside any traced run", () => {
    expect(currentTraceId()).toBeUndefined();
  });
});

function nested() {
  return currentTraceId();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/trace.test.ts`
Expected: FAIL — cannot resolve `../src/lib/trace`

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/trace.ts
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One id per request, ambient for its whole async chain.
 *
 * A module-level variable cannot work here: Node serves concurrent requests on
 * one event loop, so two appraisers would overwrite each other's id and the
 * traces would cross. AsyncLocalStorage pins the value to the async call
 * chain instead, which is what lets the five worker adapters keep their
 * current signatures (spec §Architektura).
 */
const store = new AsyncLocalStorage<{ traceId: string }>();

export function newTraceId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ traceId: newTraceId() }, fn);
}

export function currentTraceId(): string | undefined {
  return store.getStore()?.traceId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run tests/trace.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/trace.ts apps/web/tests/trace.test.ts
git commit -m "feat(web): one traceId per request, ambient through the async chain"
```

---

### Task 3: Convert the 21 `console.error` sites; show the code to the user

**Files:**

- Modify: all 21 sites listed by `pnpm lint` after Task 1 — `apps/web/src/app/actions/*.ts` (confirm-sample, confirm-subject, confirm-prose, confirm-features, confirm-kw, propose-prose, save-signature, inspection ×4, sign-valuation ×3, approve-valuation ×2, wizard ×4) and `apps/web/src/app/valuations/[id]/steps/step-descriptions.tsx:177`
- Test: `apps/web/tests/action-error-code.test.ts`

**Interfaces:**

- Consumes: `log`, `errFields` (Task 1); `withTrace`, `currentTraceId` (Task 2)
- Produces: `function errorWithCode(message: string): string` in `apps/web/src/lib/trace.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/action-error-code.test.ts
import { describe, expect, it } from "vitest";
import { errorWithCode, withTrace } from "../src/lib/trace";

describe("user-facing error code", () => {
  it("appends the traceId the appraiser reads over the phone", async () => {
    const msg = await withTrace(async () => errorWithCode("Nie udało się potwierdzić próby."));
    expect(msg).toMatch(/^Nie udało się potwierdzić próby\. \(kod: [0-9a-f]{8}\)$/);
  });

  it("leaves the message alone when there is no trace context", () => {
    expect(errorWithCode("Coś poszło nie tak.")).toBe("Coś poszło nie tak.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/action-error-code.test.ts`
Expected: FAIL — `errorWithCode` is not exported

- [ ] **Step 3: Implement the helper**

```ts
// apps/web/src/lib/trace.ts — append
/** Appends the trace code to a user-facing Polish message, so the appraiser
 *  can read it back and we can find the run. Adds nothing when untraced. */
export function errorWithCode(message: string): string {
  const traceId = currentTraceId();
  return traceId ? `${message} (kod: ${traceId})` : message;
}
```

- [ ] **Step 4: Convert one site and confirm the shape**

```ts
// apps/web/src/app/actions/confirm-sample.ts — replace the catch block
  } catch (error) {
    log.error({ event: "confirmSample.failed", valuationId: id, actorId: session.user.id, ...errFields(error) });
    return { error: errorWithCode("Nie udało się potwierdzić próby — spróbuj ponownie.") };
  }
```

The whole body moves inside `withTrace`, because the id must exist for both the log line and the message. Next.js Server Actions have no middleware to hang this on, so each action wraps its own body — 21 mechanical edits of exactly this shape:

```ts
export async function confirmSample(id: string): Promise<ConfirmSampleResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return withTrace(async () => {
    try {
      const updated = await valuationRepository.confirmSample(id, session.user);
      if (!updated) {
        return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
      }
    } catch (error) {
      log.error({
        event: "confirmSample.failed",
        valuationId: id,
        actorId: session.user.id,
        ...errFields(error),
      });
      return { error: errorWithCode("Nie udało się potwierdzić próby — spróbuj ponownie.") };
    }

    revalidatePath(`/valuations/${id}`);
  });
}
```

Note `redirect()` stays OUTSIDE the wrapper: Next implements it by throwing, and swallowing that throw inside a traced block would turn a redirect into a logged error.

- [ ] **Step 5: Convert the remaining 20 sites the same way**

Each keeps its existing Polish message; only the log call and the `errorWithCode` wrapper are new. Event names follow `<action>.failed`.

- [ ] **Step 6: Run lint and the suite**

Run: `cd apps/web && pnpm lint && pnpm vitest run`
Expected: lint PASS (zero `no-console` violations), suite PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat(web): failures log with context and hand the appraiser a code"
```

---

### Task 4: Worker — structlog + `X-Request-Id` middleware

**Files:**

- Create: `apps/worker/app/logging_setup.py`
- Modify: `apps/worker/app/main.py` (replace `logger = logging.getLogger("uvicorn.error")` and the 8 call sites), `apps/worker/pyproject.toml`
- Test: `apps/worker/tests/test_request_id.py`

**Interfaces:**

- Produces: `configure_logging() -> None`, `RequestIdMiddleware`, `log = structlog.get_logger()`

- [ ] **Step 1: Add the dependency**

```bash
cd apps/worker && uv add structlog
```

- [ ] **Step 2: Write the failing test**

```python
# apps/worker/tests/test_request_id.py
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_incoming_request_id_is_echoed_back():
    r = client.get("/health", headers={"X-Request-Id": "a3f1c2d9"})
    assert r.status_code == 200
    assert r.headers["x-request-id"] == "a3f1c2d9"


def test_missing_request_id_gets_one_minted():
    r = client.get("/health")
    assert len(r.headers["x-request-id"]) == 8


def test_request_id_reaches_the_log_line(capsys):
    client.get("/health", headers={"X-Request-Id": "beefcafe"})
    assert "beefcafe" in capsys.readouterr().out
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/test_request_id.py -q`
Expected: FAIL — `KeyError: 'x-request-id'`

- [ ] **Step 4: Implement**

```python
# apps/worker/app/logging_setup.py
"""Structured JSON logging with a request id bound per request.

Why contextvars and not a module global: uvicorn serves requests concurrently
on one event loop, so a global would let two requests overwrite each other's
id. `structlog.contextvars` scopes the binding to the async task. Starlette's
threadpool (used by the sync `def` handlers here, e.g. /convert-to-pdf) copies
the context into the worker thread, so sync handlers inherit it too.
"""

import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware


def configure_logging() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
    )


log = structlog.get_logger()


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Binds the web app's traceId, or mints one when called directly."""

    async def dispatch(self, request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:8]
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(trace_id=request_id)
        try:
            response = await call_next(request)
        finally:
            pass
        response.headers["x-request-id"] = request_id
        return response
```

```python
# apps/worker/app/main.py — replace the logger line and add the middleware
from app.logging_setup import RequestIdMiddleware, configure_logging, log as logger

configure_logging()
app = FastAPI(title="wyceny-worker")
app.add_middleware(RequestIdMiddleware)
```

Then convert the 8 call sites from printf style to key-value, e.g.:

```python
        logger.error("prose_section_failed", section=section, err=str(exc))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/worker && uv run pytest tests/test_request_id.py -q`
Expected: PASS (3 tests)

- [ ] **Step 6: Ban bare `print`**

```toml
# apps/worker/pyproject.toml — under [tool.ruff.lint]
select = ["E", "F", "T201"]
```

Run: `cd apps/worker && uv run ruff check . && uv run pytest -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): json logs with the caller's request id bound per request"
```

---

### Task 5: Adapters send `X-Request-Id`

**Files:**

- Modify: `apps/web/src/adapters/worker-http.ts`, `sample-http.ts`, `subject-http.ts`, `prose-http.ts`, `maps-http.ts`
- Test: `apps/web/tests/worker-trace-header.test.ts`

**Interfaces:**

- Consumes: `currentTraceId` (Task 2)
- Produces: `function traceHeaders(): Record<string, string>` in `apps/web/src/lib/trace.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/worker-trace-header.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { httpProseProposal } from "../src/adapters/prose-http";
import { withTrace } from "../src/lib/trace";

afterEach(() => vi.unstubAllGlobals());

describe("worker adapters", () => {
  it("send the ambient traceId as X-Request-Id", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sekcje: {},
            odrzucone: {},
            model: "m",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await withTrace(async () =>
      httpProseProposal("http://worker.test").fetchProposal({
        token: "t",
        sections: [],
        facts: {},
        transactions: [],
      } as never),
    );

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["X-Request-Id"]).toMatch(/^[0-9a-f]{8}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/worker-trace-header.test.ts`
Expected: FAIL — `headers["X-Request-Id"]` is undefined

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/trace.ts — append
/** Headers that carry the trace across the web↔worker boundary (ADR-009). */
export function traceHeaders(): Record<string, string> {
  const traceId = currentTraceId();
  return traceId ? { "X-Request-Id": traceId } : {};
}
```

In each of the five adapters, merge it into the existing headers:

```ts
        headers: { "Content-Type": "application/json", ...traceHeaders() },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run tests/worker-trace-header.test.ts && pnpm depcruise`
Expected: PASS; depcruise PASS (`lib/` imports nothing from `adapters/`)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat(web): worker calls carry the trace id across the boundary"
```

---

### Task 6: `event_log` — migration `0012`, port, adapter

**Files:**

- Modify: `apps/web/src/db/schema.ts`
- Create: `apps/web/drizzle/0012_event_log.sql` (generated), `apps/web/src/ports/event-log.ts`, `apps/web/src/adapters/event-log-drizzle.ts`
- Modify: `apps/web/src/app/valuations/_deps.ts`
- Test: `apps/web/tests/event-log.test.ts`

**Interfaces:**

- Produces: `type AppEvent = { level: "info" | "warn" | "error"; event: string; traceId?: string; actorId?: string; valuationId?: string; meta?: unknown }`, `interface PortEventLog { record(e: AppEvent): Promise<void>; byTrace(traceId: string): Promise<EventRow[]>; byValuation(valuationId: string): Promise<EventRow[]> }`, `function eventLogRepo(db): PortEventLog`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/event-log.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import { eventLogRepo } from "../src/adapters/event-log-drizzle";

const repo = eventLogRepo(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await pool.end();
});

describe("event_log", () => {
  it("records and reads back by trace", async () => {
    const traceId = "aaaa1111";
    await repo.record({ level: "error", event: "confirmSample.failed", traceId, actorId: "u1" });
    const rows = await repo.byTrace(traceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe("confirmSample.failed");
    expect(rows[0]!.level).toBe("error");
  });

  it("is ordered oldest-first, so a run reads as a timeline", async () => {
    const traceId = "bbbb2222";
    await repo.record({ level: "info", event: "first", traceId });
    await repo.record({ level: "error", event: "second", traceId });
    expect((await repo.byTrace(traceId)).map((r) => r.event)).toEqual(["first", "second"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/event-log.test.ts`
Expected: FAIL — cannot resolve the adapter

- [ ] **Step 3: Add the table to the schema**

```ts
// apps/web/src/db/schema.ts — append
/**
 * Operational trail: what failed, and the fingerprints of AI proposals.
 * Deliberately NOT `audit_log` — that one is the legal record with a closed
 * action enum and an append-only trigger (FR-12). This one is prunable by
 * design, carries no such trigger, and never holds plaintext proposals.
 */
export const eventLog = pgTable("event_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  level: text("level").notNull(),
  event: text("event").notNull(),
  traceId: text("trace_id"),
  // No FK, same reason as audit_log: these rows must outlive data surgery.
  valuationId: uuid("valuation_id"),
  actorId: text("actor_id"),
  meta: jsonb("meta"),
});
```

- [ ] **Step 4: Generate the migration**

```bash
cd apps/web && pnpm exec drizzle-kit generate --name event_log
```

Expected: `drizzle/0012_event_log.sql` — verify it is additive only (`CREATE TABLE`), with no trigger.

- [ ] **Step 5: Implement port and adapter**

```ts
// apps/web/src/ports/event-log.ts
export type EventLevel = "info" | "warn" | "error";

export type AppEvent = {
  level: EventLevel;
  event: string;
  traceId?: string;
  actorId?: string;
  valuationId?: string;
  meta?: unknown;
};

export type EventRow = AppEvent & { id: number; at: Date };

export interface PortEventLog {
  record(e: AppEvent): Promise<void>;
  byTrace(traceId: string): Promise<EventRow[]>;
  byValuation(valuationId: string): Promise<EventRow[]>;
}
```

```ts
// apps/web/src/adapters/event-log-drizzle.ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { AppEvent, EventRow, PortEventLog } from "../ports/event-log";

export function eventLogRepo(db: NodePgDatabase<typeof schema>): PortEventLog {
  return {
    // No transaction on purpose: the caller is usually INSIDE a failed one,
    // and a rollback must not erase the record of its own failure
    // (spec §Architektura, rozstrzygnięcie 2).
    async record(e: AppEvent): Promise<void> {
      await db.insert(schema.eventLog).values({
        level: e.level,
        event: e.event,
        traceId: e.traceId ?? null,
        actorId: e.actorId ?? null,
        valuationId: e.valuationId ?? null,
        meta: (e.meta as never) ?? null,
      });
    },
    async byTrace(traceId: string): Promise<EventRow[]> {
      return rows(
        await db
          .select()
          .from(schema.eventLog)
          .where(eq(schema.eventLog.traceId, traceId))
          .orderBy(schema.eventLog.id),
      );
    },
    async byValuation(valuationId: string): Promise<EventRow[]> {
      return rows(
        await db
          .select()
          .from(schema.eventLog)
          .where(eq(schema.eventLog.valuationId, valuationId))
          .orderBy(schema.eventLog.id),
      );
    },
  };
}

function rows(raw: (typeof schema.eventLog.$inferSelect)[]): EventRow[] {
  return raw.map((r) => ({
    id: r.id,
    at: r.at,
    level: r.level as EventRow["level"],
    event: r.event,
    traceId: r.traceId ?? undefined,
    actorId: r.actorId ?? undefined,
    valuationId: r.valuationId ?? undefined,
    meta: r.meta,
  }));
}
```

- [ ] **Step 6: Wire it at the app layer**

```ts
// apps/web/src/app/valuations/_deps.ts — append
export const eventLog = eventLogRepo(db);
```

- [ ] **Step 7: Run tests**

Run: `cd apps/web && pnpm exec drizzle-kit migrate && pnpm vitest run tests/event-log.test.ts && pnpm depcruise`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/web/drizzle apps/web/tests
git commit -m "feat(web): event_log table, port and adapter for the operational trail"
```

---

### Task 7: Persist failures — and prove a rollback cannot erase them

**Files:**

- Create: `apps/web/src/app/actions/_record-failure.ts`
- Modify: the 21 sites from Task 3
- Test: `apps/web/tests/failure-survives-rollback.test.ts`

**Interfaces:**

- Consumes: `PortEventLog` (Task 6), `log`/`errFields` (Task 1), `currentTraceId` (Task 2)
- Produces: `async function recordFailure(args: { event: string; error: unknown; valuationId?: string; actorId?: string }): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/failure-survives-rollback.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import { eventLogRepo } from "../src/adapters/event-log-drizzle";

const repo = eventLogRepo(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await pool.end();
});

describe("failure record", () => {
  it("survives the rollback of the transaction that failed", async () => {
    const traceId = "cccc3333";
    await expect(
      db.transaction(async () => {
        await repo.record({ level: "error", event: "boom", traceId });
        throw new Error("mutation failed");
      }),
    ).rejects.toThrow("mutation failed");

    // The point: audit_log writes INSIDE the transaction and would vanish
    // here. The failure record must not.
    expect(await repo.byTrace(traceId)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/failure-survives-rollback.test.ts`
Expected: FAIL — 0 rows, because `record` currently joins the ambient transaction

- [ ] **Step 3: Implement on a connection of its own**

```ts
// apps/web/src/adapters/event-log-drizzle.ts — change `record` to bypass any
// ambient transaction by taking its own pool connection.
    async record(e: AppEvent): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query(
          `insert into event_log (level, event, trace_id, actor_id, valuation_id, meta)
           values ($1, $2, $3, $4, $5, $6)`,
          [e.level, e.event, e.traceId ?? null, e.actorId ?? null,
           e.valuationId ?? null, e.meta ? JSON.stringify(e.meta) : null],
        );
      } finally {
        client.release();
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run tests/failure-survives-rollback.test.ts`
Expected: PASS

- [ ] **Step 5: One helper both sinks go through**

```ts
// apps/web/src/app/actions/_record-failure.ts
import { eventLog } from "@/app/valuations/_deps";
import { errFields, log } from "@/lib/log";
import { currentTraceId } from "@/lib/trace";

/** stdout gets everything; Postgres gets what must outlive hosting retention. */
export async function recordFailure(args: {
  event: string;
  error: unknown;
  valuationId?: string;
  actorId?: string;
}): Promise<void> {
  const traceId = currentTraceId();
  log.error({
    event: args.event,
    traceId,
    valuationId: args.valuationId,
    actorId: args.actorId,
    ...errFields(args.error),
  });
  await eventLog.record({
    level: "error",
    event: args.event,
    traceId,
    valuationId: args.valuationId,
    actorId: args.actorId,
    meta: errFields(args.error),
  });
}
```

- [ ] **Step 6: Route the 21 sites through it**

Replace each `log.error({...})` from Task 3 with `await recordFailure({...})`.

- [ ] **Step 7: Run the suite**

Run: `cd apps/web && pnpm vitest run && pnpm lint && pnpm depcruise`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat(web): failures persist even when their transaction rolls back"
```

---

### Task 8: Fingerprint of AI proposals (hashes, never values)

**Files:**

- Create: `apps/web/src/lib/fingerprint.ts`
- Modify: `apps/web/src/app/actions/wizard.ts` (sample + subject auto-fetch), `apps/web/src/app/actions/propose-prose.ts`
- Test: `apps/web/tests/fingerprint.test.ts`

**Interfaces:**

- Produces: `function fingerprint(values: Record<string, unknown>): Record<string, string>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/fingerprint.test.ts
import { describe, expect, it } from "vitest";
import { fingerprint } from "../src/lib/fingerprint";

describe("proposal fingerprint", () => {
  it("hashes every value — no plaintext may reach event_log", () => {
    const out = fingerprint({ street: "ul. Przykładowa 1", area: 54.2 });
    expect(out.street).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(out)).not.toContain("Przykładowa");
  });

  it("is stable, so unchanged means unchanged", () => {
    expect(fingerprint({ a: 1 }).a).toBe(fingerprint({ a: 1 }).a);
  });

  it("distinguishes an edited value", () => {
    expect(fingerprint({ a: 1 }).a).not.toBe(fingerprint({ a: 2 }).a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/fingerprint.test.ts`
Expected: FAIL — cannot resolve `../src/lib/fingerprint`

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/fingerprint.ts
import { createHash } from "node:crypto";

/**
 * Per-field hashes of an AI proposal.
 *
 * The metric this feeds ("% of fields accepted as proposed") is pure equality:
 * comparing this hash to a hash of the final value answers it completely.
 * Storing the values themselves would put EGiB parcels, RCN comparables and
 * the geocoded address into event_log — the very data F-12 masks before it
 * reaches a document, and a hole straight through the allowlist.
 *
 * ponytail: hashes answer "changed?", not "changed by how much". Magnitude
 * would be a separate decision, with its own RODO justification.
 */
export function fingerprint(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    out[key] = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run tests/fingerprint.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Record at the three proposal sites**

`proposedFields` is the flat map the auto-fetch just produced, BEFORE the appraiser can touch it — for `saveSubjectAction` that is the `subject` object returned by `subjectData.fetchProposal`, for `saveSampleAction` the `{txN: pricePerM2}` map built from `comparables`, for `proposeProse` the `{section: text}` map from `proposal.sections`. Record it in the same action, right after the fetch resolves and before the value is written to `inputs`:

```ts
await eventLog.record({
  level: "info",
  event: "proposal.subject",
  traceId: currentTraceId(),
  valuationId: id,
  actorId: session.user.id,
  meta: { fields: fingerprint(proposedFields), count: Object.keys(proposedFields).length },
});
```

- [ ] **Step 6: Run the suite**

Run: `cd apps/web && pnpm vitest run && pnpm lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat(web): AI proposals leave a hashed fingerprint, never their values"
```

---

### Task 9: `pnpm trace` — the reader

**Files:**

- Create: `apps/web/scripts/trace.mts`, `apps/web/src/lib/trace-timeline.ts`
- Modify: `apps/web/package.json` (script `trace`)
- Test: `apps/web/tests/trace-timeline.test.ts`

**Interfaces:**

- Consumes: `EventRow` (Task 6)
- Produces: `function mergeTimeline(events: EventRow[], audits: AuditRow[]): TimelineEntry[]`, `function formatTimeline(entries: TimelineEntry[]): string`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/trace-timeline.test.ts
import { describe, expect, it } from "vitest";
import { formatTimeline, mergeTimeline } from "../src/lib/trace-timeline";

const t = (s: number) => new Date(Date.UTC(2026, 7, 19, 7, 0, s));

describe("trace timeline", () => {
  it("interleaves operational events with audit rows, oldest first", () => {
    const merged = mergeTimeline(
      [{ id: 1, at: t(2), level: "error", event: "confirmSample.failed" }] as never,
      [{ id: 1, at: t(1), action: "created", actorId: "u1" }] as never,
    );
    expect(merged.map((e) => e.label)).toEqual(["audit: created", "error: confirmSample.failed"]);
  });

  it("renders one line per entry with a timestamp", () => {
    const out = formatTimeline(
      mergeTimeline([{ id: 1, at: t(1), level: "info", event: "x" }] as never, []),
    );
    expect(out).toContain("07:00:01");
    expect(out.trim().split("\n")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/trace-timeline.test.ts`
Expected: FAIL — cannot resolve the module

- [ ] **Step 3: Implement the pure part**

Merging and formatting stay free of I/O so they are testable without a database; the script does the querying.

```ts
// apps/web/src/lib/trace-timeline.ts
export type TimelineEntry = { at: Date; label: string; detail?: string };

/** Shapes this module needs — structural, so it stays free of adapter imports (F-10). */
export type EventLike = { at: Date; level: string; event: string; meta?: unknown };
export type AuditLike = { at: Date; action: string; actorId: string };

/**
 * One run reads as one timeline. The two trails answer different questions —
 * `audit_log` says what the appraiser committed to, `event_log` says what
 * broke — and a failure is only legible next to the step it interrupted.
 */
export function mergeTimeline(events: EventLike[], audits: AuditLike[]): TimelineEntry[] {
  return [
    ...events.map((e) => ({
      at: e.at,
      label: `${e.level}: ${e.event}`,
      detail: e.meta ? JSON.stringify(e.meta) : undefined,
    })),
    ...audits.map((a) => ({ at: a.at, label: `audit: ${a.action}`, detail: a.actorId })),
  ].sort((x, y) => x.at.getTime() - y.at.getTime());
}

export function formatTimeline(entries: TimelineEntry[]): string {
  return (
    entries
      .map(
        (e) => `${e.at.toISOString().slice(11, 19)}  ${e.label}${e.detail ? `  ${e.detail}` : ""}`,
      )
      .join("\n") + "\n"
  );
}
```

- [ ] **Step 4: Implement the script**

```ts
// apps/web/scripts/trace.mts
// Usage: pnpm trace <traceId|valuationId>
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { formatTimeline, mergeTimeline } from "../src/lib/trace-timeline";

const id = process.argv[2];
if (!id) {
  process.stderr.write("usage: pnpm trace <traceId|valuationId>\n");
  process.exit(1);
}

// 8 hex chars is a traceId; anything else is treated as a valuation id.
const isTrace = /^[0-9a-f]{8}$/.test(id);

const events = await db
  .select()
  .from(schema.eventLog)
  .where(isTrace ? eq(schema.eventLog.traceId, id) : eq(schema.eventLog.valuationId, id))
  .orderBy(schema.eventLog.id);

// A traceId names one run; the audit rows worth showing are the ones for the
// valuation that run touched.
const valuationId = isTrace ? (events.find((e) => e.valuationId)?.valuationId ?? null) : id;

const audits = valuationId
  ? await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.valuationId, valuationId))
      .orderBy(schema.auditLog.id)
  : [];

process.stdout.write(
  formatTimeline(
    mergeTimeline(
      events.map((e) => ({ at: e.at, level: e.level, event: e.event, meta: e.meta })),
      audits.map((a) => ({ at: a.at, action: a.action, actorId: a.actorId })),
    ),
  ),
);
await pool.end();
```

- [ ] **Step 5: Add the package script**

```json
    "trace": "tsx scripts/trace.mts",
```

- [ ] **Step 6: Run tests + a live smoke against staging**

Run: `cd apps/web && pnpm vitest run tests/trace-timeline.test.ts && pnpm trace <known-valuation-id>`
Expected: PASS; the script prints a timeline

- [ ] **Step 7: Commit**

```bash
git add apps/web/src apps/web/scripts apps/web/tests apps/web/package.json
git commit -m "feat(web): pnpm trace reconstructs a run from both trails"
```

---

### Task 10: F-13 in CI; README; E2E on staging

**Files:**

- Modify: `.github/workflows/ci.yml`, `README.md`
- Test: `apps/web/tests/action-returns-code.test.ts`

- [ ] **Step 1: Write the failing test**

Asserted at the action layer, not through the browser: forcing a deterministic failure in Playwright would mean a second web server with an unreachable `WORKER_URL`, and the browser adds nothing the action does not already prove. The real UI is verified live in Step 5, which is where GOAL.md puts that bar anyway.

```ts
// apps/web/tests/action-returns-code.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth/session", () => ({
  getSession: async () => ({ user: { id: "u1", role: "appraiser" } }),
}));
vi.mock("@/app/valuations/_deps", () => ({
  valuationRepository: {
    confirmSample: async () => {
      throw new Error("worker unreachable");
    },
  },
  eventLog: { record: async () => {} },
}));

describe("a failing action", () => {
  it("hands the appraiser a code to read back", async () => {
    const { confirmSample } = await import("../src/app/actions/confirm-sample");
    const result = await confirmSample("11111111-1111-1111-1111-111111111111");
    expect(result?.error).toMatch(/\(kod: [0-9a-f]{8}\)$/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run tests/action-returns-code.test.ts`
Expected: FAIL — the message carries no code until Task 3's `errorWithCode` is wired into this action

- [ ] **Step 3: Wire F-13 into CI**

```yaml
- name: F-13 — no PII in logs (allowlist + no bare console)
  working-directory: apps/web
  run: pnpm vitest run tests/log.test.ts && pnpm lint
```

- [ ] **Step 4: Run the full local gate**

Run: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise && cd apps/worker && uv run ruff check . && uv run pytest -q`
Expected: all PASS

- [ ] **Step 5: Verify live on staging — the DoD from GOAL.md**

Deploy web; **push `worker-v2` manually**. Then: open a valuation → provoke a real failure → read the code from the UI → `pnpm trace <code>` → confirm the run appears with the worker's line carrying the same 8 chars.

- [ ] **Step 6: Commit**

```bash
git add .github README.md apps/web/tests
git commit -m "ci: F-13 guards the log allowlist"
```

---

## Deferred / carried forward

- **Migration sequencing vs `chore/migracje-automatyczne`** — recommendation (b): run the drift check only on pushes to `main`. Needs the user's decision before `0012` merges (spec §Zależność).
- **Retention** — `event_log` grows without bound. Not a staging concern; log it as a follow-up.
- **The "% as proposed" metric itself** — this plan lays the rail and collects the data; the metric is its own slice.
- **Checkpoint after the first real reports** — confirm the recorded events actually suffice for diagnosis.
