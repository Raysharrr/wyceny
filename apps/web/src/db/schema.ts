import {
  bigserial,
  customType,
  date,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
  // Rodzaj prawa (T-12, migration 0013): a column like `purpose`, NOT NULL with
  // the pre-block default so every existing valuation stays "własność lokalu".
  propertyRight: text("property_right", {
    enum: ["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"],
  })
    .notNull()
    .default("wlasnosc_lokalu"),
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
  // Slice 14: the address the frozen §8.1 maps were fetched FOR. NULL = no
  // maps frozen. It holds the address rather than a bare flag because the
  // maps are derived from it (geocoder → parcel → bbox → WMS): preview,
  // correct the address, issue without re-fetching, and the signed operat
  // would carry the PREVIOUS parcel's cadastral map and orthophoto.
  mapsFrozenFor: text("maps_frozen_for"),
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

// Rejestr transakcji spółdzielni mieszkaniowych (T-13, migration 0014). The
// office's own transaction base: rows come from XLS imports (`source: xls`)
// or the manual form (`manual`). `price_per_m2` is deliberately NOT a column
// — derived as price_total / area on read, one source of truth. RLS on this
// table (office-level, SELECT-only) lives in the hand-written half of 0014
// and is not mirrored here, same as 0003 for `valuation`.
export const coopTransaction = pgTable(
  "coop_transaction",
  {
    id: text("id").primaryKey(),
    cooperative: text("cooperative").notNull(),
    address: text("address").notNull(),
    buildingNumber: text("building_number").notNull(),
    flatNumber: text("flat_number").notNull(),
    area: numeric("area", { mode: "number" }).notNull(),
    priceTotal: numeric("price_total", { mode: "number" }).notNull(),
    date: date("date").notNull(),
    // transakcyjna | ofertowa | nieustalona — never defaulted (spec §5).
    priceKind: text("price_kind").notNull(),
    // NULL = the register had no such column; never a default (spec §5).
    rightType: text("right_type"),
    rep: text("rep"),
    floor: integer("floor"),
    rooms: integer("rooms"),
    buildYear: integer("build_year"),
    // EPSG:2180; NULL = geocoder failed → "do poprawki", excluded from radius search.
    posX: doublePrecision("pos_x"),
    posY: doublePrecision("pos_y"),
    source: text("source").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    importBatchId: text("import_batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [uniqueIndex("coop_transaction_dedupe").on(t.dedupeKey)],
);

export const coopImportBatch = pgTable("coop_import_batch", {
  id: text("id").primaryKey(),
  cooperative: text("cooperative").notNull(),
  fileName: text("file_name").notNull(),
  mapping: jsonb("mapping").notNull(),
  rowsInserted: integer("rows_inserted").notNull(),
  rowsSkipped: jsonb("rows_skipped").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
});

// "Mapowanie zapamiętamy dla tej spółdzielni" — one remembered column mapping per cooperative.
export const coopColumnMapping = pgTable("coop_column_mapping", {
  cooperative: text("cooperative").primaryKey(),
  mapping: jsonb("mapping").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
