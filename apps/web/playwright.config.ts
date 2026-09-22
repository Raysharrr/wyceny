import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./e2e/storage-state";

// Smoke E2E against a real production build (`next start`), real Postgres and
// real worker — mirrors CI. Assumes DB is migrated+seeded and WORKER_URL is
// live before `pnpm e2e` runs (see the `e2e` job in .github/workflows/ci.yml).
/**
 * The smoke BINDS this port, and 3000 is where a developer's own dev server
 * already is. `E2E_PORT` moves the server, the health check and `baseURL`
 * together — three places that silently have to agree, and where disagreeing
 * looks like a product failure rather than a misconfiguration. Unset means
 * 3000, so CI is byte-for-byte what it was.
 *
 * It also matters for `webServer.env` below: with 3000 occupied,
 * `reuseExistingServer` would hand the run whatever server is already there,
 * carrying whatever env IT was started with — including a live Geoportal.
 */
const port = process.env.E2E_PORT ?? "3000";
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
// `E2E_BASE_URL` set = we are pointed at a running host (staging, or a local
// server started by hand) — Playwright must not start (or reuse) its own.
const remote = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // One retry in CI only (a chunked import over a real host can hiccup);
  // locally a flaky test should fail loudly.
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  projects: [
    // Historic smoke (admin account, logs in itself) — unchanged.
    { name: "smoke", testMatch: /smoke\.spec\.ts/ },
    // Blok „Prawo spółdzielcze”: one login per run, then the spec.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "spoldzielcze",
      testMatch: /spoldzielcze\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: STORAGE_STATE },
    },
    // Manual, never in CI: zrzuty stanów karty KW do opisu PR (b1-kw-read).
    // Wymaga serwera zbudowanego z NEXT_PUBLIC_WORKER_URL wskazującym na atrapę
    // workera — patrz komentarz w e2e/kw-read-zrzuty.spec.ts.
    {
      name: "zrzuty",
      testMatch: /kw-read-zrzuty\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: STORAGE_STATE },
    },
    // Manual, never in CI: `pnpm e2e:staging` — only tests tagged @staging-safe
    // (no approval, no large uploads, synthetic data with a per-run suffix).
    {
      name: "staging",
      testMatch: /spoldzielcze\.spec\.ts/,
      dependencies: ["setup"],
      grep: /@staging-safe/,
      use: { storageState: STORAGE_STATE },
    },
  ],
  webServer: remote
    ? undefined
    : {
        command: `pnpm start --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // Belt-and-suspenders alongside the CI workflow's job-level env: keeps
        // the auto-fetch off if someone runs `pnpm start` locally with a build
        // that already baked in the guard (see subject-form.tsx's
        // `onAddressBlur`). NEXT_PUBLIC_* is inlined at `next build` time, so
        // this alone does NOT retroactively disable a build made without it.
        // Same rationale for the KW upload flow (see kw-section.tsx's
        // `uploadEnabled` guard), the inspection photo upload flow (see
        // inspection-section.tsx's `uploadEnabled` guard) and the step-6 prose
        // generator (see step-descriptions.tsx) — that last one also keeps the
        // smoke from spending LLM tokens.
        env: {
          NEXT_PUBLIC_SUBJECT_AUTOFETCH: "off",
          NEXT_PUBLIC_PHOTO_UPLOAD: "off",
          NEXT_PUBLIC_PROSE: "off",
          // Slice 3: keeps Street View thumbnails/iframe off so the smoke stays network-free and key-free.
          NEXT_PUBLIC_STREET_VIEW: "off",
          // Runtime (not NEXT_PUBLIC_), read by the approve action via `_deps.ts`.
          // CI sets it job-wide; without it a LOCAL run takes the live-Geoportal
          // path CI never exercises, and approve fails with a 502 that looks like
          // a regression and is not one. Applies only when Playwright starts the
          // server — a reused one carries whatever env it was launched with.
          MAPS_FETCH: "off",
        },
      },
});
