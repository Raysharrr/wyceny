import { defineConfig } from "@playwright/test";

// Smoke E2E against a real production build (`next start`), real Postgres and
// real worker — mirrors CI. Assumes DB is migrated+seeded and WORKER_URL is
// live before `pnpm e2e` runs (see the `e2e` job in .github/workflows/ci.yml).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
