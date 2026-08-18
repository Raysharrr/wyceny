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
      NEXT_PUBLIC_KW_UPLOAD: "off",
      NEXT_PUBLIC_PHOTO_UPLOAD: "off",
      NEXT_PUBLIC_PROSE: "off",
      // Runtime (not NEXT_PUBLIC_), read by the approve action via `_deps.ts`.
      // CI sets it job-wide; without it a LOCAL run takes the live-Geoportal
      // path CI never exercises, and approve fails with a 502 that looks like
      // a regression and is not one. Applies only when Playwright starts the
      // server — a reused one carries whatever env it was launched with.
      MAPS_FETCH: "off",
    },
  },
});
