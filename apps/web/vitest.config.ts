import "dotenv/config";
import { fileURLToPath } from "node:url";
import mdx from "@mdx-js/rollup";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    // Next builds `.mdx` through `@next/mdx`; vitest has its own pipeline and
    // would hand the file to rolldown, which fails on `Invalid Character '#'`.
    // Needed by tests/help-manifest.test.ts, which really imports every help
    // page — the only automated guard against a mistyped `import("./….mdx")`
    // in the manifest (dependency-cruiser has no `no-unresolved` rule).
    // `enforce: "pre"` claims the file before Vite's own transform; the
    // explicit `include` keeps this off `.md` (the plugin default is
    // `/\.mdx?$/`) so nothing else in the suite changes shape.
    { enforce: "pre", ...mdx({ include: /\.mdx$/ }) },
  ],
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
