# Slice 8 — Immutability + audit_log + signature (F-7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed valuations become DB-level write-once (trigger), every mutation is audit-logged (append-only `audit_log`), the owner signs an approved valuation producing a final DOCX+PDF with their uploaded signature scan (SHA-256 hashes in audit), and "Utwórz nową wersję" copies a signed valuation into a fresh draft linked via `supersedes_id`.

**Architecture:** Spec `docs/superpowers/specs/2026-07-19-immutability-audit-sign-design.md`. Migration 0009 (columns via drizzle-kit generate + hand-appended trigger SQL, precedent 0003/0007). Sign = re-render of frozen `inputs` through the existing `buildDocumentModel`/`renderOperatDocx` path with `docxtemplater-image-module-free` (spike-validated 2026-07-19, wiki-repo `tools/spike/2026-07-19-podpis-image-render/RAPORT.md`). Audit inserts ride in the same drizzle transaction as each mutation.

**Tech Stack:** Next.js 16 App Router, drizzle-orm + node-postgres, docxtemplater 3.69 + image-module-free 1.1.1, Better Auth, vitest (+ jsdom RTL), real-Postgres integration tests.

## Global Constraints

- Code/comments/commits: ENGLISH; conventional commits, lowercase-leading, ≤100 chars, NO attribution lines.
- UI copy + operat content: POLISH with full diacritics.
- **F-1 untouchable:** `computeKcs` and golden 1 044 400 zł must not change. Worker untouched (F-11).
- **F-9:** synthetic fixtures only — the signature fixture is the SYNTHETIC png from the spike; no 11-digit strings.
- **F-12:** template modified ONLY by regenerating via wiki-repo `tools/spike/2026-07-15-template-koscielna/build_template.py`; wiki-side builder diff stays UNCOMMITTED until S6 PR; the regenerated binary + tests commit in THIS repo.
- **Image module contract (spike, load-bearing):** tag value must be a STRING marker (an object/Buffer crashes the module); `null` renders empty; `{%podpis}` must NOT be glued to `{#…}{/…}` section tags inside one `w:t`.
- Per task: `pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise` → commit → push → `gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId'` → `gh run watch <id> --exit-status`. Focused test: `pnpm --filter web exec vitest run tests/<file>` (a trailing `-- <pattern>` does NOT filter).
- Pre-commit prettier: on "Code style issues" run `pnpm exec prettier --write <files>`.
- RTL tests: `// @vitest-environment jsdom` pragma + the `afterEach(cleanup)` / `ResizeObserver` preamble from `tests/rtl-kw-section.test.tsx`.
- All web paths below relative to `apps/web/`.

## Deviations from the spec (agreed rationale, surfaced at checkpoint b)

1. **`appraiser_profile` table instead of columns on `user`** — `db/auth-schema.ts` is Better Auth CLI-generated ("regenerate the same way if the config changes"); custom columns there would be lost on regen. A 1:1 table keeps auth schema untouched.
2. **No `draft_saved` audit action** — no draft-update mutation exists ("Zapisz szkic" = `create`); the audit list is `created / sample_confirmed / subject_confirmed / kw_confirmed / features_confirmed / approved / signed / version_created`.
3. **`document` trigger is conditional** (frozen only for rows referenced by a SIGNED valuation), not blanket append-only — `storage.put` legitimately overwrites same-key orphans on approve/sign retry (Slice 4 invariant comment in `approve-valuation.ts`).
4. **New-version provenance reset spares `rzeczoznawca`-sourced entries** (they stay `confirmed`) — bulk confirm actions only flip their own groups (rcn/geocode/ewidencja/mpzp/kw/weights), so a `rzeczoznawca` row reset to `to_verify` would have NO confirm path and the valuation could never be approved.

---

### Task 1: Migration 0009 — audit_log, sign/version/profile columns, write-once triggers + F-7 DB-level tests

**Files:**

- Modify: `src/db/schema.ts`
- Create: `drizzle/0009_f7_immutability_audit_sign.sql` (via `drizzle-kit generate`, then hand-append trigger SQL)
- Test: `tests/f7-immutability.test.ts`

**Interfaces:**

- Consumes: existing `valuation`, `document`, `user` tables.
- Produces: `schema.auditLog` (columns `id/valuationId/actorId/action/at/meta`), `schema.appraiserProfile` (`userId/signatureBytes/signatureMime/updatedAt`), `valuation.signedAt: Date|null`, `valuation.supersedesId: string|null`; DB triggers `valuation_write_once`, `audit_log_append_only`, `document_frozen`.

- [ ] **Step 1: Extend `src/db/schema.ts`**

Add `bigserial` and `AnyPgColumn` to the drizzle imports, then append after the `valuation` table:

```ts
import {
  bigserial,
  customType,
  date,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
```

Inside `valuation` (after `approvedAt`):

```ts
  // Set exactly once by the sign mutation (F-7). NULL = not signed.
  signedAt: timestamp("signed_at", { withTimezone: true, mode: "date" }),
  // Versioning (NFR-3): the signed valuation this one replaces. NULL = v1.
  supersedesId: uuid("supersedes_id").references((): AnyPgColumn => valuation.id),
```

New tables at the end of the file:

```ts
// Append-only audit trail (FR-12/NFR-6). INSERT-only — enforced by the
// audit_log_append_only trigger in drizzle/0009 (hand-written SQL, like RLS
// in 0003: not expressible in the schema DSL, intentionally not mirrored
// here so drizzle-kit generate never tries to revert it).
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  // No FK: audit rows must outlive any future data surgery on valuation.
  valuationId: uuid("valuation_id"),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  meta: jsonb("meta"),
});

// Appraiser profile (PRD "dane do podpisu") — 1:1 with Better Auth `user`,
// kept OUT of auth-schema.ts (that file is CLI-regenerated). Mutable (a
// re-uploaded scan replaces the old one); only rendered documents are frozen.
export const appraiserProfile = pgTable("appraiser_profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  signatureBytes: bytea("signature_bytes").notNull(),
  signatureMime: text("signature_mime").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate the migration**

Run (repo root): `pnpm --filter web exec drizzle-kit generate --name f7_immutability_audit_sign`
Expected: new file `apps/web/drizzle/0009_f7_immutability_audit_sign.sql` with `CREATE TABLE "audit_log"`, `CREATE TABLE "appraiser_profile"`, two `ALTER TABLE "valuation" ADD COLUMN`, FK constraints; journal entry idx 9 added to `drizzle/meta/_journal.json`.

- [ ] **Step 3: Hand-append the trigger SQL to the generated 0009 file** (precedent: 0007 backfill append; keep `--> statement-breakpoint` between statements)

```sql
--> statement-breakpoint
-- F-7 write-once: superusers bypass RLS but NOT triggers — this is the only
-- DB-level guarantee that binds the app's superuser connection (db/client.ts).
CREATE FUNCTION refuse_signed_valuation_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'valuation % is signed - write-once (F-7)', OLD.id;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER valuation_write_once
  BEFORE UPDATE OR DELETE ON "valuation"
  FOR EACH ROW WHEN (OLD.status = 'signed')
  EXECUTE FUNCTION refuse_signed_valuation_change();
--> statement-breakpoint
CREATE FUNCTION refuse_audit_log_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (F-7)';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION refuse_audit_log_change();
--> statement-breakpoint
-- Conditional freeze: only documents referenced by a SIGNED valuation are
-- immutable. Blanket append-only would break the documented approve/sign
-- retry path (storage.put overwrites same-key orphans, Slice 4 invariant).
-- Couples to the '/api/docs/<key>' URL format — asserted by f7 tests.
CREATE FUNCTION refuse_frozen_document_change() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "valuation" v
    WHERE v.status = 'signed'
      AND (v.doc_url = '/api/docs/' || OLD.key OR v.docx_url = '/api/docs/' || OLD.key)
  ) THEN
    RAISE EXCEPTION 'document % belongs to a signed valuation - frozen (F-7)', OLD.key;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER document_frozen
  BEFORE UPDATE OR DELETE ON "document"
  FOR EACH ROW EXECUTE FUNCTION refuse_frozen_document_change();
```

- [ ] **Step 4: Write the failing F-7 DB-level test** — `tests/f7-immutability.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";

/**
 * F-7 (ADR-011, adversarial): editing a signed valuation is REFUSED on every
 * path. This file proves the DB layer — raw SQL that bypasses domain and
 * adapter entirely, exactly how rls-isolation.test.ts proves F-8.
 */
const OWNER = "user-f7-db";

async function insertValuation(status: string, id?: string): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO "valuation" (address, area, stub_wr, owner_id, status, doc_url, docx_url)
    VALUES ('F7 test', 40, 400000, ${OWNER}, ${status},
            '/api/docs/f7-doc-' || gen_random_uuid(), '/api/docs/f7-docx-' || gen_random_uuid())
    RETURNING id`);
  return (rows.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db
    .insert(schema.user)
    .values({ id: OWNER, name: OWNER, email: `${OWNER}@example.test`, role: "appraiser" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await pool.end();
});

describe("F-7 DB-level write-once (triggers)", () => {
  it("refuses UPDATE of any column on a signed valuation", async () => {
    const id = await insertValuation("signed");
    await expect(
      db.execute(sql`UPDATE "valuation" SET address = 'tampered' WHERE id = ${id}`),
    ).rejects.toThrow(/write-once/);
  });

  it("refuses un-signing (status downgrade)", async () => {
    const id = await insertValuation("signed");
    await expect(
      db.execute(sql`UPDATE "valuation" SET status = 'in_progress' WHERE id = ${id}`),
    ).rejects.toThrow(/write-once/);
  });

  it("refuses DELETE of a signed valuation", async () => {
    const id = await insertValuation("signed");
    await expect(db.execute(sql`DELETE FROM "valuation" WHERE id = ${id}`)).rejects.toThrow(
      /write-once/,
    );
  });

  it("still allows UPDATE of a draft (trigger is WHEN-scoped)", async () => {
    const id = await insertValuation("in_progress");
    await db.execute(sql`UPDATE "valuation" SET address = 'still editable' WHERE id = ${id}`);
    const rows = await db.execute(sql`SELECT address FROM "valuation" WHERE id = ${id}`);
    expect((rows.rows[0] as { address: string }).address).toBe("still editable");
  });

  it("audit_log accepts INSERT but refuses UPDATE and DELETE", async () => {
    await db.execute(sql`INSERT INTO "audit_log" (actor_id, action) VALUES (${OWNER}, 'created')`);
    await expect(
      db.execute(sql`UPDATE "audit_log" SET action = 'tampered' WHERE actor_id = ${OWNER}`),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.execute(sql`DELETE FROM "audit_log" WHERE actor_id = ${OWNER}`),
    ).rejects.toThrow(/append-only/);
  });

  it("freezes document rows referenced by a signed valuation, leaves others mutable", async () => {
    const id = await insertValuation("signed");
    const rows = await db.execute(sql`SELECT doc_url FROM "valuation" WHERE id = ${id}`);
    const frozenKey = (rows.rows[0] as { doc_url: string }).doc_url.replace("/api/docs/", "");
    await db.execute(
      sql`INSERT INTO "document" (key, content_bytes) VALUES (${frozenKey}, ${Buffer.from("frozen")})`,
    );
    await expect(
      db.execute(
        sql`UPDATE "document" SET content_bytes = ${Buffer.from("tampered")} WHERE key = ${frozenKey}`,
      ),
    ).rejects.toThrow(/frozen/);
    await expect(db.execute(sql`DELETE FROM "document" WHERE key = ${frozenKey}`)).rejects.toThrow(
      /frozen/,
    );
    // Unreferenced key (approve-retry orphan path) stays overwritable.
    await db.execute(
      sql`INSERT INTO "document" (key, content_bytes) VALUES ('f7-orphan', ${Buffer.from("v1")})`,
    );
    await db.execute(
      sql`UPDATE "document" SET content_bytes = ${Buffer.from("v2")} WHERE key = 'f7-orphan'`,
    );
  });
});
```

- [ ] **Step 5: Run test to verify it fails before migration exists** (delete nothing — just confirm RED comes from missing tables/triggers if run before steps 1-3; if steps were done first, this is the GREEN run)

Run: `pnpm --filter web exec vitest run tests/f7-immutability.test.ts`
Expected order: written BEFORE steps 1-3 → FAIL (`column "signed_at" does not exist` / no trigger exception); after steps 1-3 → PASS (6 tests).

- [ ] **Step 6: Full gate + commit + push + CI watch**

```bash
pnpm turbo lint typecheck test build --env-mode=loose && pnpm depcruise
git add apps/web/src/db/schema.ts apps/web/drizzle apps/web/tests/f7-immutability.test.ts
git commit -m "feat: migration 0009 - audit_log, sign columns, f-7 write-once triggers"
git push
```

---

### Task 2: Domain — signValuation, newVersionOf, AuditAction

**Files:**

- Modify: `src/domain/valuation.ts`, `src/ports/valuation.ts`
- Test: `tests/valuation-lifecycle.test.ts` (extend)

**Interfaces:**

- Consumes: `Valuation`, `assertNotSigned` (existing), `KcsInput` (`inputs.comparables[].{source,status}`, `inputs.provenance` map of `{ source, status }` entries).
- Produces: `signValuation(v: Valuation, now: Date): Valuation` (throws unless signable), `NotSignableError`, `newVersionOf(v: Valuation): Omit<Valuation, "id" | "createdAt">`, `AUDIT_ACTIONS` / `type AuditAction`, `Valuation` type gains `signedAt: Date | null; supersedesId: string | null`.

- [ ] **Step 1: Extend `src/ports/valuation.ts` types**

In `Valuation` after `approvedAt`:

```ts
signedAt: Date | null;
supersedesId: string | null;
```

(`NewValuationInput` additionally gets `signedAt?`/`supersedesId?` NOT — instead `newValuation()` keeps setting them; see step 2.)

- [ ] **Step 2: Write failing domain tests** — append to `tests/valuation-lifecycle.test.ts` (follow the file's existing fixture helpers; add a minimal signable fixture)

```ts
import {
  AUDIT_ACTIONS,
  NotSignableError,
  newVersionOf,
  signValuation,
} from "../src/domain/valuation";

// inside a new describe block; `approvedValuation` = an existing approved
// fixture from this file extended with docUrl/docxUrl/inputs set and
// signedAt: null, supersedesId: null.

describe("signValuation (F-7)", () => {
  it("flips approved → signed and stamps signedAt", () => {
    const now = new Date("2026-07-19T12:00:00Z");
    const signed = signValuation(approvedValuation, now);
    expect(signed.status).toBe("signed");
    expect(signed.signedAt).toBe(now);
  });

  it("refuses a draft", () => {
    expect(() =>
      signValuation({ ...approvedValuation, status: "in_progress" }, new Date()),
    ).toThrow(NotSignableError);
  });

  it("refuses an already-signed valuation", () => {
    expect(() => signValuation({ ...approvedValuation, status: "signed" }, new Date())).toThrow(
      NotSignableError,
    );
  });

  it("refuses a legacy approved row without inputs or docx (not signable)", () => {
    expect(() => signValuation({ ...approvedValuation, inputs: null }, new Date())).toThrow(
      NotSignableError,
    );
    expect(() => signValuation({ ...approvedValuation, docxUrl: null }, new Date())).toThrow(
      NotSignableError,
    );
  });
});

describe("newVersionOf (NFR-3)", () => {
  it("copies a signed valuation into a linked draft", () => {
    const signed = signValuation(approvedValuation, new Date());
    const draft = newVersionOf(signed);
    expect(draft.status).toBe("in_progress");
    expect(draft.supersedesId).toBe(signed.id);
    expect(draft.approvedAt).toBeNull();
    expect(draft.signedAt).toBeNull();
    expect(draft.docUrl).toBeNull();
    expect(draft.docxUrl).toBeNull();
    expect(draft.address).toBe(signed.address);
  });

  it("resets machine-sourced provenance to to_verify, keeps rzeczoznawca confirmed", () => {
    const signed = signValuation(
      {
        ...approvedValuation,
        inputs: {
          ...approvedValuation.inputs!,
          comparables: [
            { ...approvedValuation.inputs!.comparables[0], source: "rcn", status: "confirmed" },
            {
              ...approvedValuation.inputs!.comparables[1],
              source: "rzeczoznawca",
              status: "confirmed",
            },
          ],
          provenance: {
            geocode: { source: "geokoder", status: "confirmed" },
            weights: { source: "rzeczoznawca", status: "confirmed" },
          },
        },
      },
      new Date(),
    );
    const draft = newVersionOf(signed);
    expect(draft.inputs!.comparables[0].status).toBe("to_verify");
    expect(draft.inputs!.comparables[1].status).toBe("confirmed");
    expect(draft.inputs!.provenance!.geocode.status).toBe("to_verify");
    expect(draft.inputs!.provenance!.weights.status).toBe("confirmed");
  });

  it("refuses a non-signed source", () => {
    expect(() => newVersionOf(approvedValuation)).toThrow(/signed/);
  });
});

it("AUDIT_ACTIONS is the closed FR-12 list", () => {
  expect(AUDIT_ACTIONS).toEqual([
    "created",
    "sample_confirmed",
    "subject_confirmed",
    "kw_confirmed",
    "features_confirmed",
    "approved",
    "signed",
    "version_created",
  ]);
});
```

- [ ] **Step 3: Run to verify FAIL** — `pnpm --filter web exec vitest run tests/valuation-lifecycle.test.ts` → FAIL (`signValuation is not exported`).

- [ ] **Step 4: Implement in `src/domain/valuation.ts`**

`newValuation()` return gains `signedAt: null, supersedesId: null,`. Then:

```ts
export const AUDIT_ACTIONS = [
  "created",
  "sample_confirmed",
  "subject_confirmed",
  "kw_confirmed",
  "features_confirmed",
  "approved",
  "signed",
  "version_created",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export class NotSignableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotSignableError";
  }
}

/**
 * The sign mutation (F-7): approved → signed, exactly once. Legacy rows
 * (stub era: no inputs snapshot / no DOCX) are not signable — there is
 * nothing to re-render the final document from.
 */
export function signValuation(v: Valuation, now: Date): Valuation {
  if (v.status !== "approved") {
    throw new NotSignableError(
      `Valuation ${v.id} is not approved (status: ${v.status}) — cannot sign`,
    );
  }
  if (!v.inputs || !v.docxUrl) {
    throw new NotSignableError(`Valuation ${v.id} is a legacy row — not signable`);
  }
  return { ...v, status: "signed", signedAt: now };
}

/** Machine-sourced entries get re-verified in a new version; the appraiser's
 * own entries stay confirmed (AI-first ACL: you don't confirm what you typed
 * — and bulk confirm actions could not flip them back anyway). */
function resetEntry<T extends { source?: string; status?: string }>(entry: T): T {
  return entry.source === "rzeczoznawca" ? entry : { ...entry, status: "to_verify" };
}

/**
 * Versioning (NFR-3): copies a SIGNED valuation into a fresh draft that
 * supersedes it. Full confirm → approve → sign cycle starts over.
 */
export function newVersionOf(v: Valuation): Omit<Valuation, "id" | "createdAt"> {
  if (v.status !== "signed") {
    throw new Error(`Valuation ${v.id} is not signed — only signed valuations get new versions`);
  }
  const inputs = v.inputs
    ? {
        ...v.inputs,
        comparables: v.inputs.comparables.map(resetEntry),
        provenance: v.inputs.provenance
          ? Object.fromEntries(
              Object.entries(v.inputs.provenance).map(([k, e]) => [k, e ? resetEntry(e) : e]),
            )
          : v.inputs.provenance,
      }
    : v.inputs;
  return {
    address: v.address,
    area: v.area,
    wr: v.wr,
    inputs: inputs as Valuation["inputs"],
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose: v.purpose,
    kwNumber: v.kwNumber,
    client: v.client,
    inspectionDate: v.inspectionDate,
    ownerId: v.ownerId,
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: v.id,
  };
}
```

Fix the two spots that now miss the new fields: `toValuation` in the adapter needs no change (spread), but `newValuation()` in this file must return them (see above). If `tsc` flags other object literals building `Valuation` (test fixtures), add `signedAt: null, supersedesId: null` there.

- [ ] **Step 5: Run to verify PASS** — `pnpm --filter web exec vitest run tests/valuation-lifecycle.test.ts` → PASS.

- [ ] **Step 6: Full gate + commit + push + CI watch**

```bash
git add apps/web/src/domain/valuation.ts apps/web/src/ports/valuation.ts apps/web/tests/valuation-lifecycle.test.ts
git commit -m "feat: sign and new-version domain mutations with closed audit action list"
```

---

### Task 3: Template `{%podpis}` + image module in the render adapter + F-12 extension

**Files:**

- Modify (WIKI repo, uncommitted until S6): `/Users/michalczekala/Development/wyceny/tools/spike/2026-07-15-template-koscielna/build_template.py`
- Modify: `templates/operat-szablon.docx` (regenerated binary), `src/adapters/docx-render.ts`, `package.json` (new dep)
- Create: `src/types/docxtemplater-image-module-free.d.ts`, `tests/fixtures/signature-synthetic.png`
- Test: `tests/f12-template-integrity.test.ts` (extend), `tests/docx-render-signature.test.ts` (new)

**Interfaces:**

- Consumes: `renderOperatDocx(model: DocumentModel): Buffer` (existing), template label cell `"Pieczęć i podpis rzeczoznawcy majątkowego:"`.
- Produces: `renderOperatDocx(model: DocumentModel, opts?: { signature?: Buffer | null }): Buffer` — backward-compatible (all existing callers unchanged, render without signature byte-equivalent to today's output except the inert `{%podpis}` tag).

- [ ] **Step 1: Add the builder stage (wiki repo)**

In `build_template.py`, add a stage that runs on the final `word/document.xml` string right before the zip is written (same place other text substitutions end). Exact code:

```python
# Stage 11: signature placeholder (Slice 8, F-7) — {%podpis} lands inline in
# the "Pieczęć i podpis" cell. Image-module contract (spike 2026-07-19):
# inline is fine, but NEVER glue it to {#..}{/..} section tags in one w:t.
SIGNATURE_LABEL = "Pieczęć i podpis rzeczoznawcy majątkowego:"

def inject_signature_tag(xml: str) -> str:
    hits = xml.count(SIGNATURE_LABEL)
    check(hits == 1, f"signature label found exactly once (hits={hits})")
    return xml.replace(SIGNATURE_LABEL, SIGNATURE_LABEL + " {%podpis}")
```

Wire it into the pipeline where `document.xml` is serialized (implementer: follow how existing text-replacement stages access the xml string; add a `print("== stage 11: signature placeholder ==")` matching the file's convention), then regenerate and copy:

```bash
cd /Users/michalczekala/Development/wyceny/tools/spike/2026-07-15-template-koscielna
python3 build_template.py          # all check() assertions must pass
cp operat-szablon.docx /Users/michalczekala/Development/wyceny-app/apps/web/templates/operat-szablon.docx
```

(Confirm via the builder's own output which artifact is the canonical product — the app template is 152 KB. Wiki-side diff stays uncommitted until S6.)

- [ ] **Step 2: Add the dependency + type shim**

```bash
pnpm --filter web add docxtemplater-image-module-free@1.1.1
```

`src/types/docxtemplater-image-module-free.d.ts`:

```ts
declare module "docxtemplater-image-module-free" {
  interface ImageModuleOptions {
    centered?: boolean;
    getImage(tagValue: string, tagName: string): Buffer;
    getSize(img: Buffer, tagValue: string, tagName: string): [number, number];
  }
  export default class ImageModule {
    constructor(options: ImageModuleOptions);
  }
}
```

- [ ] **Step 3: Copy the synthetic signature fixture**

```bash
cp /Users/michalczekala/Development/wyceny/tools/spike/2026-07-19-podpis-image-render/signature-synthetic.png \
   apps/web/tests/fixtures/signature-synthetic.png
```

(712 bytes, generated by the spike's stdlib `make_signature.py` — synthetic squiggle, F-9-safe.)

- [ ] **Step 4: Write failing render tests** — `tests/docx-render-signature.test.ts`

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import { renderOperatDocx } from "../src/adapters/docx-render";
import { buildDocumentModel } from "../src/domain/document-model";
import { syntheticDocumentInput } from "./fixtures/document-model-fixture";

const SIGNATURE = fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png"));

const mediaOf = (buf: Buffer) =>
  Object.keys(new PizZip(buf).files).filter((f) => f.startsWith("word/media/"));

const textOf = (buf: Buffer) =>
  new PizZip(buf)
    .file("word/document.xml")!
    .asText()
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, " ")
    .trim();

describe("renderOperatDocx signature (F-7 sign path)", () => {
  const model = buildDocumentModel(syntheticDocumentInput());

  it("embeds the signature image when a scan is provided", () => {
    const plain = renderOperatDocx(model);
    const signed = renderOperatDocx(model, { signature: SIGNATURE });
    expect(mediaOf(signed).length).toBe(mediaOf(plain).length + 1);
  });

  it("renders empty (no media, no leftover tag) without a scan — approve path", () => {
    const plain = renderOperatDocx(model);
    expect(textOf(plain)).not.toContain("{%podpis}");
  });

  it("signed and approved renders have identical text (drift guard)", () => {
    const plain = renderOperatDocx(model);
    const signed = renderOperatDocx(model, { signature: SIGNATURE });
    expect(textOf(signed)).toBe(textOf(plain));
  });
});
```

Note: `syntheticDocumentInput()` — reuse the existing synthetic model fixture used by `f12-document-sections.test.ts` (import from wherever that test gets its complete render input; if it builds the input inline, extract it into `tests/fixtures/document-model-fixture.ts` and update that test's import — one shared fixture, no duplication).

- [ ] **Step 5: Extend `tests/f12-template-integrity.test.ts`**

New `it` in the placeholders describe:

```ts
it("contains the {%podpis} signature tag exactly once (Slice 8)", () => {
  const text = templateText();
  expect(text.match(/\{%podpis\}/g)).toHaveLength(1);
});
```

- [ ] **Step 6: Run to verify FAIL** — `pnpm --filter web exec vitest run tests/docx-render-signature.test.ts tests/f12-template-integrity.test.ts`
      Expected: FAIL — `renderOperatDocx` has no second parameter / template missing tag (if template already regenerated in step 1, only the render test fails).

- [ ] **Step 7: Implement `src/adapters/docx-render.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import expressionParser from "docxtemplater/expressions.js";
import ImageModule from "docxtemplater-image-module-free";
import type { DocumentModel } from "../domain/document-model";

/**
 * DOCX renderer — fills the production operat template with a masked
 * DocumentModel. Pure JS (docxtemplater), validated end-to-end by the
 * 2026-07-15 template spike. The expressions parser is LOAD-BEARING:
 * without it `{a.b}` renders the string "undefined" (operat-e2e spike bug).
 *
 * Signature (Slice 8, spike 2026-07-19): the {%podpis} tag value MUST be a
 * string marker — the free image module treats any object (a Buffer!) as an
 * already-resolved {rId, sizePixel} and crashes. null renders empty, which
 * is the approve path; the sign path passes the owner's scan Buffer via
 * opts and the module pulls it through getImage().
 */
const TEMPLATE_PATH = path.join(process.cwd(), "templates", "operat-szablon.docx");

/** Fixed signature box in px (spike-verified fit for the title-page cell). */
const SIGNATURE_SIZE: [number, number] = [170, 57];

export function renderOperatDocx(
  model: DocumentModel,
  opts?: { signature?: Buffer | null },
): Buffer {
  const signature = opts?.signature ?? null;
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    parser: expressionParser,
    modules: [
      new ImageModule({
        centered: false,
        getImage: () => signature as Buffer,
        getSize: () => SIGNATURE_SIZE,
      }),
    ],
  });
  doc.render({ ...model, podpis: signature ? "sygnatariusz" : null });
  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
}
```

- [ ] **Step 8: Run to verify PASS** — same two test files + the full F-12 suite:
      `pnpm --filter web exec vitest run tests/docx-render-signature.test.ts tests/f12-template-integrity.test.ts tests/f12-document-sections.test.ts tests/f12-document-masking.test.ts` → PASS.

- [ ] **Step 9: Full gate + commit + push + CI watch**

```bash
git add apps/web/templates/operat-szablon.docx apps/web/src/adapters/docx-render.ts \
  apps/web/src/types/docxtemplater-image-module-free.d.ts apps/web/tests \
  apps/web/package.json pnpm-lock.yaml
git commit -m "feat: signature tag in operat template and image-module render path"
```

---

### Task 4: Adapter — audit inserts in transactions + CAS status guards (existing mutations)

**Files:**

- Modify: `src/adapters/valuation-drizzle.ts`, `src/ports/valuation.ts` (approve gains optional `now`)
- Test: `tests/audit-log.test.ts` (new), `tests/valuation-repo.test.ts` (stays green)

**Interfaces:**

- Consumes: `schema.auditLog`, `AuditAction` (Task 2).
- Produces: every existing mutation (`create`, `confirmSample`, `confirmSubject`, `confirmKw`, `confirmFeatures`, `approve`) writes exactly one audit row in the same transaction; every UPDATE carries `and(eq(id), eq(status, "in_progress"))` CAS; `approve(id, user, docs?, now?)` threads `now` into `approveValuation` (data_sporzadzenia sync, Task 7 relies on it).

- [ ] **Step 1: Write failing audit coverage test** — `tests/audit-log.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import type { SessionUser } from "../src/ports/valuation";

/** FR-12/NFR-6: every mutation leaves exactly one typed audit row, written
 * transactionally with the mutation itself. */
const owner: SessionUser = { id: "user-audit", role: "appraiser" };
const repo = valuationRepo(db);

async function auditRows(valuationId: string) {
  return db.select().from(schema.auditLog).where(eq(schema.auditLog.valuationId, valuationId));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db
    .insert(schema.user)
    .values({ id: owner.id, name: owner.id, email: `${owner.id}@example.test`, role: "appraiser" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await pool.end();
});

describe("audit_log per mutation", () => {
  it("create writes a 'created' row with the actor", async () => {
    const v = await repo.create({
      address: "Audit 1",
      area: 40,
      wr: 400000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      ownerId: owner.id,
    });
    const rows = await auditRows(v.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("created");
    expect(rows[0].actorId).toBe(owner.id);
  });

  it("confirmSample writes a 'sample_confirmed' row", async () => {
    // Reuse the confirmable-inputs fixture from tests/valuation-repo.test.ts
    // (an inputs snapshot with one rcn/to_verify comparable) — import or copy
    // the helper, then:
    const v = await repo.create(confirmableInput(owner.id));
    await repo.confirmSample(v.id, owner);
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created", "sample_confirmed"]);
  });

  it("approve writes an 'approved' row with doc urls in meta", async () => {
    const v = await repo.create(approvableInput(owner.id)); // gate-passing fixture from valuation-repo.test.ts
    await repo.approve(v.id, owner, { docUrl: "/api/docs/a.pdf", docxUrl: "/api/docs/a.docx" });
    const rows = await auditRows(v.id);
    expect(rows.at(-1)!.action).toBe("approved");
    expect(rows.at(-1)!.meta).toMatchObject({ docUrl: "/api/docs/a.pdf" });
  });

  it("a failed mutation writes NO audit row (same transaction)", async () => {
    const v = await repo.create({
      address: "Audit fail",
      area: 40,
      wr: 400000,
      inputs: null, // confirmSample throws: no inputs snapshot
      amountInWords: null,
      docUrl: null,
      ownerId: owner.id,
    });
    await expect(repo.confirmSample(v.id, owner)).rejects.toThrow();
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual(["created"]);
  });
});
```

(`confirmableInput`/`approvableInput`: the exact `KcsInput` fixtures already exist in `tests/valuation-repo.test.ts` — extract them to `tests/fixtures/valuation-inputs.ts` and import from both files instead of duplicating.)

- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter web exec vitest run tests/audit-log.test.ts` → FAIL (0 audit rows).

- [ ] **Step 3: Implement in `src/adapters/valuation-drizzle.ts`**

Add imports: `and` from drizzle-orm, `AuditAction` type + the domain functions already imported. Add helper above `valuationRepo`:

```ts
import { and, eq, or, sql } from "drizzle-orm";
import type { AuditAction } from "../domain/valuation";

/** One audit row per mutation, inside the mutation's transaction (FR-12). */
async function insertAudit(
  tx: Tx,
  entry: { valuationId: string; actorId: string; action: AuditAction; meta?: unknown },
) {
  await tx.insert(schema.auditLog).values({
    valuationId: entry.valuationId,
    actorId: entry.actorId,
    action: entry.action,
    meta: entry.meta ?? null,
  });
}
```

Rework `create`:

```ts
    async create(input: NewValuationInput): Promise<Valuation> {
      return db.transaction(async (tx) => {
        const toInsert = newValuation(input);
        const [row] = await tx.insert(schema.valuation).values(toInsert).returning();
        await insertAudit(tx, { valuationId: row.id, actorId: input.ownerId, action: "created" });
        return toValuation(row);
      });
    },
```

Rework each `confirm*` to one shared shape (shown for `confirmSample`; the other three differ only in domain fn + action name — `confirmSubject`→`subject_confirmed`, `confirmKw`→`kw_confirmed`, `confirmFeatures`→`features_confirmed`):

```ts
    async confirmSample(id: string, user: SessionUser): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = confirmSampleProvenance(valuation);
        // CAS: the status re-check in WHERE closes the select→update race
        // (Slice 3 backlog) — 0 rows means a concurrent flip won.
        const [saved] = await tx
          .update(schema.valuation)
          .set({ inputs: updated.inputs })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, { valuationId: id, actorId: user.id, action: "sample_confirmed" });
        return toValuation(saved);
      });
    },
```

Rework `approve` (signature change — port too):

```ts
    async approve(
      id: string,
      user: SessionUser,
      docs?: { docUrl: string; docxUrl: string },
      now: Date = new Date(),
    ): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = approveValuation(valuation, now, docs);
        const [saved] = await tx
          .update(schema.valuation)
          .set({
            status: updated.status,
            approvedAt: updated.approvedAt,
            docUrl: updated.docUrl,
            docxUrl: updated.docxUrl,
          })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "in_progress")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "approved",
          meta: { docUrl: updated.docUrl, docxUrl: updated.docxUrl },
        });
        return toValuation(saved);
      });
    },
```

Port `approve` doc + signature in `src/ports/valuation.ts`:

```ts
  approve(
    id: string,
    user: SessionUser,
    docs?: { docUrl: string; docxUrl: string },
    now?: Date,
  ): Promise<Valuation | null>;
```

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter web exec vitest run tests/audit-log.test.ts tests/valuation-repo.test.ts` → PASS (repo suite must stay green — behavior unchanged for callers).

- [ ] **Step 5: Full gate + commit + push + CI watch**

```bash
git commit -m "feat: audit_log rows and cas status guards on all valuation mutations"
```

---

### Task 5: Adapter + port — sign and createNewVersion

**Files:**

- Modify: `src/adapters/valuation-drizzle.ts`, `src/ports/valuation.ts`
- Test: `tests/f7-immutability.test.ts` (extend — adapter-path section)

**Interfaces:**

- Consumes: `signValuation`, `newVersionOf` (Task 2), `insertAudit` (Task 4).
- Produces:
  - `sign(id: string, user: SessionUser, docs: { docUrl: string; docxUrl: string; sha256Docx: string; sha256Pdf: string }): Promise<Valuation | null>` — CAS on `approved`, repoints doc urls, audit `signed` with hashes in meta.
  - `createNewVersion(id: string, user: SessionUser): Promise<Valuation | null>` — inserts the Task-2 copy, audit `version_created` with `{ supersedes }` meta on the NEW id.

- [ ] **Step 1: Write failing tests** — append to `tests/f7-immutability.test.ts`

```ts
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import { NotSignableError } from "../src/domain/valuation";
import type { SessionUser } from "../src/ports/valuation";

const ownerUser: SessionUser = { id: OWNER, role: "appraiser" };
const strangerUser: SessionUser = { id: "user-f7-stranger", role: "appraiser" };
const repo = valuationRepo(db);
// beforeAll additionally inserts strangerUser into schema.user (same onConflictDoNothing insert).

// signableInput(ownerId): an approvable KcsInput fixture (import the shared
// tests/fixtures/valuation-inputs.ts from Task 4) — create → approve with
// docs so the row is approved with docUrl/docxUrl set.
async function signedFixture(): Promise<string> {
  const v = await repo.create(approvableInput(OWNER));
  await repo.approve(v.id, ownerUser, {
    docUrl: `/api/docs/operat-${v.id}.pdf`,
    docxUrl: `/api/docs/operat-${v.id}.docx`,
  });
  const signed = await repo.sign(v.id, ownerUser, {
    docUrl: `/api/docs/operat-${v.id}-signed.pdf`,
    docxUrl: `/api/docs/operat-${v.id}-signed.docx`,
    sha256Docx: "a".repeat(64),
    sha256Pdf: "b".repeat(64),
  });
  expect(signed!.status).toBe("signed");
  return v.id;
}

describe("F-7 adapter path — sign", () => {
  it("signs an approved valuation: status, signedAt, repointed urls, hashed audit row", async () => {
    const id = await signedFixture();
    const rows = await db.execute(sql`SELECT * FROM "valuation" WHERE id = ${id}`);
    const row = rows.rows[0] as { status: string; signed_at: Date; doc_url: string };
    expect(row.status).toBe("signed");
    expect(row.signed_at).not.toBeNull();
    expect(row.doc_url).toContain("-signed.pdf");
    const audit = await db.execute(
      sql`SELECT * FROM "audit_log" WHERE valuation_id = ${id} AND action = 'signed'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect((audit.rows[0] as { meta: { sha256Docx: string } }).meta.sha256Docx).toBe(
      "a".repeat(64),
    );
  });

  it("refuses to sign a draft (NotSignableError) and a foreign valuation (null)", async () => {
    const draft = await repo.create(approvableInput(OWNER));
    await expect(
      repo.sign(draft.id, ownerUser, {
        docUrl: "/api/docs/x.pdf",
        docxUrl: "/api/docs/x.docx",
        sha256Docx: "c".repeat(64),
        sha256Pdf: "d".repeat(64),
      }),
    ).rejects.toThrow(NotSignableError);
    const signedId = await signedFixture();
    expect(
      await repo.sign(signedId, strangerUser, {
        docUrl: "/api/docs/y.pdf",
        docxUrl: "/api/docs/y.docx",
        sha256Docx: "e".repeat(64),
        sha256Pdf: "f".repeat(64),
      }),
    ).toBeNull();
  });

  it("every mutation refuses a signed valuation (domain + trigger belt)", async () => {
    const id = await signedFixture();
    await expect(repo.confirmSample(id, ownerUser)).rejects.toThrow(/not a draft/);
    await expect(repo.approve(id, ownerUser)).rejects.toThrow(/not a draft/);
    await expect(
      repo.sign(id, ownerUser, {
        docUrl: "/api/docs/z.pdf",
        docxUrl: "/api/docs/z.docx",
        sha256Docx: "0".repeat(64),
        sha256Pdf: "1".repeat(64),
      }),
    ).rejects.toThrow(NotSignableError);
  });
});

describe("F-7 adapter path — createNewVersion", () => {
  it("copies a signed valuation into a linked draft with version_created audit", async () => {
    const id = await signedFixture();
    const draft = await repo.createNewVersion(id, ownerUser);
    expect(draft!.status).toBe("in_progress");
    expect(draft!.supersedesId).toBe(id);
    expect(draft!.docUrl).toBeNull();
    const audit = await db.execute(
      sql`SELECT * FROM "audit_log" WHERE valuation_id = ${draft!.id} AND action = 'version_created'`,
    );
    expect((audit.rows[0] as { meta: { supersedes: string } }).meta.supersedes).toBe(id);
  });

  it("refuses on a non-signed source and for non-owners", async () => {
    const draft = await repo.create(approvableInput(OWNER));
    await expect(repo.createNewVersion(draft.id, ownerUser)).rejects.toThrow(/not signed/);
    const signedId = await signedFixture();
    expect(await repo.createNewVersion(signedId, strangerUser)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter web exec vitest run tests/f7-immutability.test.ts` → FAIL (`repo.sign is not a function`).

- [ ] **Step 3: Implement adapter methods** (append inside `valuationRepo`):

```ts
    async sign(
      id: string,
      user: SessionUser,
      docs: { docUrl: string; docxUrl: string; sha256Docx: string; sha256Pdf: string },
    ): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const updated = signValuation(valuation, new Date());
        const [saved] = await tx
          .update(schema.valuation)
          .set({
            status: updated.status,
            signedAt: updated.signedAt,
            docUrl: docs.docUrl,
            docxUrl: docs.docxUrl,
          })
          .where(and(eq(schema.valuation.id, id), eq(schema.valuation.status, "approved")))
          .returning();
        if (!saved) return null;
        await insertAudit(tx, {
          valuationId: id,
          actorId: user.id,
          action: "signed",
          meta: { sha256Docx: docs.sha256Docx, sha256Pdf: docs.sha256Pdf, docUrl: docs.docUrl },
        });
        return toValuation(saved);
      });
    },

    async createNewVersion(id: string, user: SessionUser): Promise<Valuation | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.valuation).where(eq(schema.valuation.id, id));
        if (!row) return null;
        const valuation = toValuation(row);
        if (valuation.ownerId !== user.id) return null;
        const copy = newVersionOf(valuation);
        const [inserted] = await tx.insert(schema.valuation).values(copy).returning();
        await insertAudit(tx, {
          valuationId: inserted.id,
          actorId: user.id,
          action: "version_created",
          meta: { supersedes: id },
        });
        return toValuation(inserted);
      });
    },
```

Add `signValuation, newVersionOf` to the domain import; add both signatures to `PortValuation` with doc comments mirroring the test contracts (null = not found / not owner; throws = status violation).

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter web exec vitest run tests/f7-immutability.test.ts` → PASS (all DB-level + adapter-path tests).

- [ ] **Step 5: Full gate + commit + push + CI watch**

```bash
git commit -m "feat: sign and create-new-version repo mutations with hashed audit trail"
```

---

### Task 6: Appraiser profile — signature scan upload (port, adapter, action, page)

**Files:**

- Create: `src/ports/profile.ts`, `src/adapters/profile-drizzle.ts`, `src/app/actions/save-signature.ts`, `src/app/profile/page.tsx`, `src/app/profile/signature-form.tsx`
- Modify: `src/app/valuations/_deps.ts`, `src/app/valuations/page.tsx` (nav link)
- Test: `tests/profile-repo.test.ts`, `tests/rtl-signature-form.test.tsx`

**Interfaces:**

- Consumes: `schema.appraiserProfile` (Task 1), `getSession` (`@/auth/session`).
- Produces: `PortProfile { getSignature(userId: string): Promise<{ bytes: Buffer; mime: string } | null>; saveSignature(userId: string, bytes: Buffer, mime: string): Promise<void> }`; `profileRepository` in `_deps`; server action `saveSignature(formData: FormData): Promise<{ error: string } | undefined>`; page `/profile`.

- [ ] **Step 1: Port** — `src/ports/profile.ts`

```ts
/** Appraiser profile port (PRD "dane do podpisu") — pure interface, F-10. */
export interface PortProfile {
  getSignature(userId: string): Promise<{ bytes: Buffer; mime: string } | null>;
  /** Upserts — a re-uploaded scan replaces the previous one (profile data is
   * mutable; only rendered documents are frozen). */
  saveSignature(userId: string, bytes: Buffer, mime: string): Promise<void>;
}
```

- [ ] **Step 2: Failing adapter test** — `tests/profile-repo.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { profileRepo } from "../src/adapters/profile-drizzle";

const USER = "user-profile-test";
const repo = profileRepo(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db
    .insert(schema.user)
    .values({ id: USER, name: USER, email: `${USER}@example.test`, role: "appraiser" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await pool.end();
});

describe("profileRepo signature roundtrip", () => {
  it("returns null when no scan was uploaded", async () => {
    expect(await repo.getSignature("user-without-profile")).toBeNull();
  });

  it("stores and returns the scan; re-upload replaces it", async () => {
    await repo.saveSignature(USER, Buffer.from("png-v1"), "image/png");
    const first = await repo.getSignature(USER);
    expect(first!.bytes.toString()).toBe("png-v1");
    expect(first!.mime).toBe("image/png");
    await repo.saveSignature(USER, Buffer.from("jpeg-v2"), "image/jpeg");
    const second = await repo.getSignature(USER);
    expect(second!.bytes.toString()).toBe("jpeg-v2");
    expect(second!.mime).toBe("image/jpeg");
  });
});
```

Run: `pnpm --filter web exec vitest run tests/profile-repo.test.ts` → FAIL (module not found).

- [ ] **Step 3: Adapter** — `src/adapters/profile-drizzle.ts`

```ts
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type { PortProfile } from "../ports/profile";

export function profileRepo(db: NodePgDatabase<typeof schema>): PortProfile {
  return {
    async getSignature(userId) {
      const [row] = await db
        .select()
        .from(schema.appraiserProfile)
        .where(eq(schema.appraiserProfile.userId, userId));
      return row ? { bytes: row.signatureBytes, mime: row.signatureMime } : null;
    },

    async saveSignature(userId, bytes, mime) {
      await db
        .insert(schema.appraiserProfile)
        .values({ userId, signatureBytes: bytes, signatureMime: mime })
        .onConflictDoUpdate({
          target: schema.appraiserProfile.userId,
          set: { signatureBytes: bytes, signatureMime: mime, updatedAt: new Date() },
        });
    },
  };
}
```

Wire in `src/app/valuations/_deps.ts`:

```ts
import { profileRepo } from "@/adapters/profile-drizzle";
export const profileRepository = profileRepo(db);
```

Run the test again → PASS.

- [ ] **Step 4: Server action** — `src/app/actions/save-signature.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { profileRepository } from "@/app/valuations/_deps";

export type SaveSignatureResult = { error: string } | undefined;

const MAX_BYTES = 1_000_000;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg"]);

/** Uploads the appraiser's signature scan (RODO: stored ONLY in Postgres,
 * never on disk / in the repo). Own profile only — the session user is the
 * only writable target. */
export async function saveSignature(formData: FormData): Promise<SaveSignatureResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const file = formData.get("signature");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Wybierz plik ze skanem podpisu (PNG lub JPEG)." };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return { error: "Dozwolone formaty: PNG lub JPEG." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "Plik jest za duży — maksymalnie 1 MB." };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  await profileRepository.saveSignature(session.user.id, bytes, file.type);
  revalidatePath("/profile");
}
```

- [ ] **Step 5: Failing RTL test** — `tests/rtl-signature-form.test.tsx`

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignatureForm } from "@/app/profile/signature-form";

afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const saveSignature = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/save-signature", () => ({ saveSignature }));

describe("SignatureForm", () => {
  it("submits the chosen file and surfaces the action error", async () => {
    saveSignature.mockResolvedValueOnce({ error: "Dozwolone formaty: PNG lub JPEG." });
    render(<SignatureForm hasSignature={false} />);
    const input = screen.getByLabelText(/skan podpisu/i);
    await userEvent.upload(input, new File(["x"], "sig.gif", { type: "image/gif" }));
    await userEvent.click(screen.getByRole("button", { name: /zapisz podpis/i }));
    await waitFor(() => expect(saveSignature).toHaveBeenCalledOnce());
    expect(await screen.findByText(/dozwolone formaty/i)).toBeInTheDocument();
  });

  it("tells a first-time user there is no scan yet", () => {
    render(<SignatureForm hasSignature={false} />);
    expect(screen.getByText(/nie wgrano jeszcze skanu podpisu/i)).toBeInTheDocument();
  });
});
```

Run → FAIL (component missing).

- [ ] **Step 6: Client form + RSC page**

`src/app/profile/signature-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveSignature } from "@/app/actions/save-signature";

export function SignatureForm({ hasSignature }: { hasSignature: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const formData = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await saveSignature(formData);
          if (result?.error) setError(result.error);
        });
      }}
    >
      {hasSignature ? null : (
        <p className="text-sm text-muted-foreground">
          Nie wgrano jeszcze skanu podpisu — bez niego nie podpiszesz operatu.
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Skan podpisu (PNG lub JPEG, do 1 MB; najlepiej szeroki, np. 510×170 px)
        <input type="file" name="signature" accept="image/png,image/jpeg" />
      </label>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Zapisywanie…" : "Zapisz podpis"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
```

`src/app/profile/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/auth/session";
import { profileRepository } from "@/app/valuations/_deps";
import { SignatureForm } from "./signature-form";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const signature = await profileRepository.getSignature(session.user.id);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Profil rzeczoznawcy</h1>
        <Link href="/valuations" className="text-sm underline">
          ← Wyceny
        </Link>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Podpis do operatu</h2>
        {signature ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL, next/image adds nothing
          <img
            alt="Aktualny skan podpisu"
            className="max-h-24 w-fit rounded border bg-white p-2"
            src={`data:${signature.mime};base64,${signature.bytes.toString("base64")}`}
          />
        ) : null}
        <SignatureForm hasSignature={Boolean(signature)} />
      </section>
    </main>
  );
}
```

Nav link in `src/app/valuations/page.tsx`: add next to the page's existing header controls (match surrounding markup):

```tsx
<Link href="/profile" className="text-sm underline">
  Profil
</Link>
```

- [ ] **Step 7: Run to verify PASS** — `pnpm --filter web exec vitest run tests/rtl-signature-form.test.tsx tests/profile-repo.test.ts` → PASS.

- [ ] **Step 8: Full gate + commit + push + CI watch**

```bash
git commit -m "feat: appraiser profile page with signature scan upload"
```

---

### Task 7: Sign action + approve `now` sync

**Files:**

- Create: `src/app/actions/sign-valuation.ts`
- Modify: `src/app/actions/approve-valuation.ts` (single `now`)
- Test: `tests/sign-valuation-action.test.ts` (new; mirror `tests/approve-valuation-action.test.ts` mock conventions exactly — same `vi.mock` targets)

**Interfaces:**

- Consumes: `repo.sign` (Task 5), `profileRepository.getSignature` (Task 6), `renderOperatDocx(model, { signature })` (Task 3), `buildDocumentModel`, `computeKcs`, `worker.amountInWords`, `worker.convertToPdf`, `storage.put`.
- Produces: `signValuationAction(id: string): Promise<{ error: string } | undefined>` — the ONLY caller of `repo.sign`.

- [ ] **Step 1: approve `now` sync** — in `approve-valuation.ts` replace the two independent dates:

```ts
    const now = new Date();
    // …
      approvedAt: now,   // in buildDocumentModel input (was: new Date())
    // …
    const updated = await valuationRepository.approve(id, session.user, { docUrl, docxUrl }, now);
```

(`data_sporzadzenia` in the document now always equals the persisted `approvedAt` — the sign re-render reads THAT value, so both renders agree even across midnight.)

- [ ] **Step 2: Write failing action test** — `tests/sign-valuation-action.test.ts`

Mirror the mock setup of `tests/approve-valuation-action.test.ts` (same `vi.mock("@/app/valuations/_deps")`, `vi.mock("@/auth/session")`, `vi.mock("next/cache")`, `vi.mock("next/navigation")` blocks — copy them verbatim, extend the `_deps` mock with `profileRepository: { getSignature: vi.fn() }` and repo mock with `sign: vi.fn()`), then:

```ts
import { signValuationAction } from "../src/app/actions/sign-valuation";

// fixtures: approvedValuation = { id: "v1", status: "approved", ownerId: "u1",
// approvedAt: new Date("2026-07-19"), inputs: <approvable KcsInput fixture>,
// docUrl: "/api/docs/operat-v1.pdf", docxUrl: "/api/docs/operat-v1.docx",
// purpose: "sprzedaz", kwNumber: "PO1P/00000001/1", client: "Jan Testowy",
// inspectionDate: "2026-07-10", area: 40, wr: 400000, address: "Testowa 1",
// amountInWords: null, signedAt: null, supersedesId: null, createdAt: new Date() }

describe("signValuationAction", () => {
  it("refuses when there is no signature scan in the profile", async () => {
    repoMock.get.mockResolvedValue(approvedValuation);
    profileMock.getSignature.mockResolvedValue(null);
    const result = await signValuationAction("v1");
    expect(result?.error).toMatch(/skan podpisu/i);
    expect(repoMock.sign).not.toHaveBeenCalled();
  });

  it("refuses a non-approved valuation with a Polish error", async () => {
    repoMock.get.mockResolvedValue({ ...approvedValuation, status: "signed" });
    const result = await signValuationAction("v1");
    expect(result?.error).toMatch(/podpisan/i);
  });

  it("refuses a legacy approved row (no inputs)", async () => {
    repoMock.get.mockResolvedValue({ ...approvedValuation, inputs: null });
    const result = await signValuationAction("v1");
    expect(result?.error).toMatch(/starego typu|nie można podpisać/i);
  });

  it("renders, converts, stores -signed keys, hashes and signs", async () => {
    repoMock.get.mockResolvedValue(approvedValuation);
    profileMock.getSignature.mockResolvedValue({
      bytes: fs.readFileSync(path.join(__dirname, "fixtures", "signature-synthetic.png")),
      mime: "image/png",
    });
    workerMock.amountInWords.mockResolvedValue("czterysta tysięcy złotych");
    workerMock.convertToPdf.mockResolvedValue(Buffer.from("pdf-bytes"));
    storageMock.put.mockImplementation(async (key: string) => `/api/docs/${key}`);
    repoMock.sign.mockResolvedValue({ ...approvedValuation, status: "signed" });

    const result = await signValuationAction("v1");
    expect(result).toBeUndefined();
    expect(storageMock.put).toHaveBeenCalledWith("operat-v1-signed.docx", expect.any(Buffer));
    expect(storageMock.put).toHaveBeenCalledWith("operat-v1-signed.pdf", expect.any(Buffer));
    const signArgs = repoMock.sign.mock.calls[0][2];
    expect(signArgs.sha256Pdf).toBe(
      createHash("sha256").update(Buffer.from("pdf-bytes")).digest("hex"),
    );
    expect(signArgs.docUrl).toBe("/api/docs/operat-v1-signed.pdf");
  });
});
```

Run → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/app/actions/sign-valuation.ts`

```ts
"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, worker, valuationRepository, profileRepository } from "@/app/valuations/_deps";
import { NotSignableError } from "@/domain/valuation";
import { buildDocumentModel, type OperatPurpose } from "@/domain/document-model";
import { computeKcs } from "@/domain/kcs";
import { renderOperatDocx } from "@/adapters/docx-render";

export type SignValuationResult = { error: string } | undefined;

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/**
 * Sign = final re-render of the FROZEN inputs with the owner's signature
 * scan + irreversible status flip (F-7). Mirrors approve-valuation.ts:
 * files stored first, the flip (CAS on 'approved' + audit row with SHA-256
 * hashes, in one transaction) happens last; a failed flip leaves orphan
 * -signed files the retry overwrites. data_sporzadzenia derives from the
 * persisted approvedAt, so the signed text is identical to the approved one
 * (drift guard test in docx-render-signature.test.ts).
 */
export async function signValuationAction(id: string): Promise<SignValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const valuation = await valuationRepository.get(id, session.user);
  if (!valuation) {
    return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
  }
  if (valuation.status === "signed") {
    return { error: "Wycena jest już podpisana." };
  }
  if (valuation.status !== "approved") {
    return { error: "Podpisać można tylko zatwierdzoną wycenę." };
  }
  if (!valuation.inputs || !valuation.docxUrl || !valuation.approvedAt) {
    return { error: "Wyceny starego typu nie można podpisać — utwórz ją ponownie." };
  }

  const signature = await profileRepository.getSignature(session.user.id);
  if (!signature) {
    return { error: "Brak skanu podpisu — wgraj go w profilu, a potem podpisz operat." };
  }

  try {
    const kcs = computeKcs(valuation.inputs);
    const amountInWords = await worker.amountInWords(kcs.wr);
    const model = buildDocumentModel({
      address: valuation.address,
      area: valuation.area,
      purpose: valuation.purpose as OperatPurpose,
      kwNumber: valuation.kwNumber ?? "",
      client: valuation.client ?? "",
      inspectionDate: valuation.inspectionDate ?? "",
      approvedAt: valuation.approvedAt,
      inputs: valuation.inputs,
      kcs,
      amountInWords,
    });
    const docx = renderOperatDocx(model, { signature: signature.bytes });
    const pdf = await worker.convertToPdf(docx);
    const docxUrl = await storage.put(`operat-${id}-signed.docx`, docx);
    const docUrl = await storage.put(`operat-${id}-signed.pdf`, pdf);

    const updated = await valuationRepository.sign(id, session.user, {
      docUrl,
      docxUrl,
      sha256Docx: sha256(docx),
      sha256Pdf: sha256(pdf),
    });
    if (!updated) {
      return { error: "Nie udało się podpisać wyceny — spróbuj ponownie." };
    }
  } catch (error) {
    if (error instanceof NotSignableError) {
      return { error: "Podpisać można tylko zatwierdzoną wycenę." };
    }
    console.error("signValuationAction failed", error);
    return {
      error:
        "Nie udało się wygenerować podpisanego operatu — worker lub magazyn dokumentów są niedostępne. Spróbuj ponownie.",
    };
  }

  revalidatePath(`/valuations/${id}`);
  revalidatePath("/valuations");
}
```

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter web exec vitest run tests/sign-valuation-action.test.ts tests/approve-valuation-action.test.ts` → PASS.

- [ ] **Step 5: Full gate + commit + push + CI watch**

```bash
git commit -m "feat: sign-valuation action - final render with signature, hashes, cas flip"
```

---

### Task 8: UI — sign button, PODPISANY badge, signed detail view

**Files:**

- Modify: `src/app/valuations/[id]/page.tsx`, `src/app/valuations/[id]/valuation-actions.tsx`, `src/app/valuations/page.tsx`
- Test: `tests/rtl-valuation-actions-sign.test.tsx` (new)

**Interfaces:**

- Consumes: `signValuationAction` (Task 7); `valuation.status/signedAt/docUrl/docxUrl/inputs` from the RSC.
- Produces: `ValuationActions` gains `canSign: boolean` prop; detail + list pages render the signed state.

- [ ] **Step 1: Failing RTL test** — `tests/rtl-valuation-actions-sign.test.tsx` (standard jsdom preamble; mock all five action modules like the existing RTL tests mock theirs)

```tsx
// @vitest-environment jsdom
// (preamble: afterEach(cleanup) + ResizeObserver shim, as in rtl-kw-section.test.tsx)

const signValuationAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/sign-valuation", () => ({ signValuationAction }));
// + verbatim copies of the existing vi.mock blocks for confirm-sample,
// confirm-subject, confirm-kw, confirm-features, approve-valuation.

import { ValuationActions } from "@/app/valuations/[id]/valuation-actions";

const baseProps = {
  id: "v1",
  hasToVerify: false,
  hasSubjectToVerify: false,
  hasKwToVerify: false,
  hasFeaturesToVerify: false,
  gateOk: true,
};

describe("ValuationActions — sign", () => {
  it("shows the sign button only when canSign", () => {
    render(<ValuationActions {...baseProps} canSign />);
    expect(screen.getByRole("button", { name: /podpisz operat/i })).toBeInTheDocument();
    cleanup();
    render(<ValuationActions {...baseProps} canSign={false} />);
    expect(screen.queryByRole("button", { name: /podpisz operat/i })).not.toBeInTheDocument();
  });

  it("fires the action and surfaces its error", async () => {
    signValuationAction.mockResolvedValueOnce({
      error: "Brak skanu podpisu — wgraj go w profilu.",
    });
    render(<ValuationActions {...baseProps} canSign />);
    await userEvent.click(screen.getByRole("button", { name: /podpisz operat/i }));
    expect(await screen.findByText(/brak skanu podpisu/i)).toBeInTheDocument();
  });
});
```

Run → FAIL (`canSign` unknown / button absent).

- [ ] **Step 2: Extend `valuation-actions.tsx`**

Props: add `canSign: boolean`. Import `signValuationAction`. In the button row, after the approve button block:

```tsx
{
  canSign ? (
    <Button
      type="button"
      data-testid="sign-button"
      disabled={isPending}
      onClick={() => run(signValuationAction)}
    >
      {isPending ? "Podpisywanie…" : "Podpisz operat (nieodwracalne)"}
    </Button>
  ) : null;
}
```

- [ ] **Step 3: Extend the detail RSC** — `src/app/valuations/[id]/page.tsx`

Follow the page's existing status rendering (it already branches on `approved` with the approval date). Add:

- status label for `signed`: `Podpisany` + `Podpisano: {formatted signedAt}` (same date formatting the page uses for `approvedAt`);
- **IMPORTANT — the component is a "draft-only action bar" today**: the page renders `ValuationActions` only for drafts. Lift that condition so it renders for the owner in ALL statuses, and update the component doc comment: draft → confirm/approve buttons (existing props), `approved` → sign button (`canSign`), `signed` → new-version button (Task 9). With every `can*`/`has*` prop false it renders an empty div — acceptable;
- compute and pass `canSign={valuation.status === "approved" && Boolean(valuation.inputs) && Boolean(valuation.docxUrl)}` (ownership is already guaranteed for mutations server-side; pass `canSign` only in the owner branch — an admin viewing a foreign valuation gets no action buttons, same as today);
- when `signed`, keep showing the document links (they now point at the `-signed` files via `docUrl`/`docxUrl` — no extra work) and do NOT render the draft action buttons (existing draft-only branch already handles this — verify).

- [ ] **Step 4: List page badge** — `src/app/valuations/page.tsx`: where status renders today (`Szkic`/`Zatwierdzony`), add the `signed` → `Podpisany` case with a visually distinct style (e.g. the page's existing badge classes with a green variant).

- [ ] **Step 5: Run to verify PASS** — `pnpm --filter web exec vitest run tests/rtl-valuation-actions-sign.test.tsx` → PASS.

- [ ] **Step 6: Full gate + commit + push + CI watch**

```bash
git commit -m "feat: sign button and signed status across valuation views"
```

---

### Task 9: UI + action — new version

**Files:**

- Create: `src/app/actions/create-new-version.ts`
- Modify: `src/app/valuations/[id]/page.tsx`, `src/app/valuations/[id]/valuation-actions.tsx`
- Test: `tests/create-new-version-action.test.ts`, extend `tests/rtl-valuation-actions-sign.test.tsx`

**Interfaces:**

- Consumes: `repo.createNewVersion` (Task 5).
- Produces: `createNewVersionAction(id: string): Promise<{ error: string } | undefined>` (redirects to the new draft on success); `ValuationActions` gains `canCreateNewVersion: boolean`; version banners on the detail page.

- [ ] **Step 1: Failing action test** — `tests/create-new-version-action.test.ts` (same mock scaffold as Task 7's test)

```ts
import { createNewVersionAction } from "../src/app/actions/create-new-version";
import { redirect } from "next/navigation"; // mocked — assert calls

describe("createNewVersionAction", () => {
  it("creates the copy and redirects to the new draft", async () => {
    repoMock.createNewVersion.mockResolvedValue({ ...draftFixture, id: "v2" });
    await createNewVersionAction("v1");
    expect(repoMock.createNewVersion).toHaveBeenCalledWith("v1", sessionUser);
    expect(redirect).toHaveBeenCalledWith("/valuations/v2");
  });

  it("maps a status violation to a Polish error", async () => {
    repoMock.createNewVersion.mockRejectedValue(new Error("not signed"));
    const result = await createNewVersionAction("v1");
    expect(result?.error).toMatch(/tylko podpisan/i);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement** — `src/app/actions/create-new-version.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";

export type CreateNewVersionResult = { error: string } | undefined;

/** NFR-3: the ONLY way to "change" a signed valuation — a fresh linked
 * draft; the signed original stays frozen forever (DB trigger). */
export async function createNewVersionAction(id: string): Promise<CreateNewVersionResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  let newId: string;
  try {
    const draft = await valuationRepository.createNewVersion(id, session.user);
    if (!draft) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
    newId = draft.id;
  } catch {
    return { error: "Nową wersję można utworzyć tylko z podpisanego operatu." };
  }
  revalidatePath("/valuations");
  redirect(`/valuations/${newId}`);
}
```

(Note: `redirect` must stay OUTSIDE the try — it throws `NEXT_REDIRECT` internally and a surrounding catch would swallow it.)

- [ ] **Step 3: UI** — `valuation-actions.tsx`: add `canCreateNewVersion: boolean` prop + button (same `run` pattern, label `„Utwórz nową wersję"`; note `createNewVersionAction` redirects on success, so no post-click state needed). Detail page:

- pass `canCreateNewVersion={valuation.status === "signed" && isOwner}`;
- when `valuation.supersedesId` — banner near the header: `Wersja zastępująca operat <Link href={/valuations/${valuation.supersedesId}}>poprzedni operat</Link>.`;
- successor note: in the RSC, after loading the valuation, look up a successor (`listForUser` result already available on the list page — here do a targeted query via existing port: add NOTHING new; instead compute `successor` only when `status === "signed"` by filtering `await valuationRepository.listForUser(session.user)` for `supersedesId === valuation.id`); when found: `Zastąpiony przez <Link href={/valuations/${successor.id}}>nowszą wersję</Link>.`

Extend the RTL test with a `canCreateNewVersion` visibility case mirroring the `canSign` one.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter web exec vitest run tests/create-new-version-action.test.ts tests/rtl-valuation-actions-sign.test.tsx` → PASS.

- [ ] **Step 5: Full gate + commit + push + CI watch**

```bash
git commit -m "feat: create-new-version action, buttons and version banners"
```

---

## Post-plan (S4-S6, outside task loop)

- **S4:** full CI green on main; F-7 suite runs on the CI Postgres service (migrations run there via the existing `drizzle-kit migrate` step — verify 0009 applied in CI logs). e2e must stay green untouched (sign flow not e2e-covered; flags unchanged).
- **S5 (⛔ checkpoint c):** prod deploy order: `railway run` migration 0009 → `vercel deploy --prod`. No worker deploy. No new secrets. Live QA per spec DoD (including raw-SQL tamper attempt on prod + hash verification; do NOT touch "QA S7 …" valuations).
- **S6 (⛔ checkpoint d/e):** wiki PR — builder diff (stage 11), spike 2026-07-19 dir, log/timeline/tech-page/roadmap NOW→DONE + NEXT promotion decision (user), pytania do Anety (parametryzacja rzeczoznawcy w szablonie).
