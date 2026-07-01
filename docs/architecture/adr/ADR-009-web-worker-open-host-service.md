# ADR-009 — web↔worker contract as an Open Host Service (HTTP/JSON)

> Canonical record (Polish, full detail): [`wiki/decisions/ADR-009-web-worker-open-host-service.md`](https://github.com/make-it-simple-rayshar/wyceny/blob/main/wiki/decisions/ADR-009-web-worker-open-host-service.md) in the wiki repo. This file is a developer-facing English summary — the wiki is canonical.

**Status:** active · **Date:** 2026-07-01

## Decision

The boundary between `apps/web` (Next.js/Vercel) and `apps/worker` (Python/FastAPI/Railway) is an **Open Host Service + Published Language**: a versioned HTTP/JSON contract, called from web through an **output port** (`PortWorker`), with the worker treated as a swappable adapter.

**Load-bearing invariant:** the worker does **I/O and presentation only** (geocoding, num2words, docx/PDF, OCR) and **never returns any valuation-result (WR) field**. All valuation arithmetic stays in the TS core. This is what fitness function **F-11** enforces.

## Why

This was the only option that simultaneously protected determinism (the worker cannot influence the calculation), allowed reuse of Python spike code without a rewrite, and kept the web↔worker boundary narrow and versioned enough to avoid a distributed monolith. A shared database between web and worker was rejected (hidden schema coupling breaks the modular-monolith rule). A message queue/event bus was rejected as unnecessary — request/response batch calls are synchronous and sufficient; nothing in the domain requires async.

## How it maps to this repo

- `apps/web/src/ports/worker.ts` — `PortWorker` interface: `amountInWords(amount): Promise<string>`. Pure, no imports.
- `apps/web/src/adapters/worker-http.ts` — HTTP adapter, `POST {WORKER_URL}/amount-in-words`, resolves to the words string only.
- `apps/worker/app/main.py` — FastAPI endpoint `POST /amount-in-words`, backed by `apps/worker/app/amount_in_words.py` (num2words-based). The docstring on that module states the F-11 invariant explicitly: it must never return the numeric value.
- `apps/web/tests/worker-contract.test.ts` and `apps/worker/tests/test_amount_in_words.py` are the F-11 contract tests, both run in CI.

## Current state vs. plan

Only one worker capability exists today: `/amount-in-words` (Polish "kwota słownie" formatting via `num2words`). The geocoding/EGiB/MPZP/RCN-WFS, OCR, and document-rendering (docx/PDF) adapters described in the plan are not yet built — those land with the real KCS engine and document-generation slices. The OHS pattern (versioned HTTP/JSON, worker-never-returns-WR) is already established and proven end-to-end for the one endpoint that exists.
