# ADR-012 — Gating as a synchronous process manager (no saga/bus)

> Canonical record (Polish, full detail): [`wiki/decisions/ADR-012-gating-synchronous-process-manager.md`](https://github.com/make-it-simple-rayshar/wyceny/blob/main/wiki/decisions/ADR-012-gating-synchronous-process-manager.md) in the wiki repo. This file is a developer-facing English summary — the wiki is canonical.

**Status:** active · **Date:** 2026-07-01

## Decision

The product's 7-step workflow (step N+1 only available once step N is approved, "AI proposes → appraiser confirms") is orchestrated by a **synchronous process manager**: the `Valuation` aggregate reads approval status and blocks a step transition when the previous step isn't approved, or when a required field is `to_verify`/`none` (see ADR-010). Gating is a domain **invariant on the aggregate**, not UI behavior — a step transition attempted directly via the API/server action must be blocked exactly like one attempted via the UI.

## Why

A single synchronous aggregate is the simplest, fully debuggable option for a workflow that is sequential and single-user per valuation (no concurrency requirement). A saga on an async event bus was rejected as over-engineering — nothing in the domain requires temporal decoupling or throughput beyond one appraiser working one valuation at a time. Gating implemented only as conditional UI rendering was rejected outright — it would let API/server-action calls bypass the legal-protection gate entirely.

## How it maps to this repo

Not yet implemented. The walking skeleton has a single-step `Valuation` lifecycle (`in_progress` → `signed`, no intermediate approval steps) — there is no 7-step gating flow, no per-step approval status, and no aggregate orchestrator yet. This ADR describes the target shape for when the real multi-step valuation workflow (comparable sample → features → calculation → document, each gated on the previous) lands.

## Current state vs. plan

Aspirational for this repo today. The closest existing piece is `assertNotSigned()` (ADR-011) — a single binary gate (signed vs. not), not the multi-step gating this ADR describes. Fitness function **F-4** (gate/gating invariant on the aggregate) has no code to test against yet.
