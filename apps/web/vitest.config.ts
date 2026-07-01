import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path alias (Next.js
    // resolves this natively; Vite/Vitest need it spelled out). Needed by
    // tests/docs-route.test.ts, which imports the route handler directly —
    // that file, and everything it pulls in, uses `@/...` imports.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
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
