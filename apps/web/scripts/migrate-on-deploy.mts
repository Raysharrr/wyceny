/**
 * Applies pending Drizzle migrations during a PRODUCTION Vercel build.
 *
 * Why the build and not a CI job or app startup — the ordering is forced.
 * Drizzle emits an explicit column list in every SELECT, so new code against
 * an old schema does not degrade a feature: every valuation read 500s (list,
 * detail, wizard, approve, sign). The migration must therefore land BEFORE
 * the new code serves traffic. A build step gives that for free — Vercel
 * promotes a deployment only after its build succeeds. A GitHub Actions job
 * starts on the same push as the Vercel build and cannot guarantee it wins;
 * migrating from `instrumentation.ts` would race across cold starts, and
 * drizzle's migrator takes no advisory lock.
 *
 * Two properties this relies on, both deliberate:
 *
 *  1. PREVIEW BUILDS MUST NOT MIGRATE. Vercel builds pull requests against
 *     the same database. Without the `VERCEL_ENV` gate, opening a PR would
 *     migrate the deployed environment. The gate is an explicit check, never
 *     an assumption about which env vars happen to be set.
 *  2. A FAILED MIGRATION MUST FAIL THE BUILD. `drizzle-kit migrate` exits
 *     non-zero, this script propagates it, and Vercel then deploys nothing —
 *     so code that needs a migration can never ship without it. The two
 *     travel together or neither does.
 *
 * What this does NOT make safe: a DESTRUCTIVE migration (DROP/RENAME COLUMN).
 * It is applied while the OLD code is still live, so it breaks production the
 * moment the build reaches it. Those need expand/contract — add, deploy code
 * that reads both, remove in a LATER deployment — which is a human decision
 * no runner can enforce.
 */
import { execFileSync } from "node:child_process";

const env = process.env.VERCEL_ENV;

// Anything that is not a production build leaves the database alone: preview
// builds, local `pnpm build`, CI. Silence and exit 0 — this is the expected
// path for most builds, not a warning.
if (env !== "production") {
  console.log(`[migrate-on-deploy] VERCEL_ENV=${env ?? "<unset>"} — pomijam migracje.`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  // Reaching here means a production build with no database configured. Do
  // not shrug it off: the build would otherwise succeed and ship code whose
  // schema was never applied.
  console.error("[migrate-on-deploy] VERCEL_ENV=production, ale brak DATABASE_URL — przerywam.");
  process.exit(1);
}

console.log("[migrate-on-deploy] production build — stosuję migracje Drizzle…");
execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], { stdio: "inherit" });
console.log("[migrate-on-deploy] migracje zastosowane.");
