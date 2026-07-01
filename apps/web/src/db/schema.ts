import { doublePrecision, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// Better Auth owns `user`/`session`/`account`/`verification` (ADR-013). This
// file is `schema:` for both drizzle-kit and the Better Auth Drizzle adapter,
// so all tables live under one `db/*` module and share one migration folder.
// Generated via `pnpm dlx @better-auth/cli generate` from `src/auth/auth.ts`
// (adds the custom `role` field) — regenerate the same way if the Better
// Auth config changes.
export * from "./auth-schema";

export const wycena = pgTable("wycena", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: text("address").notNull(),
  area: doublePrecision("area").notNull(),
  stubWr: doublePrecision("stub_wr").notNull(),
  slownie: text("slownie"),
  docUrl: text("doc_url"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  status: text("status", { enum: ["w_toku", "podpisany"] })
    .notNull()
    .default("w_toku"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
