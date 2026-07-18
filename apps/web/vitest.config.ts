import "dotenv/config";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

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
    // Global environment stays "node" — most tests (integration, contract,
    // schema) need no DOM and node is faster to spin up. Component/RTL tests
    // opt into jsdom per-file via a `// @vitest-environment jsdom` pragma
    // (e.g. tests/rtl-*.test.tsx), so we never pay jsdom's cost fleet-wide.
    environment: "node",
    // Integration tests hit the same real Postgres and each calls
    // `migrate()` in `beforeAll`. Drizzle's migrator has no locking, so two
    // test files racing to apply a brand-new migration for the first time
    // can collide (e.g. duplicate `CREATE ROLE`). Running files sequentially
    // avoids that race — safe here since there's no per-file perf pressure.
    fileParallelism: false,
    // e2e/*.spec.ts are Playwright specs (run via `pnpm e2e`, not vitest) —
    // Playwright's test() isn't compatible with vitest's runner, and
    // without this exclude vitest's default *.spec.ts glob picks them up
    // and fails with "Playwright Test did not expect test() to be called
    // here".
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
