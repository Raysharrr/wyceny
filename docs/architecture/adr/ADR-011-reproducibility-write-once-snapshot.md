# ADR-011 — Reproducibility via write-once snapshot (no event sourcing)

> Canonical record (Polish, full detail): [`wiki/decisions/ADR-011-reprodukowalnosc-write-once-snapshot.md`](https://github.com/make-it-simple-rayshar/wyceny/blob/main/wiki/decisions/ADR-011-reprodukowalnosc-write-once-snapshot.md) in the wiki repo. This file is a developer-facing English summary — the wiki is canonical.

**Status:** active · **Date:** 2026-07-01

## Decision

Reproducibility (re-opening a valuation must reproduce the identical result), immutability after signing, and audit trail are all delivered with a **write-once snapshot**, not event sourcing:

- `SnapshotProby` (comparable-sample snapshot) freezes the **full calculation contract** — sourced transactions, scores, weights, scales, config version, query window — at calculation time. The engine reads only the frozen snapshot, never a live data source.
- Once a `Valuation` is signed, it is immutable; any later change produces a **new version** linking back via `supersedes`. The old version is never deleted.
- Audit trail is append-only.

## Why

This gives reproducibility and immutability guarantees proportional to a solo-dev, single-firm deployment without the operational cost of a full event-sourcing system (event store, projections, replay) — rejected as over-engineering for this scale. Mutable records with a change-log/trigger-based audit trail were rejected — they can't guarantee a re-run produces the same result and the audit trail is fragile.

## How it maps to this repo

- `apps/web/src/db/schema.ts` — `valuation.status` is `"in_progress" | "signed"`; `apps/web/src/domain/valuation.ts`'s `assertNotSigned()` is the write-once guard.
- Fitness function **F-7** (write-once/immutability, adversarial: editing a signed record must be rejected) is defined but currently **latent** — there is no mutation/edit code path yet in the walking skeleton, so there is nothing for F-7 to adversarially test against yet. The guard function exists and is unit-testable; the UI/action path that would call it (editing an existing valuation) hasn't been built.

## Current state vs. plan

The `SnapshotProby` concept (freezing the full comparable-sample calculation contract) does not exist yet — there is no comparable-sample/KCS-engine slice built. The `supersedes`-based versioning for signed valuations is designed but not implemented (no sign/re-open flow exists yet). What's proven today is the schema-level `status` enum and the pure `assertNotSigned()` invariant function that the future sign/edit flow will call.
