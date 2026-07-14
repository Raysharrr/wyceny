import { doublePrecision, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

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
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const valuation = pgTable("valuation", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: text("address").notNull(),
  area: doublePrecision("area").notNull(),
  // ponytail: TS field renamed stubWr→wr, physical column stays "stub_wr" —
  // a real RENAME needs drizzle-kit's interactive prompt; rename rides along
  // with the next schema-reshaping migration.
  wr: doublePrecision("stub_wr").notNull(),
  // Full KcsInput snapshot for reproducibility (F-3). NULL = stub-era row.
  inputs: jsonb("inputs"),
  amountInWords: text("amount_in_words"),
  docUrl: text("doc_url"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  status: text("status", { enum: ["in_progress", "approved", "signed"] })
    .notNull()
    .default("in_progress"),
  // Set exactly once by the approve mutation (F-4 gate passed). NULL = draft
  // or legacy signed-era row.
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
