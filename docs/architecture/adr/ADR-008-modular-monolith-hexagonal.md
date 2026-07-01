# ADR-008 — Modular monolith with asymmetric Hexagonal (Ports & Adapters)

> Canonical record (Polish, full detail): [`wiki/decisions/ADR-008-modular-monolith-hexagonal.md`](https://github.com/make-it-simple-rayshar/wyceny/blob/main/wiki/decisions/ADR-008-modular-monolith-hexagonal.md) in the wiki repo. This file is a developer-facing English summary — the wiki is canonical.

**Status:** active · **Date:** 2026-07-01

## Decision

Organize the codebase as a **modular monolith with asymmetric Hexagonal (Ports & Adapters)**:

- **4 Core bounded contexts** get full port/adapter isolation: Valuation Lifecycle & Trust, Comparable Sample, Features & Weights, KCS Engine. The KCS engine in particular is a **pure domain service with zero output ports / zero I/O**.
- **8 Supporting contexts** get lightweight modular separation (no full port ceremony).
- **6 Generic contexts** (geo adapters, rendering, AI/LLM, auth, storage) sit behind thin Anti-Corruption Layers.
- **Global dependency rule**: `domain/` has **zero imports from infrastructure** — enforced mechanically, not by review (see F-10 below).

## Why

This was the only option that covered three high-impact quality attributes at once: **Maintainability** (swap a data source by swapping an adapter, no domain change), **Testability/determinism** (the golden WR test runs with zero network/DB), and **Security/compliance** (one enforcement point for encryption/access/masking in the Generic ACL layer). A classic layered architecture loses all three; microservices/event-sourcing/CQRS were rejected as over-engineering for a low-scale, solo-dev context (one law firm, no multi-tenant in MVP).

The asymmetry (full rigor only for Core, lighter elsewhere) is a deliberate trade-off to protect time-to-market — the team doesn't pay hexagonal boilerplate everywhere.

## How it maps to this repo

- `apps/web/src/domain/` — pure domain logic (currently `valuation.ts`). No imports from `adapters/`, `db/`, or framework packages.
- `apps/web/src/ports/` — pure TypeScript interfaces (`PortValuation`, `PortWorker`, `PortStorage`). No imports, no I/O.
- `apps/web/src/adapters/` — concrete implementations (`valuation-drizzle.ts`, `worker-http.ts`, `storage-pg.ts`, `storage-memory.ts`).
- `apps/web/src/app/valuations/_deps.ts` — the **only** place adapters are wired together and handed to route/action code (composition root).
- Fitness function **F-10** (`.dependency-cruiser.cjs`, CI-enforced) mechanically blocks `domain/` and `packages/shared` from importing adapters, the db client, or `drizzle-orm`/`pg`/`next`/`better-auth` directly.

## Current state vs. plan

The walking skeleton (Slice 0) has one Core context wired end-to-end (Valuation, as a stub) with the full ports/adapters/domain split in place and F-10 enforced in CI. The KCS engine itself is not yet built — `stubWr` in `create-valuation.ts` is a placeholder formula, not the real engine. The remaining Core/Supporting/Generic contexts from the master plan are not yet implemented; this ADR describes the target shape they will follow when built.
