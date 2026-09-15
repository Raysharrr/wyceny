import "dotenv/config";
import { eq } from "drizzle-orm";
import { auth } from "../src/auth/auth";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { resolveSeedUsers, type SeedUser } from "./seed-users";
import { insurancePageKey, insurancePrefix } from "../src/domain/insurance-doc";

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

/**
 * A 16x22 white JPEG — a placeholder "policy page", not a document. It exists
 * so the seeded `insurance_doc_key` points at a prefix that really holds a
 * page: a key with nothing under it is the inconsistent state the upload
 * action refuses to create, and the seed must not be the one place that
 * fabricates it.
 */
const SEEDED_POLICY_PAGE_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKT/wAARCAAWABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKQAAAH/2Q==";

/**
 * A complete appraiser profile for the automated runs (ADR-020 cz. 1). Without
 * it B-15/B-16 block every approval, and the e2e specs — which walk a draft all
 * the way to "Zatwierdzony" — fail on a gate that is doing its job.
 *
 * Behind an EXPLICIT flag, and this is the whole point of the flag: the same
 * `pnpm seed` is the password-rotation tool for STAGING, where these addresses
 * belong to people who really sign operaty. Writing an invented name and
 * licence number into a working appraiser's profile would hand B-15/B-16 a
 * false "complete" and let a document leave the building under a licence
 * number that does not exist — precisely the failure ADR-020 was written to
 * end. CI sets `SEED_E2E_PROFILE=1`; nothing else may.
 *
 * `onConflictDoNothing` on top: even under the flag, a profile somebody has
 * already filled in is never overwritten.
 */
async function seedE2eProfile(userId: string, name: string) {
  const docKey = insurancePrefix(userId, "seed");
  await db
    .insert(schema.document)
    .values({
      key: insurancePageKey(docKey, 0),
      content: null,
      contentBytes: Buffer.from(SEEDED_POLICY_PAGE_JPEG, "base64"),
    })
    .onConflictDoNothing();
  await db
    .insert(schema.appraiserProfile)
    .values({
      userId,
      fullName: `${name} — konto testowe`,
      // Fikcyjne: nie jest to numer uprawnień żadnej istniejącej osoby.
      licenseNo: "0000",
      officeBlock: "Biuro Wycen Testowe\nul. Przykładowa 1\n60-000 Poznań",
      insuranceDocKey: docKey,
      // Daleka data celowo: bramka porównuje z DZISIEJSZĄ, więc realistyczny
      // rok zaczerwieniłby e2e w dniu wygaśnięcia, bez żadnej zmiany w kodzie.
      insuranceValidUntil: "2099-12-31",
    })
    .onConflictDoNothing();
  console.log(`  e2e profile ensured for ${name}`);
}

async function main() {
  // Throws (before touching the DB) if the password variables are unset.
  const users = resolveSeedUsers();
  for (const user of users) {
    await seedUser(user);
  }
  if (process.env.SEED_E2E_PROFILE === "1") {
    for (const user of users) {
      const [row] = await db.select().from(schema.user).where(eq(schema.user.email, user.email));
      if (row) await seedE2eProfile(row.id, user.name);
    }
  }
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
