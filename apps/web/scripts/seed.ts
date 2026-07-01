import "dotenv/config";
import { eq } from "drizzle-orm";
import { auth } from "../src/auth/auth";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";

/**
 * Seeds the two demo users required by Task 6 (Better Auth + roles):
 * one `admin` (Aneta) and one `rzeczoznawca` (Zenon). Uses Better Auth's
 * own sign-up API so passwords are hashed exactly as at real sign-in time.
 *
 * Idempotent: safe to re-run. Skips sign-up if the email already exists,
 * and always re-asserts the intended role afterwards (in case a previous
 * partial run left the wrong role, or the account default changes).
 *
 * Demo credentials (local/dev only — not for production data):
 *   admin:        aneta@wyceny.test / Admin123!
 *   rzeczoznawca: zenon@wyceny.test / Rzeczoznawca123!
 */
const DEMO_USERS = [
  {
    role: "admin" as const,
    name: "Aneta",
    email: "aneta@wyceny.test",
    password: "Admin123!",
  },
  {
    role: "rzeczoznawca" as const,
    name: "Zenon",
    email: "zenon@wyceny.test",
    password: "Rzeczoznawca123!",
  },
];

async function seedUser(demo: (typeof DEMO_USERS)[number]) {
  const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, demo.email));

  if (!existing) {
    await auth.api.signUpEmail({
      body: { name: demo.name, email: demo.email, password: demo.password },
    });
    console.log(`created ${demo.role} ${demo.email}`);
  } else {
    console.log(`${demo.role} ${demo.email} already exists, skipping sign-up`);
  }

  // Sign-up always lands on the additionalFields default ("rzeczoznawca");
  // re-assert the intended role explicitly so re-runs stay correct.
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
