# Sourced<T> Provenance E2E + Approval Gating (F-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every valuation input value carries persisted provenance (`source` + `status`), valuations gain a draft→approved lifecycle, and an approval gate (F-4, aggregate invariant) blocks approval while anything is `to_verify`/`none` or the sample has <12 transactions.

**Architecture:** The `Sourced<T>` kernel (`packages/shared`, ADR-010) gets tightened (closed source enum, no silent `confirmed` default) and wired into `apps/web` for the first time. Provenance is persisted "alongside" the existing snapshot shape (inline `status` on comparable rows + a compact `provenance` map for scalars) so legacy prod rows parse unchanged. The gate is a pure domain function (`approvalGate`) enforced in the domain lifecycle functions (`approveValuation`), re-run server-side by the approve action — never trusted from the client (ADR-012: invariant, not UI). Status is assigned exclusively at the web ACL (server actions); the worker is untouched.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), react-hook-form + zod v4, Drizzle ORM + Postgres, Vitest (real-Postgres integration tests, `fileParallelism: false`), Playwright (offline smoke), pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-07-14-sourced-provenance-gating-design.md` (approved 2026-07-14).

## Global Constraints

- Code, comments, commits: **English** (conventional commits; lefthook runs prettier + commitlint). UI copy: **Polish with full diacritics**.
- No network calls in tests/CI. F-11 (worker never returns WR) untouched. Worker code untouched.
- Per task: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push → `gh run watch --exit-status`.
- All app-repo work happens on `main` (unprotected), repo root `/Users/michalczekala/Development/wyceny-app`.
- `packages/shared` is a strictly bounded Shared Kernel (ADR-010) — Task 1 is the only task allowed to touch it; reviewer must treat any other shared change as a finding.
- `smoke.spec.ts` must be updated in the SAME task as any form change (established rule; Task 7 is the only task touching the form).
- Framework API usage (Next/RHF/zod/Drizzle): verify against context7/vercel skills when in doubt, not from memory.
- Existing statuses `in_progress`/`signed` map to UI as: `in_progress` = "Szkic" (draft), new `approved` = "Zatwierdzony", `signed` stays "Podpisany" (reserved for the F-7 slice).
- Deliberately skipped (log, don't do): `stub_wr`→`wr` column rename (needs interactive drizzle-kit prompt; rides along a future schema-reshaping migration), general draft editing, per-row confirm, DB-level immutability trigger (F-7 slice).

---

### Task 1: Tighten the shared kernel and wire it into apps/web

**Files:**

- Modify: `packages/shared/src/sourced.ts`
- Modify: `packages/shared/src/sourced.test.ts`
- Modify: `apps/web/package.json` (add dependency)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**

- Consumes: nothing (kernel is self-contained).
- Produces: `type ProvenanceSource = "geokoder" | "ewidencja" | "mpzp" | "odpis_kw" | "akt" | "rcn" | "ogledziny" | "rzeczoznawca"`; `type ProvenanceStatus = "confirmed" | "to_verify" | "none"`; `type Provenance = { source: ProvenanceSource; status: ProvenanceStatus }`; `type Sourced<T> = { value: T; provenance: Provenance }`; `sourced<T>(value: T, source: ProvenanceSource, status: ProvenanceStatus): Sourced<T>` (status now **required** — no silent default); `isBlocking(s: Sourced<unknown>): boolean`. Imported by later tasks as `import { ... } from "@wyceny/shared"`.

**Context:** ADR-010 defines the closed source enum; the current `source: string` and the `status = "confirmed"` default parameter are both violations of "no silent defaults". Nothing outside `packages/shared` uses these exports yet (verified by grep), so the breaking change is free. `apps/web` does not yet depend on `@wyceny/shared` — this task adds the workspace dependency so Tasks 2+ can import it. Turbo `test`/`typecheck`/`lint` all `dependsOn: ["^build"]`, so shared's `dist/` is built before web consumes it — no extra wiring needed.

- [ ] **Step 1: Update the kernel test to the new contract (RED)**

Replace the full contents of `packages/shared/src/sourced.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sourced, isBlocking } from "./sourced";

describe("sourced", () => {
  it("wraps a value with explicit provenance (status is required — no silent defaults, ADR-010)", () => {
    const s = sourced(71.63, "rzeczoznawca", "confirmed");
    expect(s.value).toBe(71.63);
    expect(s.provenance).toEqual({ source: "rzeczoznawca", status: "confirmed" });
  });

  it("isBlocking is true for to_verify/none, false for confirmed", () => {
    expect(isBlocking(sourced(0, "geokoder", "to_verify"))).toBe(true);
    expect(isBlocking(sourced(0, "rcn", "none"))).toBe(true);
    expect(isBlocking(sourced(1, "rzeczoznawca", "confirmed"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run shared tests to verify they fail**

Run: `pnpm --filter @wyceny/shared test`
Expected: FAIL — TypeScript/vitest errors: `"rzeczoznawca"` was fine before, but the first test now passes 3 args where the old signature allowed 2 with a default; the real failure appears in Step 4's typecheck if not now. If vitest passes (JS is lax), proceed — Step 3 makes the contract strict and Step 4 proves it.

- [ ] **Step 3: Tighten the kernel (GREEN)**

Replace the full contents of `packages/shared/src/sourced.ts`:

```ts
/**
 * Sourced<T> — the provenance Shared Kernel (ADR-010). Strictly bounded:
 * this file holds provenance types + two helpers and MUST NOT grow beyond
 * provenance. `status` is assigned only at the web-side ACL boundary; the
 * worker/source can never inject "confirmed".
 */
export type ProvenanceSource =
  "geokoder" | "ewidencja" | "mpzp" | "odpis_kw" | "akt" | "rcn" | "ogledziny" | "rzeczoznawca";

export type ProvenanceStatus = "confirmed" | "to_verify" | "none";

export type Provenance = { source: ProvenanceSource; status: ProvenanceStatus };

export type Sourced<T> = { value: T; provenance: Provenance };

// No default status — "no silent defaults" (AC-3) applies to the kernel itself.
export function sourced<T>(
  value: T,
  source: ProvenanceSource,
  status: ProvenanceStatus,
): Sourced<T> {
  return { value, provenance: { source, status } };
}

export function isBlocking(s: Sourced<unknown>): boolean {
  return s.provenance.status !== "confirmed";
}
```

- [ ] **Step 4: Run shared tests + typecheck to verify they pass**

Run: `pnpm --filter @wyceny/shared test && pnpm --filter @wyceny/shared typecheck && pnpm --filter @wyceny/shared build`
Expected: PASS (2 tests), clean typecheck, `dist/` emitted.

- [ ] **Step 5: Add the workspace dependency to apps/web**

In `apps/web/package.json`, add to `"dependencies"` (alphabetical position, right after `"@hookform/resolvers"`):

```json
    "@wyceny/shared": "workspace:*",
```

Run: `pnpm install`
Expected: lockfile updated, `apps/web/node_modules/@wyceny/shared` symlinked.

- [ ] **Step 6: Full verification**

Run: `cd /Users/michalczekala/Development/wyceny-app && pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: all green (web is unaffected yet — it only gained a dependency).

- [ ] **Step 7: Commit + push**

```bash
git add packages/shared/src/sourced.ts packages/shared/src/sourced.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(shared): closed provenance source enum, required status (ADR-010) + wire kernel into web"
git push && gh run watch --exit-status
```

---

### Task 2: Provenance snapshot types + approval gate (pure domain, F-4 unit tests)

**Files:**

- Create: `apps/web/src/domain/provenance.ts`
- Modify: `apps/web/src/domain/kcs.ts` (extend `Comparable` + `KcsInput` types only)
- Test: `apps/web/tests/f4-approval-gate.test.ts`

**Interfaces:**

- Consumes: `Provenance`, `ProvenanceStatus`, `sourced`, `isBlocking` from `@wyceny/shared` (Task 1).
- Produces (used by Tasks 3–7):
  - `REQUIRED_SAMPLE_SIZE = 12` (const)
  - `type InputsProvenance = { address: Provenance; area: Provenance; weights: Provenance; ratings: Provenance; geocode?: Provenance }`
  - `type Blocker = { path: string; label: string }`
  - `type GateResult = { ok: true } | { ok: false; blockers: Blocker[] }`
  - `approvalGate(input: GateInput): GateResult` where `GateInput = { comparables: Array<{ source?: "rcn" | "manual"; status?: ProvenanceStatus }>; sampleMeta?: unknown | null; provenance?: InputsProvenance | null }` — structurally compatible with `KcsInput`, so callers pass `KcsInput` directly.
  - `Comparable` gains `status?: ProvenanceStatus`; `KcsInput` gains `provenance?: InputsProvenance | null`.

**Context:** The gate is the F-4 invariant (ADR-012): default-deny — a missing status or missing provenance map is treated as `none`, i.e. blocking. `provenance.ts` must NOT import `kcs.ts` (avoids an import cycle: `kcs.ts` imports the `InputsProvenance` type from here). `computeKcs` ignores the new fields, same as it already ignores `source`/`transactionId`/`sampleMeta` (F-5 pattern). Blocker labels are Polish (they render in UI verbatim).

- [ ] **Step 1: Write the failing F-4 unit tests (RED)**

Create `apps/web/tests/f4-approval-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  approvalGate,
  REQUIRED_SAMPLE_SIZE,
  type InputsProvenance,
} from "../src/domain/provenance";

const confirmedScalars: InputsProvenance = {
  address: { source: "rzeczoznawca", status: "confirmed" },
  area: { source: "rzeczoznawca", status: "confirmed" },
  weights: { source: "rzeczoznawca", status: "confirmed" },
  ratings: { source: "rzeczoznawca", status: "confirmed" },
};

function manualRows(n: number) {
  return Array.from({ length: n }, () => ({
    source: "manual" as const,
    status: "confirmed" as const,
  }));
}

describe("F-4: approvalGate (aggregate invariant, default-deny)", () => {
  it("passes with >=12 confirmed rows and a fully confirmed scalar map (no sample fetch)", () => {
    const result = approvalGate({
      comparables: manualRows(12),
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result).toEqual({ ok: true });
  });

  it("blocks when any comparable is to_verify, naming the row", () => {
    const rows = manualRows(12);
    rows[2] = { source: "rcn" as never, status: "to_verify" as never };
    const result = approvalGate({
      comparables: rows,
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].path).toBe("comparables[2]");
      expect(result.blockers[0].label).toContain("do weryfikacji");
    }
  });

  it("blocks a comparable with MISSING status as none (default-deny)", () => {
    const rows: Array<{ source?: "rcn" | "manual"; status?: never }> = manualRows(11) as never;
    rows.push({ source: "manual" });
    const result = approvalGate({
      comparables: rows as never,
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers[0].path).toBe("comparables[11]");
      expect(result.blockers[0].label).toContain("brak prowenancji");
    }
  });

  it(`blocks below ${REQUIRED_SAMPLE_SIZE} transactions even when everything is confirmed`, () => {
    const result = approvalGate({
      comparables: manualRows(11),
      sampleMeta: null,
      provenance: confirmedScalars,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].path).toBe("comparables");
      expect(result.blockers[0].label).toContain("co najmniej 12");
    }
  });

  it("blocks when the scalar provenance map is missing entirely (default-deny: 4 blockers)", () => {
    const result = approvalGate({ comparables: manualRows(12), sampleMeta: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.map((b) => b.path)).toEqual([
        "provenance.address",
        "provenance.area",
        "provenance.weights",
        "provenance.ratings",
      ]);
    }
  });

  it("requires a confirmed geocode entry when sampleMeta is present", () => {
    const withMeta = { lat: 52.4, lon: 16.9 };
    const noGeocode = approvalGate({
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: confirmedScalars,
    });
    expect(noGeocode.ok).toBe(false);
    if (!noGeocode.ok) expect(noGeocode.blockers[0].path).toBe("provenance.geocode");

    const toVerifyGeocode = approvalGate({
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: { ...confirmedScalars, geocode: { source: "geokoder", status: "to_verify" } },
    });
    expect(toVerifyGeocode.ok).toBe(false);

    const confirmedGeocode = approvalGate({
      comparables: manualRows(12),
      sampleMeta: withMeta,
      provenance: { ...confirmedScalars, geocode: { source: "geokoder", status: "confirmed" } },
    });
    expect(confirmedGeocode).toEqual({ ok: true });
  });

  it("does NOT require geocode when there was no sample fetch (sampleMeta absent/null)", () => {
    expect(approvalGate({ comparables: manualRows(12), provenance: confirmedScalars })).toEqual({
      ok: true,
    });
  });

  it("collects ALL blockers at once (count + rows + scalars)", () => {
    const rows = manualRows(3);
    rows[0] = { source: "rcn" as never, status: "to_verify" as never };
    const result = approvalGate({ comparables: rows, sampleMeta: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 1 count blocker + 1 row blocker + 4 scalar blockers
      expect(result.blockers).toHaveLength(6);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- tests/f4-approval-gate.test.ts`
Expected: FAIL — `Cannot find module '../src/domain/provenance'`.

- [ ] **Step 3: Implement the gate (GREEN)**

Create `apps/web/src/domain/provenance.ts`:

```ts
import { isBlocking, sourced, type Provenance, type ProvenanceStatus } from "@wyceny/shared";

/**
 * F-4 approval gate — the aggregate invariant from ADR-010/ADR-012.
 * Default-deny: a value with missing provenance counts as `none` and blocks.
 * Pure, zero I/O (F-10). Blocker labels are Polish UI copy.
 */
export const REQUIRED_SAMPLE_SIZE = 12;

export type InputsProvenance = {
  address: Provenance;
  area: Provenance;
  weights: Provenance;
  ratings: Provenance;
  /** Present only when the draft was seeded by an RCN fetch (sampleMeta set). */
  geocode?: Provenance;
};

export type Blocker = { path: string; label: string };

export type GateResult = { ok: true } | { ok: false; blockers: Blocker[] };

/** Structurally compatible with KcsInput — callers pass the snapshot directly. */
export type GateInput = {
  comparables: Array<{ source?: "rcn" | "manual"; status?: ProvenanceStatus }>;
  sampleMeta?: unknown | null;
  provenance?: InputsProvenance | null;
};

const SCALAR_KEYS = ["address", "area", "weights", "ratings"] as const;

const SCALAR_LABEL: Record<(typeof SCALAR_KEYS)[number], string> = {
  address: "Adres",
  area: "Powierzchnia",
  weights: "Wagi cech",
  ratings: "Oceny cech",
};

function statusLabel(status: ProvenanceStatus): string {
  return status === "to_verify" ? "do weryfikacji" : "brak prowenancji";
}

export function approvalGate(input: GateInput): GateResult {
  const blockers: Blocker[] = [];

  if (input.comparables.length < REQUIRED_SAMPLE_SIZE) {
    blockers.push({
      path: "comparables",
      label: `Próba ma ${input.comparables.length} transakcji — wymagane co najmniej ${REQUIRED_SAMPLE_SIZE}.`,
    });
  }

  input.comparables.forEach((c, i) => {
    const source = c.source === "rcn" ? "rcn" : "rzeczoznawca";
    const status: ProvenanceStatus = c.status ?? "none";
    const s = sourced(c, source, status);
    if (isBlocking(s)) {
      blockers.push({
        path: `comparables[${i}]`,
        label: `Transakcja ${i + 1}${source === "rcn" ? " (RCN)" : ""} — ${statusLabel(status)}.`,
      });
    }
  });

  for (const key of SCALAR_KEYS) {
    const entry = input.provenance?.[key];
    const s = sourced(key, entry?.source ?? "rzeczoznawca", entry?.status ?? "none");
    if (isBlocking(s)) {
      blockers.push({
        path: `provenance.${key}`,
        label: `${SCALAR_LABEL[key]} — ${statusLabel(entry?.status ?? "none")}.`,
      });
    }
  }

  if (input.sampleMeta != null) {
    const geocode = input.provenance?.geocode;
    const s = sourced("geocode", geocode?.source ?? "geokoder", geocode?.status ?? "none");
    if (isBlocking(s)) {
      blockers.push({
        path: "provenance.geocode",
        label: `Geokodowanie adresu — ${statusLabel(geocode?.status ?? "none")}.`,
      });
    }
  }

  return blockers.length === 0 ? { ok: true } : { ok: false, blockers };
}
```

- [ ] **Step 4: Extend the snapshot types in `apps/web/src/domain/kcs.ts`**

In the `Comparable` type (currently ends with `transactionId?: string;`), add after `transactionId`:

```ts
  /**
   * Provenance status (F-4) — assigned ONLY at the web ACL on draft save
   * (rcn rows enter as "to_verify", manual as "confirmed"); flipped to
   * "confirmed" by the confirm-sample mutation. Optional so legacy
   * snapshots keep parsing. The engine ignores it (like source/transactionId).
   */
  status?: ProvenanceStatus;
```

In the `KcsInput` type, add after `sampleMeta`:

```ts
  /** Scalar provenance map (F-4) — see domain/provenance.ts. Optional: legacy snapshots lack it. */
  provenance?: InputsProvenance | null;
```

Add the imports at the top of `kcs.ts` (alongside the existing `SampleMeta` import):

```ts
import type { ProvenanceStatus } from "@wyceny/shared";
import type { InputsProvenance } from "./provenance";
```

- [ ] **Step 5: Run the F-4 tests to verify they pass**

Run: `pnpm --filter web test -- tests/f4-approval-gate.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Full verification**

Run: `cd /Users/michalczekala/Development/wyceny-app && pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: all green — depcruise confirms `domain/**` still imports no adapters/db/framework (`@wyceny/shared` is allowed).

- [ ] **Step 7: Commit + push**

```bash
git add apps/web/src/domain/provenance.ts apps/web/src/domain/kcs.ts apps/web/tests/f4-approval-gate.test.ts
git commit -m "feat(web): F-4 approval gate as pure domain invariant + provenance snapshot types"
git push && gh run watch --exit-status
```

---

### Task 3: Draft→approved lifecycle — schema, migration, port, domain functions

**Files:**

- Modify: `apps/web/src/db/schema.ts` (status enum + `approvedAt`)
- Create: `apps/web/drizzle/0007_valuation_approval.sql` (generated + hand-appended backfill)
- Modify: `apps/web/drizzle/meta/_journal.json` + new `meta/0007_snapshot.json` (generated)
- Modify: `apps/web/src/ports/valuation.ts`
- Modify: `apps/web/src/domain/valuation.ts`
- Test: `apps/web/tests/valuation-lifecycle.test.ts` (new, pure domain unit tests)

**Interfaces:**

- Consumes: `approvalGate`, `Blocker`, `InputsProvenance` from Task 2; existing `Valuation`/`NewValuationInput`/`PortValuation` shapes.
- Produces (used by Tasks 4–7):
  - `Valuation.status: "in_progress" | "approved" | "signed"`; `Valuation.approvedAt: Date | null`
  - `PortValuation` gains: `confirmSample(id: string, user: SessionUser): Promise<Valuation | null>` and `approve(id: string, user: SessionUser): Promise<Valuation | null>` (null = not found / not owner; domain errors thrown for status/gate violations)
  - `class ApprovalBlockedError extends Error { blockers: Blocker[] }` (in `domain/valuation.ts`)
  - `confirmSampleProvenance(v: Valuation): Valuation` (pure — flips rcn rows + geocode `to_verify`→`confirmed`; throws if not `in_progress` or `inputs` null)
  - `approveValuation(v: Valuation, now: Date): Valuation` (pure — throws `Error` if not `in_progress`, `ApprovalBlockedError` if gate fails; returns copy with `status: "approved"`, `approvedAt: now`)

**Context:** `status` is a TypeScript-level text enum (no Postgres enum type), so adding `"approved"` needs **no DDL** — only `approved_at` does. The backfill (`in_progress` → `approved`) converts pre-slice prod rows, which were complete saves under the old single-step model (spec §2); it is hand-appended to the generated migration, following the existing hand-written-SQL pattern (0003/0005). Backfill correctness on real data is verified live at deploy (S5), not in CI (CI migrates a fresh, empty DB).

- [ ] **Step 1: Write the failing domain lifecycle tests (RED)**

Create `apps/web/tests/valuation-lifecycle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ApprovalBlockedError,
  approveValuation,
  confirmSampleProvenance,
} from "../src/domain/valuation";
import type { Valuation } from "../src/ports/valuation";
import type { KcsInput } from "../src/domain/kcs";
import type { InputsProvenance } from "../src/domain/provenance";

const confirmedScalars: InputsProvenance = {
  address: { source: "rzeczoznawca", status: "confirmed" },
  area: { source: "rzeczoznawca", status: "confirmed" },
  weights: { source: "rzeczoznawca", status: "confirmed" },
  ratings: { source: "rzeczoznawca", status: "confirmed" },
};

function draftWith(inputs: KcsInput | null): Valuation {
  return {
    id: "v-1",
    address: "ul. Testowa 1, Poznań",
    area: 50,
    wr: 500_000,
    inputs,
    amountInWords: null,
    docUrl: null,
    ownerId: "owner-1",
    status: "in_progress",
    approvedAt: null,
    createdAt: new Date("2026-07-14T10:00:00Z"),
  };
}

function rcnInputs(): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i,
      source: "rcn" as const,
      transactionId: `tx-${i}`,
      status: "to_verify" as const,
    })),
    features: [{ name: "standard", weight: 1, rating: "przecietna" as const }],
    sampleMeta: {
      lat: 52.4,
      lon: 16.9,
      fetchedAt: "2026-07-14T09:00:00.000Z",
      source: "rcn-wfs-gugik",
      query: { bbox: [1, 2, 3, 4], count: 5000, sort: "dok_data D" },
    },
    provenance: { ...confirmedScalars, geocode: { source: "geokoder", status: "to_verify" } },
  };
}

describe("confirmSampleProvenance", () => {
  it("flips rcn rows and geocode to confirmed, leaves scalars untouched", () => {
    const v = confirmSampleProvenance(draftWith(rcnInputs()));
    expect(v.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
    expect(v.inputs!.provenance!.geocode).toEqual({ source: "geokoder", status: "confirmed" });
    expect(v.inputs!.provenance!.address.status).toBe("confirmed");
    expect(v.status).toBe("in_progress");
  });

  it("does not touch manual rows (already confirmed) and is idempotent", () => {
    const first = confirmSampleProvenance(draftWith(rcnInputs()));
    const second = confirmSampleProvenance(first);
    expect(second.inputs).toEqual(first.inputs);
  });

  it("throws when the valuation is not a draft", () => {
    const approved = { ...draftWith(rcnInputs()), status: "approved" as const };
    expect(() => confirmSampleProvenance(approved)).toThrow(/draft/i);
  });

  it("throws when there is no inputs snapshot", () => {
    expect(() => confirmSampleProvenance(draftWith(null))).toThrow(/inputs/i);
  });
});

describe("approveValuation", () => {
  const now = new Date("2026-07-14T12:00:00Z");

  it("blocks (ApprovalBlockedError with blockers) while anything is to_verify", () => {
    try {
      approveValuation(draftWith(rcnInputs()), now);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalBlockedError);
      expect((e as ApprovalBlockedError).blockers.length).toBeGreaterThan(0);
    }
  });

  it("approves after confirmation: status approved + approvedAt set", () => {
    const confirmed = confirmSampleProvenance(draftWith(rcnInputs()));
    const approved = approveValuation(confirmed, now);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe(now);
  });

  it("blocks a snapshot-less draft", () => {
    expect(() => approveValuation(draftWith(null), now)).toThrow(ApprovalBlockedError);
  });

  it("throws for non-draft status (write-once after approval)", () => {
    const approved = {
      ...confirmSampleProvenance(draftWith(rcnInputs())),
      status: "approved" as const,
    };
    expect(() => approveValuation(approved, now)).toThrow(/draft/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- tests/valuation-lifecycle.test.ts`
Expected: FAIL — `confirmSampleProvenance`/`approveValuation`/`ApprovalBlockedError` not exported; `approvedAt` missing on `Valuation`.

- [ ] **Step 3: Extend the DB schema**

In `apps/web/src/db/schema.ts`, in the `valuation` table change the `status` column and add `approvedAt` after it:

```ts
  status: text("status", { enum: ["in_progress", "approved", "signed"] })
    .notNull()
    .default("in_progress"),
  // Set exactly once by the approve mutation (F-4 gate passed). NULL = draft
  // or legacy signed-era row.
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
```

- [ ] **Step 4: Generate the migration and hand-append the backfill**

Run: `cd apps/web && pnpm exec drizzle-kit generate --name valuation_approval`
Expected: creates `apps/web/drizzle/0007_valuation_approval.sql` containing exactly:

```sql
ALTER TABLE "valuation" ADD COLUMN "approved_at" timestamp with time zone;
```

Append the backfill to that file (hand-written SQL, pattern of 0003/0005):

```sql
--> statement-breakpoint
-- Pre-slice rows were complete saves under the old single-step model —
-- they become 'approved' (spec 2026-07-14 §2); the F-4 gate applies only
-- to drafts created from now on.
UPDATE "valuation" SET "status" = 'approved' WHERE "status" = 'in_progress';
```

Verify it applies cleanly: `pnpm exec drizzle-kit migrate` (against local dev DB; CI re-proves on fresh Postgres).
Expected: migration applied without error.

- [ ] **Step 5: Extend the port**

In `apps/web/src/ports/valuation.ts`:

- In `Valuation`, change `status` and add `approvedAt`:

```ts
status: "in_progress" | "approved" | "signed";
approvedAt: Date | null;
```

- In `PortValuation`, add after `getByDocKey`:

```ts
  /**
   * Confirms sample provenance on a draft (rcn rows + geocode → confirmed).
   * Owner-only (admin included only if they own it). Returns null when the
   * valuation doesn't exist or the user isn't the owner; throws for
   * status violations (not a draft).
   */
  confirmSample(id: string, user: SessionUser): Promise<Valuation | null>;
  /**
   * Approves a draft — re-runs the F-4 gate server-side (never trusts the
   * client). Same null/throw contract as confirmSample; additionally throws
   * ApprovalBlockedError when the gate fails.
   */
  approve(id: string, user: SessionUser): Promise<Valuation | null>;
```

- [ ] **Step 6: Implement the pure domain functions (GREEN)**

In `apps/web/src/domain/valuation.ts` — update `newValuation` to include the new field and add the lifecycle functions + error class:

```ts
import { approvalGate, type Blocker } from "./provenance";
```

In `newValuation`'s returned object, add after `status: "in_progress"`:

```ts
    approvedAt: null,
```

Append at the end of the file:

```ts
export class ApprovalBlockedError extends Error {
  constructor(public readonly blockers: Blocker[]) {
    super(`Approval blocked by F-4 gate: ${blockers.map((b) => b.path).join(", ")}`);
    this.name = "ApprovalBlockedError";
  }
}

function assertDraft(v: Valuation): void {
  if (v.status !== "in_progress") {
    throw new Error(`Valuation ${v.id} is not a draft (status: ${v.status}) — mutation refused`);
  }
}

/**
 * The bulk-confirm mutation (spec §5): flips rcn comparables and the geocode
 * entry from to_verify to confirmed. The ONLY content mutation a draft
 * allows besides approval. Pure — the adapter persists the result.
 */
export function confirmSampleProvenance(v: Valuation): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to confirm`);
  }
  const comparables = v.inputs.comparables.map((c) =>
    c.source === "rcn" && c.status === "to_verify" ? { ...c, status: "confirmed" as const } : c,
  );
  const provenance = v.inputs.provenance?.geocode
    ? {
        ...v.inputs.provenance,
        geocode: { ...v.inputs.provenance.geocode, status: "confirmed" as const },
      }
    : v.inputs.provenance;
  return { ...v, inputs: { ...v.inputs, comparables, provenance } };
}

/**
 * The approve mutation — F-4 gate as aggregate invariant (ADR-012). A draft
 * without a snapshot can never pass (default-deny).
 */
export function approveValuation(v: Valuation, now: Date): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new ApprovalBlockedError([{ path: "inputs", label: "Brak danych wejściowych operatu." }]);
  }
  const gate = approvalGate(v.inputs);
  if (!gate.ok) {
    throw new ApprovalBlockedError(gate.blockers);
  }
  return { ...v, status: "approved", approvedAt: now };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter web test -- tests/valuation-lifecycle.test.ts`
Expected: PASS (8 tests). Note: `apps/web/tests/valuation-repo.test.ts` and the F-8 test still pass — `NewValuationInput` is unchanged; the two new port methods break the port's implementors only when TypeScript checks the adapter, which Task 4 fixes. If typecheck fails on `valuation-drizzle.ts` not implementing the new methods, that is EXPECTED here — add the two methods as stubs throwing `new Error("implemented in Task 4")` ONLY IF the full-suite gate below requires green typecheck; otherwise proceed to Task 4 in the same session. Prefer the stub so this task's verification chain is green.

Add to `apps/web/src/adapters/valuation-drizzle.ts` (inside the returned object, after `getByDocKey` — temporary, replaced in Task 4):

```ts
    async confirmSample(): Promise<Valuation | null> {
      throw new Error("confirmSample: implemented in the next task");
    },

    async approve(): Promise<Valuation | null> {
      throw new Error("approve: implemented in the next task");
    },
```

- [ ] **Step 8: Full verification**

Run: `cd /Users/michalczekala/Development/wyceny-app && pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: all green.

- [ ] **Step 9: Commit + push**

```bash
git add apps/web/src/db/schema.ts apps/web/drizzle apps/web/src/ports/valuation.ts apps/web/src/domain/valuation.ts apps/web/src/adapters/valuation-drizzle.ts apps/web/tests/valuation-lifecycle.test.ts
git commit -m "feat(web): draft->approved lifecycle — approved status, approved_at migration + backfill, pure lifecycle domain fns"
git push && gh run watch --exit-status
```

---

### Task 4: Adapter mutations + F-5 provenance roundtrip extension (real Postgres)

**Files:**

- Modify: `apps/web/src/adapters/valuation-drizzle.ts` (replace Task 3 stubs with real implementations)
- Modify: `apps/web/tests/valuation-repo.test.ts` (add mutation integration tests)
- Modify: `apps/web/tests/kcs-reproducibility.test.ts` (extend F-5)

**Interfaces:**

- Consumes: `confirmSampleProvenance`, `approveValuation`, `ApprovalBlockedError` (Task 3); `PortValuation.confirmSample/approve` signatures (Task 3).
- Produces: working `valuationRepo(db).confirmSample(id, user)` / `.approve(id, user)` used by Task 6's server actions.

**Context:** Writes follow the existing `create` path — superuser pool connection, ownership enforced app-level (RLS covers reads/F-8; `app_role` has SELECT-only GRANT and that stays unchanged). Owner-only means `row.ownerId === user.id` — an admin who doesn't own the row gets `null`, same as a stranger (spec §5: "tylko właściciel"). `Date` is injected at the adapter boundary (`new Date()`) so domain stays pure.

- [ ] **Step 1: Write the failing integration tests (RED)**

In `apps/web/tests/valuation-repo.test.ts`, add imports at the top (merging with existing ones):

```ts
import { ApprovalBlockedError } from "../src/domain/valuation";
import type { KcsInput } from "../src/domain/kcs";
```

Add a helper next to the existing `valuationInput()` helper:

```ts
function approvableInputs(): KcsInput {
  return {
    area: 50,
    comparables: Array.from({ length: 12 }, (_, i) => ({
      pricePerM2: 10_000 + i,
      source: "rcn" as const,
      transactionId: `tx-${i}`,
      status: "to_verify" as const,
    })),
    features: [{ name: "standard", weight: 1, rating: "przecietna" as const }],
    sampleMeta: {
      lat: 52.4,
      lon: 16.9,
      fetchedAt: "2026-07-14T09:00:00.000Z",
      source: "rcn-wfs-gugik",
      query: { bbox: [1, 2, 3, 4], count: 5000, sort: "dok_data D" },
    },
    provenance: {
      address: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      area: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      weights: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      ratings: { source: "rzeczoznawca" as const, status: "confirmed" as const },
      geocode: { source: "geokoder" as const, status: "to_verify" as const },
    },
  };
}
```

Append a new describe block (adjust user variable names to the file's existing `appraiserA`/`appraiserB`/`admin`):

```ts
describe("F-4: confirmSample + approve mutations (draft lifecycle)", () => {
  it("confirmSample flips rcn rows + geocode to confirmed and persists", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 1"),
      inputs: approvableInputs(),
    });
    const confirmed = await repo.confirmSample(created.id, appraiserA);
    expect(confirmed).not.toBeNull();
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.inputs!.comparables.every((c) => c.status === "confirmed")).toBe(true);
    expect(reread!.inputs!.provenance!.geocode!.status).toBe("confirmed");
  });

  it("confirmSample is owner-only: another appraiser AND a non-owner admin get null", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 2"),
      inputs: approvableInputs(),
    });
    expect(await repo.confirmSample(created.id, appraiserB)).toBeNull();
    expect(await repo.confirmSample(created.id, admin)).toBeNull();
  });

  it("approve rejects an unconfirmed draft with ApprovalBlockedError (server-side gate — API bypass impossible)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 3"),
      inputs: approvableInputs(),
    });
    await expect(repo.approve(created.id, appraiserA)).rejects.toThrow(ApprovalBlockedError);
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.status).toBe("in_progress");
    expect(reread!.approvedAt).toBeNull();
  });

  it("approve succeeds after confirmSample: status approved + approvedAt persisted", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 4"),
      inputs: approvableInputs(),
    });
    await repo.confirmSample(created.id, appraiserA);
    const approved = await repo.approve(created.id, appraiserA);
    expect(approved!.status).toBe("approved");
    expect(approved!.approvedAt).toBeInstanceOf(Date);
    const reread = await repo.get(created.id, appraiserA);
    expect(reread!.status).toBe("approved");
    expect(reread!.approvedAt).toBeInstanceOf(Date);
  });

  it("an approved valuation refuses further mutations (write-once at approval)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 5"),
      inputs: approvableInputs(),
    });
    await repo.confirmSample(created.id, appraiserA);
    await repo.approve(created.id, appraiserA);
    await expect(repo.confirmSample(created.id, appraiserA)).rejects.toThrow(/not a draft/i);
    await expect(repo.approve(created.id, appraiserA)).rejects.toThrow(/not a draft/i);
  });

  it("approve blocks below 12 transactions even when all rows are confirmed", async () => {
    const inputs = approvableInputs();
    inputs.comparables = inputs.comparables.slice(0, 11).map((c) => ({
      ...c,
      status: "confirmed" as const,
    }));
    inputs.provenance = {
      ...inputs.provenance!,
      geocode: { source: "geokoder", status: "confirmed" },
    };
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Gating 6"),
      inputs,
    });
    await expect(repo.approve(created.id, appraiserA)).rejects.toThrow(ApprovalBlockedError);
  });
});
```

In `apps/web/tests/kcs-reproducibility.test.ts`, extend the F-5 describe with one new test (after the existing roundtrip `it`), reusing the file's existing `fixture`, `repo`, `owner`, `adminUser`:

```ts
it("F-5: inline row status + scalar provenance map round-trip through the inputs jsonb", async () => {
  const comparables = fixture.input.comparables.map((c, i) => ({
    ...c,
    source: "rcn" as const,
    transactionId: `koscielna-prov-${i}`,
    status: "to_verify" as const,
  }));
  const provenance = {
    address: { source: "rzeczoznawca" as const, status: "confirmed" as const },
    area: { source: "rzeczoznawca" as const, status: "confirmed" as const },
    weights: { source: "rzeczoznawca" as const, status: "confirmed" as const },
    ratings: { source: "rzeczoznawca" as const, status: "confirmed" as const },
    geocode: { source: "geokoder" as const, status: "to_verify" as const },
  };
  const input: KcsInput = { ...fixture.input, comparables, provenance };

  const created = await repo.create({
    address: "ul. Kościelna 33A, Poznań",
    area: input.area,
    wr: computeKcs(input).wr,
    inputs: input,
    amountInWords: null,
    docUrl: null,
    ownerId: owner.id,
  });
  const fetched = await repo.get(created.id, adminUser);
  expect(fetched!.inputs!.comparables.every((c) => c.status === "to_verify")).toBe(true);
  expect(fetched!.inputs!.provenance).toEqual(provenance);
  // Provenance never changes the number: WR identical with and without it.
  expect(computeKcs(fetched!.inputs!).wr).toBe(computeKcs(fixture.input).wr);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- tests/valuation-repo.test.ts tests/kcs-reproducibility.test.ts`
Expected: F-5 extension PASSES already (jsonb is schemaless — that's fine, it locks the contract); the new F-4 describe FAILS on the Task 3 stubs ("implemented in the next task").

- [ ] **Step 3: Implement the adapter mutations (GREEN)**

In `apps/web/src/adapters/valuation-drizzle.ts`, add imports:

```ts
import { approveValuation, confirmSampleProvenance, newValuation } from "@/domain/valuation";
```

(keep the existing `newValuation` import if already present — merge, don't duplicate). Replace the two Task 3 stubs with:

```ts
    // Both mutations run on the superuser pool connection, same trust path
    // as create (app_role/RLS stays read-only, F-8 unchanged); ownership is
    // enforced app-level below. ponytail: load→domain→update without a row
    // lock — single-user-per-valuation flow (ADR-012, Scalability=L); add
    // SELECT ... FOR UPDATE if concurrent editing ever arrives.
    async confirmSample(id: string, user: SessionUser): Promise<Valuation | null> {
      const [row] = await db.select().from(schema.valuation).where(eq(schema.valuation.id, id));
      if (!row) return null;
      const valuation = toValuation(row);
      if (valuation.ownerId !== user.id) return null;
      const updated = confirmSampleProvenance(valuation);
      const [saved] = await db
        .update(schema.valuation)
        .set({ inputs: updated.inputs })
        .where(eq(schema.valuation.id, id))
        .returning();
      return toValuation(saved);
    },

    async approve(id: string, user: SessionUser): Promise<Valuation | null> {
      const [row] = await db.select().from(schema.valuation).where(eq(schema.valuation.id, id));
      if (!row) return null;
      const valuation = toValuation(row);
      if (valuation.ownerId !== user.id) return null;
      const updated = approveValuation(valuation, new Date());
      const [saved] = await db
        .update(schema.valuation)
        .set({ status: updated.status, approvedAt: updated.approvedAt })
        .where(eq(schema.valuation.id, id))
        .returning();
      return toValuation(saved);
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- tests/valuation-repo.test.ts tests/kcs-reproducibility.test.ts`
Expected: PASS (all, including the 6 new F-4 integration tests and the F-5 extension).

- [ ] **Step 5: Full verification**

Run: `cd /Users/michalczekala/Development/wyceny-app && pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: all green.

- [ ] **Step 6: Commit + push**

```bash
git add apps/web/src/adapters/valuation-drizzle.ts apps/web/tests/valuation-repo.test.ts apps/web/tests/kcs-reproducibility.test.ts
git commit -m "feat(web): confirmSample/approve repo mutations with server-side F-4 gate + F-5 provenance roundtrip"
git push && gh run watch --exit-status
```

---

### Task 5: ACL provenance assignment on draft save

**Files:**

- Create: `apps/web/src/lib/assign-provenance.ts`
- Modify: `apps/web/src/app/actions/create-valuation.ts`
- Test: `apps/web/tests/assign-provenance.test.ts`

**Interfaces:**

- Consumes: `ValuationFormValues` (existing), `InputsProvenance` (Task 2), `Comparable` from `domain/kcs.ts` (Task 2).
- Produces: `assignProvenance(values: Pick<ValuationFormValues, "comparables" | "sampleMeta">): { comparables: Comparable[]; provenance: InputsProvenance }` — consumed by `create-valuation.ts` in this task.

**Context:** This is THE ACL of ADR-010 — the only place statuses are born. It runs server-side after zod validation and derives statuses purely from the trusted `source` tag (`"rcn"` rows → `to_verify`; everything else → `confirmed`/`rzeczoznawca`). Any `status` a tampered client might send is irrelevant: the form schema has no `status` field and zod v4 strips unknown object keys by default, and this helper overwrites the field unconditionally anyway.

- [ ] **Step 1: Write the failing tests (RED)**

Create `apps/web/tests/assign-provenance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assignProvenance } from "../src/lib/assign-provenance";

const sampleMeta = {
  lat: 52.4,
  lon: 16.9,
  fetchedAt: "2026-07-14T09:00:00.000Z",
  source: "rcn-wfs-gugik",
  query: { bbox: [1, 2, 3, 4], count: 5000, sort: "dok_data D" },
};

describe("assignProvenance (the ADR-010 ACL — statuses are born here, server-side only)", () => {
  it("rcn rows enter as to_verify, manual rows as confirmed/rzeczoznawca", () => {
    const { comparables } = assignProvenance({
      comparables: [
        { pricePerM2: 10_000, source: "rcn", transactionId: "tx-1" },
        { pricePerM2: 11_000, source: "manual" },
        { pricePerM2: 12_000 }, // no source tag = manual entry
      ],
      sampleMeta,
    });
    expect(comparables[0].status).toBe("to_verify");
    expect(comparables[1].status).toBe("confirmed");
    expect(comparables[2].status).toBe("confirmed");
    expect(comparables[2].source).toBe("manual");
  });

  it("overrides any client-claimed status (tampering is ignored)", () => {
    const { comparables } = assignProvenance({
      comparables: [
        { pricePerM2: 10_000, source: "rcn", transactionId: "tx-1", status: "confirmed" } as never,
      ],
      sampleMeta,
    });
    expect(comparables[0].status).toBe("to_verify");
  });

  it("scalars are rzeczoznawca/confirmed; geocode present+to_verify only with sampleMeta", () => {
    const withFetch = assignProvenance({ comparables: [], sampleMeta });
    expect(withFetch.provenance.address).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.area).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.weights).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.ratings).toEqual({ source: "rzeczoznawca", status: "confirmed" });
    expect(withFetch.provenance.geocode).toEqual({ source: "geokoder", status: "to_verify" });

    const manualOnly = assignProvenance({ comparables: [], sampleMeta: undefined });
    expect(manualOnly.provenance.geocode).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- tests/assign-provenance.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/assign-provenance'`.

- [ ] **Step 3: Implement the ACL helper (GREEN)**

Create `apps/web/src/lib/assign-provenance.ts`:

```ts
import type { Comparable } from "@/domain/kcs";
import type { InputsProvenance } from "@/domain/provenance";
import type { ValuationFormValues } from "@/lib/valuation-form-schema";

/**
 * The ADR-010 ACL: provenance statuses are assigned HERE, server-side,
 * derived from the trusted source tag — never accepted from the client
 * and never from the worker. rcn rows enter to_verify (the appraiser must
 * bulk-confirm them on the detail page); manual entry by the appraiser is
 * confirmed by definition (AI-first: humans only confirm what they didn't
 * type themselves).
 */
export function assignProvenance(values: Pick<ValuationFormValues, "comparables" | "sampleMeta">): {
  comparables: Comparable[];
  provenance: InputsProvenance;
} {
  const comparables: Comparable[] = values.comparables.map((c) => ({
    ...c,
    source: c.source ?? "manual",
    status: c.source === "rcn" ? "to_verify" : "confirmed",
  }));

  const confirmed = { source: "rzeczoznawca", status: "confirmed" } as const;
  const provenance: InputsProvenance = {
    address: confirmed,
    area: confirmed,
    weights: confirmed,
    ratings: confirmed,
    ...(values.sampleMeta ? { geocode: { source: "geokoder", status: "to_verify" } as const } : {}),
  };

  return { comparables, provenance };
}
```

- [ ] **Step 4: Wire it into the create action**

In `apps/web/src/app/actions/create-valuation.ts`:

Add the import:

```ts
import { assignProvenance } from "@/lib/assign-provenance";
```

Replace the `kcsInput` construction (currently `comparables,` and no `provenance`) with:

```ts
const { comparables: sourcedComparables, provenance } = assignProvenance(parsed.data);
const kcsInput: KcsInput = {
  area,
  comparables: sourcedComparables,
  features: features.map((f) => ({ name: f.name, weight: f.weightPct / 100, rating: f.rating })),
  sampleMeta: sampleMeta ?? null,
  provenance,
};
```

(The destructured `comparables` from `parsed.data` becomes unused — remove it from the destructuring line.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test -- tests/assign-provenance.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full verification**

Run: `cd /Users/michalczekala/Development/wyceny-app && pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: all green (the smoke e2e is untouched — the form itself didn't change; drafts now persist provenance).

- [ ] **Step 7: Commit + push**

```bash
git add apps/web/src/lib/assign-provenance.ts apps/web/src/app/actions/create-valuation.ts apps/web/tests/assign-provenance.test.ts
git commit -m "feat(web): assign provenance at the ACL on draft save (rcn=to_verify, manual=confirmed)"
git push && gh run watch --exit-status
```

---

### Task 6: Detail page — provenance display, confirm + approve actions and UI

**Files:**

- Create: `apps/web/src/app/actions/confirm-sample.ts`
- Create: `apps/web/src/app/actions/approve-valuation.ts`
- Create: `apps/web/src/app/valuations/[id]/valuation-actions.tsx` (client component)
- Modify: `apps/web/src/app/valuations/[id]/page.tsx`

**Interfaces:**

- Consumes: `valuationRepository.confirmSample/approve` (Task 4), `approvalGate`/`GateResult` (Task 2), `ApprovalBlockedError` (Task 3), shadcn `Badge`/`Button`/`Card` primitives.
- Produces: server actions `confirmSample(id: string): Promise<{ error: string } | undefined>` and `approveValuation(id: string): Promise<{ error: string } | undefined>`; the detail page renders `data-testid`s consumed by Task 7's e2e: `valuation-status`, `gate-blockers`, `confirm-sample-button`, `approve-button`.

**Context:** The page is an RSC — it computes the gate result server-side and renders the blockers list; the buttons live in a small client component that calls the server actions inside `useTransition` (the action's `revalidatePath` refreshes the RSC). Legacy rows (backfilled `approved`, snapshot without provenance) render exactly as today — badges only appear when provenance data exists. UI copy Polish with diacritics. This task does NOT touch the form, so `smoke.spec.ts` stays as-is until Task 7 (which adapts it to the new statuses/buttons in the same task as the form change) — expect the CI `e2e` job to stay green because the current smoke path only asserts WR visibility on the detail page, which this task must not break.

- [ ] **Step 1: Create the confirm action**

Create `apps/web/src/app/actions/confirm-sample.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";

export type ConfirmSampleResult = { error: string } | undefined;

/**
 * Bulk-confirm (spec §5): flips the draft's rcn rows + geocode to confirmed.
 * Owner-only; the repo returns null for not-found/not-owner and throws for
 * non-draft status.
 */
export async function confirmSample(id: string): Promise<ConfirmSampleResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const updated = await valuationRepository.confirmSample(id, session.user);
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("confirmSample failed", error);
    return { error: "Nie udało się potwierdzić próby — spróbuj ponownie." };
  }

  revalidatePath(`/valuations/${id}`);
}
```

- [ ] **Step 2: Create the approve action**

Create `apps/web/src/app/actions/approve-valuation.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { ApprovalBlockedError } from "@/domain/valuation";

export type ApproveValuationResult = { error: string } | undefined;

/**
 * Approve (spec §5): re-runs the F-4 gate SERVER-SIDE inside the repo/domain
 * (ADR-012 — invariant, not UI). A client that enables the button via
 * devtools still bounces here.
 */
export async function approveValuation(id: string): Promise<ApproveValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const updated = await valuationRepository.approve(id, session.user);
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    if (error instanceof ApprovalBlockedError) {
      return {
        error: `Zatwierdzenie zablokowane — ${error.blockers[0]?.label ?? "operat zawiera niezweryfikowane wartości."}`,
      };
    }
    console.error("approveValuation failed", error);
    return { error: "Nie udało się zatwierdzić operatu — spróbuj ponownie." };
  }

  revalidatePath(`/valuations/${id}`);
  revalidatePath("/valuations");
}
```

- [ ] **Step 3: Create the client actions component**

Create `apps/web/src/app/valuations/[id]/valuation-actions.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmSample } from "@/app/actions/confirm-sample";
import { approveValuation } from "@/app/actions/approve-valuation";

/**
 * Draft-only action bar. `gateOk`/`hasToVerify` are computed server-side by
 * the RSC (approvalGate) — the disabled state is UX sugar; the actions
 * re-check everything server-side (F-4 is an invariant, not UI).
 */
export function ValuationActions({
  id,
  hasToVerify,
  gateOk,
}: {
  id: string;
  hasToVerify: boolean;
  gateOk: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: (id: string) => Promise<{ error: string } | undefined>) => {
    setError(null);
    startTransition(async () => {
      const result = await action(id);
      if (result?.error) {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {hasToVerify ? (
          <Button
            type="button"
            variant="outline"
            data-testid="confirm-sample-button"
            disabled={isPending}
            onClick={() => run(confirmSample)}
          >
            {isPending ? "Potwierdzanie…" : "Potwierdź próbę z RCN"}
          </Button>
        ) : null}
        <Button
          type="button"
          data-testid="approve-button"
          disabled={isPending || !gateOk}
          onClick={() => run(approveValuation)}
        >
          {isPending ? "Zatwierdzanie…" : "Zatwierdź operat"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Extend the detail page (RSC)**

In `apps/web/src/app/valuations/[id]/page.tsx`:

Update the status label map (top of file):

```ts
const STATUS_LABEL: Record<string, string> = {
  in_progress: "Szkic",
  approved: "Zatwierdzony",
  signed: "Podpisany",
};
```

Add imports:

```ts
import { approvalGate } from "@/domain/provenance";
import { ValuationActions } from "./valuation-actions";
```

Add a provenance badge helper + comparables section component (place next to `KcsBreakdown`):

```tsx
function ProvenanceBadge({ source, status }: { source?: string; status?: string }) {
  if (source === "rcn" && status === "to_verify") {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-500">
        RCN — do weryfikacji
      </Badge>
    );
  }
  if (source === "rcn") {
    return <Badge variant="secondary">RCN — potwierdzone</Badge>;
  }
  if (status) {
    return <Badge variant="secondary">Rzeczoznawca</Badge>;
  }
  return null; // legacy snapshot without provenance — render as before
}

function ComparablesProvenance({ inputs }: { inputs: KcsInput }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <h2 className="text-sm font-medium text-foreground">
          Próba ({inputs.comparables.length} transakcji)
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-normal">#</th>
              <th className="py-1 font-normal">Cena zł/m²</th>
              <th className="py-1 font-normal">Pochodzenie</th>
            </tr>
          </thead>
          <tbody>
            {inputs.comparables.map((c, i) => (
              <tr key={c.transactionId ?? i} className="border-t border-border">
                <td className="py-1">{i + 1}</td>
                <td className="py-1 tabular-nums">{plnPerM2.format(c.pricePerM2)}</td>
                <td className="py-1">
                  <ProvenanceBadge source={c.source} status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {inputs.provenance ? (
          <p className="text-xs text-muted-foreground">
            Adres, powierzchnia, wagi i oceny: rzeczoznawca (potwierdzone)
            {inputs.provenance.geocode
              ? ` · geokodowanie: ${
                  inputs.provenance.geocode.status === "confirmed"
                    ? "potwierdzone"
                    : "do weryfikacji"
                }`
              : ""}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

In the main RSC body, after loading `valuation`, compute the gate for drafts:

```ts
const isDraft = valuation.status === "in_progress";
const gate = isDraft && valuation.inputs ? approvalGate(valuation.inputs) : null;
const hasToVerify =
  isDraft && valuation.inputs
    ? valuation.inputs.comparables.some((c) => c.status === "to_verify") ||
      valuation.inputs.provenance?.geocode?.status === "to_verify"
    : false;
```

Add `data-testid="valuation-status"` to the existing status `Badge` and make `approved` use the `default` variant:

```tsx
<Badge
  data-testid="valuation-status"
  variant={valuation.status === "in_progress" ? "secondary" : "default"}
>
  {STATUS_LABEL[valuation.status] ?? valuation.status}
</Badge>
```

After the `KcsBreakdown` block (`{valuation.inputs ? <KcsBreakdown .../> : null}`), add:

```tsx
{
  valuation.inputs ? <ComparablesProvenance inputs={valuation.inputs} /> : null;
}

{
  isDraft ? (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        {gate && !gate.ok ? (
          <div data-testid="gate-blockers" className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              Zatwierdzenie zablokowane — do wyjaśnienia:
            </p>
            <ul className="list-disc pl-5 text-sm text-amber-600 dark:text-amber-500">
              {gate.blockers.map((b) => (
                <li key={b.path}>{b.label}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <ValuationActions id={valuation.id} hasToVerify={hasToVerify} gateOk={gate?.ok === true} />
      </CardContent>
    </Card>
  ) : null;
}

{
  valuation.status === "approved" && valuation.approvedAt ? (
    <p className="text-sm text-muted-foreground">
      Zatwierdzono:{" "}
      {new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short" }).format(
        valuation.approvedAt,
      )}
    </p>
  ) : null;
}
```

- [ ] **Step 5: Manual render check**

Run: `pnpm --filter web build`
Expected: build succeeds (RSC + client component compile). No new unit tests here — the logic lives in domain/adapter layers already covered by Tasks 2–4; this task is composition. The e2e in Task 7 exercises the full path.

- [ ] **Step 6: Full verification**

Run: `cd /Users/michalczekala/Development/wyceny-app && pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: all green (depcruise: page/actions import adapters only via `_deps` — unchanged pattern; `valuation-actions.tsx` imports only actions + ui).

- [ ] **Step 7: Commit + push**

```bash
git add apps/web/src/app/actions/confirm-sample.ts apps/web/src/app/actions/approve-valuation.ts "apps/web/src/app/valuations/[id]/valuation-actions.tsx" "apps/web/src/app/valuations/[id]/page.tsx"
git commit -m "feat(web): detail page provenance badges, bulk confirm + approve with visible F-4 blockers"
git push && gh run watch --exit-status
```

---

### Task 7: Form copy ("Zapisz szkic"), list status labels, smoke e2e for both gate paths

**Files:**

- Modify: `apps/web/src/app/valuations/new/new-valuation-form.tsx` (button label + amber copy)
- Modify: `apps/web/src/app/valuations/page.tsx` (STATUS_LABEL)
- Modify: `apps/web/e2e/smoke.spec.ts` (same task as the form change — hard rule)

**Interfaces:**

- Consumes: `REQUIRED_SAMPLE_SIZE` (Task 2), detail-page `data-testid`s (Task 6): `valuation-status`, `gate-blockers`, `approve-button`.
- Produces: final UI copy; the two-path offline smoke suite that CI's `e2e` job runs.

**Context:** The RCN fetch can't run offline, so e2e covers the manual paths: (1) a 3-transaction draft is saveable but approval is blocked with visible blockers (hard ≥12 now has teeth), (2) a 12-transaction manual draft approves immediately (manual = confirmed at the ACL, no to_verify to confirm). The confirm-sample flow is covered by Task 4's integration tests. Playwright fills 12 rows programmatically via the existing `#comparable-price-${i}` inputs and the "Dodaj transakcję" button.

- [ ] **Step 1: Update the form copy**

In `apps/web/src/app/valuations/new/new-valuation-form.tsx`:

Add the import:

```ts
import { REQUIRED_SAMPLE_SIZE } from "@/domain/provenance";
```

Replace the amber warning block (currently "Operat wymaga co najmniej 12 transakcji — masz {comparablesCount}."):

```tsx
{
  comparablesCount < REQUIRED_SAMPLE_SIZE ? (
    <p className="text-sm text-amber-600 dark:text-amber-500">
      Operat wymaga co najmniej {REQUIRED_SAMPLE_SIZE} transakcji — masz {comparablesCount}. Szkic
      można zapisać, ale zatwierdzenie operatu będzie zablokowane.
    </p>
  ) : null;
}
```

Replace the submit button (currently "Tworzenie…" / "Utwórz wycenę"):

```tsx
<Button type="submit" disabled={isSubmitting} className="w-fit">
  {isSubmitting ? "Zapisywanie…" : "Zapisz szkic"}
</Button>
```

- [ ] **Step 2: Update the list status labels**

In `apps/web/src/app/valuations/page.tsx`, replace the `STATUS_LABEL` map:

```ts
const STATUS_LABEL: Record<string, string> = {
  in_progress: "Szkic",
  approved: "Zatwierdzony",
  signed: "Podpisany",
};
```

And make the badge variant match the detail page (draft = secondary, everything else = default):

```tsx
<Badge variant={v.status === "in_progress" ? "secondary" : "default"}>
  {STATUS_LABEL[v.status] ?? v.status}
</Badge>
```

- [ ] **Step 3: Rewrite the smoke spec for the two gate paths (RED — run before implementing? No: UI already exists from Task 6; this step IS the test)**

Replace the full contents of `apps/web/e2e/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// Offline smoke: manual-entry paths only (the RCN fetch needs live GUGiK).
// Demo credentials come from scripts/seed.ts (local/dev only, not secrets).

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator("#email").fill("aneta@wyceny.test");
  await page.locator("#password").fill("Admin123!");
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await page.waitForURL("**/valuations");
}

async function fillDraft(page: import("@playwright/test").Page, prices: string[]) {
  await page.goto("/valuations/new");
  await page.locator("#address").fill("ul. Testowa 1, Poznań");
  await page.locator("#area").fill("54.3");
  // The form starts with 3 rows; add the rest.
  for (let i = 3; i < prices.length; i++) {
    await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  }
  for (const [i, price] of prices.entries()) {
    await page.locator(`#comparable-price-${i}`).fill(price);
  }
  await page.getByRole("button", { name: "Zapisz szkic" }).click();
  await page.waitForURL(/\/valuations\/[0-9a-f-]{36}/);
}

test("draft with 3 transactions: WR visible, approval blocked by F-4 gate", async ({ page }) => {
  await login(page);
  await fillDraft(page, ["12000", "13000", "14000"]);

  await expect(page.getByText("Wartość rynkowa (WR)")).toBeVisible();
  await expect(page.getByTestId("wr-value")).toBeVisible();
  await expect(page.getByText("Suma współczynników (ΣUi)")).toBeVisible();

  await expect(page.getByTestId("valuation-status")).toHaveText("Szkic");
  await expect(page.getByTestId("gate-blockers")).toContainText("co najmniej 12");
  await expect(page.getByTestId("approve-button")).toBeDisabled();
});

test("draft with 12 manual transactions: approve → Zatwierdzony", async ({ page }) => {
  await login(page);
  const prices = Array.from({ length: 12 }, (_, i) => String(12_000 + i * 100));
  await fillDraft(page, prices);

  await expect(page.getByTestId("valuation-status")).toHaveText("Szkic");
  // Manual rows are confirmed at the ACL — no to_verify, gate passes on >=12.
  await expect(page.getByTestId("approve-button")).toBeEnabled();
  await page.getByTestId("approve-button").click();

  await expect(page.getByTestId("valuation-status")).toHaveText("Zatwierdzony");
  await expect(page.getByText("Zatwierdzono:")).toBeVisible();
});
```

- [ ] **Step 4: Run the e2e locally if the stack is up, otherwise rely on CI**

Run (requires local Postgres seeded + worker or just web with DB — the smoke paths don't hit the worker fetch, but createValuation calls `worker.amountInWords`, so the worker must run):

```bash
cd apps/web && pnpm build && pnpm e2e
```

Expected: 2 tests PASS. If the local stack (Postgres/worker) isn't running, push and let the CI `e2e` job be the arbiter — it migrates, seeds and starts the worker.

- [ ] **Step 5: Full verification**

Run: `cd /Users/michalczekala/Development/wyceny-app && pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise`
Expected: all green.

- [ ] **Step 6: Commit + push**

```bash
git add apps/web/src/app/valuations/new/new-valuation-form.tsx apps/web/src/app/valuations/page.tsx apps/web/e2e/smoke.spec.ts
git commit -m "feat(web): draft save copy + status labels + two-path smoke e2e (gate blocks <12, approves 12 manual)"
git push && gh run watch --exit-status
```

---

## After the tasks (S3 wrap-up → S5/S6, not plan tasks)

1. **Final whole-branch review** (independent reviewer over `fa4782d..HEAD`) per the SDD rhythm; fix Important findings.
2. **S5 deploy (⛔ human-gated):** `vercel deploy --prod` from the monorepo root; **prod DB migration** (`drizzle-kit migrate` against prod `DATABASE_URL` — first DDL on the live database; confirm with the user, verify backfill: legacy rows show "Zatwierdzony", Kościelna detail renders unchanged). Worker: NOT deployed (untouched).
3. **Live prod verification:** create a 3-tx draft → gate blocks; 12-tx manual draft → approve; RCN fetch (Kościelna) → draft with amber "do weryfikacji" badges → "Potwierdź próbę z RCN" → approve → "Zatwierdzony".
4. **S6 wiki PR:** log.md, timeline.md, new `wiki/topics/tech/sourced-gating-slice.md`, roadmap NOW→DONE + promote next, index.md (Polish, new branch off origin/main, user merges).
