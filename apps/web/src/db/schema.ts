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
import { user } from "./auth-schema";

/** drizzle 0.45 has no native bytea — minimal customType (context7-verified pattern). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// Better Auth owns `user`/`session`/`account`/`verification` (ADR-013). This
// file is `schema:` for both drizzle-kit and the Better Auth Drizzle adapter,
// so all tables live under one `db/*` module and share one migration folder.
// Generated via `pnpm dlx @better-auth/cli generate` from `src/auth/auth.ts`
// (adds the custom `role` field) — regenerate the same way if the Better
// Auth config changes.
export * from "./auth-schema";

// Persistent backing store for PortStorage (Task 11a — replaces the
// in-memory adapter so doc links survive serverless invocations). Stub docs
// are plain text; a future binary/PDF slice should move `content` to object
// storage (e.g. Vercel Blob) behind the same PortStorage interface.
export const document = pgTable("document", {
  key: text("key").primaryKey(),
  // Text stubs (legacy) — exactly one of content/contentBytes is set per row.
  content: text("content"),
  contentBytes: bytea("content_bytes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const valuation = pgTable("valuation", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: text("address").notNull(),
  area: doublePrecision("area").notNull(),
  // ponytail: TS field renamed stubWr→wr, physical column stays "stub_wr" —
  // a real RENAME needs drizzle-kit's interactive prompt; rename rides along
  // with the next schema-reshaping migration.
  // Nullable since Slice 11a (migration 0010): a wizard draft can be saved
  // before step 5 (Kalkulacja) has run — NULL = calculation not yet confirmed.
  wr: doublePrecision("stub_wr"),
  // Full KcsInput snapshot for reproducibility (F-3). NULL = stub-era row.
  inputs: jsonb("inputs"),
  amountInWords: text("amount_in_words"),
  docUrl: text("doc_url"),
  docxUrl: text("docx_url"),
  // Slice 4 document fields — nullable for legacy rows; approval blocks when missing.
  purpose: text("purpose", { enum: ["sprzedaz", "zabezpieczenie_kredytu", "informacyjny"] }),
  kwNumber: text("kw_number"),
  client: text("client"),
  inspectionDate: date("inspection_date"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  status: text("status", { enum: ["in_progress", "approved", "signed"] })
    .notNull()
    .default("in_progress"),
  // Set exactly once by the approve mutation (F-4 gate passed). NULL = draft
  // or legacy signed-era row.
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  // Set exactly once by the sign mutation (F-7). NULL = not signed.
  signedAt: timestamp("signed_at", { withTimezone: true, mode: "date" }),
  // Versioning (NFR-3): the signed valuation this one replaces. NULL = v1.
  supersedesId: uuid("supersedes_id").references((): AnyPgColumn => valuation.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

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
