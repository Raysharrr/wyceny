import { doublePrecision, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Task 6: reconcile with Better Auth user schema
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
});

export const wycena = pgTable("wycena", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: text("address").notNull(),
  area: doublePrecision("area").notNull(),
  stubWr: doublePrecision("stub_wr").notNull(),
  slownie: text("slownie"),
  docUrl: text("doc_url"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  status: text("status", { enum: ["w_toku", "podpisany"] })
    .notNull()
    .default("w_toku"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
