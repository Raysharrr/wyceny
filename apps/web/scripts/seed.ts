import "dotenv/config";
import { eq } from "drizzle-orm";
import { auth } from "../src/auth/auth";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { resolveSeedUsers, type SeedUser } from "./seed-users";

/**
 * Seeds the two users required by Task 6 (Better Auth + roles):
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
 * Passwords come from the environment (see `seed-users.ts`); this file holds
 * none. That also makes the script the *rotation* tool: re-running it with a
 * new `SEED_*_PASSWORD` sets that password on the existing account.
 *
 * Idempotent: safe to re-run. Creates the user only if the e-mail is new, but
 * always re-asserts both the password and the intended role afterwards — so a
 * previous partial run (or a stale password) converges on the intent.
 */
async function seedUser(seed: SeedUser) {
  const ctx = await auth.$context;
  const hashedPassword = await ctx.password.hash(seed.password);
  const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, seed.email));

  let userId = existing?.id;

  if (!userId) {
    const createdUser = await ctx.internalAdapter.createUser({
      email: seed.email,
      name: seed.name,
      emailVerified: false,
      role: seed.role,
    });
    userId = createdUser.id;
    console.log(`created ${seed.role} ${seed.email}`);
  } else {
    console.log(`${seed.role} ${seed.email} already exists`);
  }

  // Re-assert the password on every run — this is what makes rotation work.
  // `updatePassword` only touches the `credential` account row, so a user
  // left without one by a partial run needs `linkAccount` instead (same
  // branch Better Auth's own reset-password route takes).
  const accounts = await ctx.internalAdapter.findAccounts(userId);
  if (accounts.some((account) => account.providerId === "credential")) {
    await ctx.internalAdapter.updatePassword(userId, hashedPassword);
    console.log(`  password set for ${seed.email}`);
  } else {
    await ctx.internalAdapter.linkAccount({
      userId,
      providerId: "credential",
      accountId: userId,
      password: hashedPassword,
    });
    console.log(`  credential account created for ${seed.email}`);
  }

  // Belt-and-suspenders: re-assert the intended role in case a previous
  // partial run left it wrong.
  await db.update(schema.user).set({ role: seed.role }).where(eq(schema.user.email, seed.email));
}

async function main() {
  // Throws (before touching the DB) if the password variables are unset.
  for (const user of resolveSeedUsers()) {
    await seedUser(user);
  }
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
