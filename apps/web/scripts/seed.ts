import "dotenv/config";
import { eq } from "drizzle-orm";
import { auth } from "../src/auth/auth";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";

/**
 * Seeds the two demo users required by Task 6 (Better Auth + roles):
 * one `admin` (Aneta) and one `appraiser` (Zenon).
 *
 * Public sign-up is disabled (`emailAndPassword.disableSignUp: true` in
 * `auth.ts` — closed system, ADR-013): `POST /api/auth/sign-up/email` is
 * closed to the public, and per Better Auth's own `sign-up/email` route
 * source, `disableSignUp` gates the *shared* endpoint handler that also
 * backs `auth.api.signUpEmail(...)`, so that server-side call is blocked
 * too. Instead this creates the user + credential account directly via
 * Better Auth's internal adapter (`auth.$context`), hashing the password
 * with Better Auth's OWN hasher (`ctx.password.hash`) — the same hasher
 * `signUpEmail` uses internally — so the resulting hash is login-compatible.
 * No hand-rolled hashing.
 *
 * Idempotent: safe to re-run. Skips creation if the email already exists,
 * and always re-asserts the intended role afterwards (in case a previous
 * partial run left the wrong role, or the account default changes).
 *
 * Demo credentials (local/dev only — not for production data):
 *   admin:     aneta@wyceny.test / Admin123!
 *   appraiser: zenon@wyceny.test / Rzeczoznawca123!
 */
const DEMO_USERS = [
  {
    role: "admin" as const,
    name: "Aneta",
    email: "aneta@wyceny.test",
    password: "Admin123!",
  },
  {
    role: "appraiser" as const,
    name: "Zenon",
    email: "zenon@wyceny.test",
    password: "Rzeczoznawca123!",
  },
];

async function seedUser(demo: (typeof DEMO_USERS)[number]) {
  const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, demo.email));

  if (!existing) {
    const ctx = await auth.$context;
    const hashedPassword = await ctx.password.hash(demo.password);
    const createdUser = await ctx.internalAdapter.createUser({
      email: demo.email,
      name: demo.name,
      emailVerified: false,
      role: demo.role,
    });
    await ctx.internalAdapter.linkAccount({
      userId: createdUser.id,
      providerId: "credential",
      accountId: createdUser.id,
      password: hashedPassword,
    });
    console.log(`created ${demo.role} ${demo.email}`);
  } else {
    console.log(`${demo.role} ${demo.email} already exists, skipping creation`);
  }

  // Belt-and-suspenders: re-assert the intended role in case a previous
  // partial run left it wrong.
  await db.update(schema.user).set({ role: demo.role }).where(eq(schema.user.email, demo.email));
}

async function main() {
  for (const demo of DEMO_USERS) {
    await seedUser(demo);
  }
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
