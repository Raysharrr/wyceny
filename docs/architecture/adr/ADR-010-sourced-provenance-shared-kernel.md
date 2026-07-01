# ADR-010 — `Sourced<T>` provenance as a tightly-scoped Shared Kernel

> Canonical record (Polish, full detail): [`wiki/decisions/ADR-010-sourced-provenance-shared-kernel.md`](https://github.com/make-it-simple-rayshar/wyceny/blob/main/wiki/decisions/ADR-010-sourced-provenance-shared-kernel.md) in the wiki repo. This file is a developer-facing English summary — the wiki is canonical.

**Status:** active · **Date:** 2026-07-01

## Decision

`Sourced<T> = { value: T, provenance: { source, status } }` lives in `packages/shared` as a **strictly scoped Shared Kernel** — it must never grow beyond provenance-wrapping. `status` (`confirmed | to_verify | none`) is assigned **only at the ACL boundary on the web side**; a worker or external data source can never claim `confirmed` for itself. The "no silent defaults" rule (every field with no data gets an explicit `to_verify`/`none`, never a made-up value) is a domain **invariant**, not UI behavior.

## Why

Wrapping the type structurally (rather than trusting UI convention) makes the "no silent defaults" legal-protection guarantee provable: a worker/adapter physically cannot inject `confirmed`. A per-bounded-context provenance type was rejected (duplication + semantic drift, no single enforceable gate). Rendering provenance only as a UI badge was rejected outright — that would let any API caller bypass the protection.

## How it maps to this repo

- `packages/shared/src/sourced.ts` — the type, `sourced()` constructor, and `isBlocking()` helper. Tested in `packages/shared/src/sourced.test.ts`.
- `packages/shared/src/index.ts` re-exports it — this is the one thing the two apps (`web`, `worker`) are meant to share.

## Current state vs. plan

`Sourced<T>` exists and is unit-tested, but is **not yet consumed** anywhere in the walking-skeleton flow — `Valuation` fields (`address`, `area`, `stubWr`, `amountInWords`) are plain values today, not `Sourced<T>`-wrapped, because the skeleton has no real data-provenance sources yet (no geocoder/EGiB/MPZP/RCN adapters). This is an accepted gap: the kernel is honestly present and ready, wiring it into the domain model is deferred to the slice that introduces real sourced fields (comparable-sample intake). The gate this type exists to protect — a required field being `to_verify`/`none` blocking step approval — is not yet implemented either (there is no multi-step gating/approval flow yet; see ADR-012).
