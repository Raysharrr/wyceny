import "dotenv/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests hit the same real Postgres and each calls
    // `migrate()` in `beforeAll`. Drizzle's migrator has no locking, so two
    // test files racing to apply a brand-new migration for the first time
    // can collide (e.g. duplicate `CREATE ROLE`). Running files sequentially
    // avoids that race — safe here since there's no per-file perf pressure.
    fileParallelism: false,
  },
});
