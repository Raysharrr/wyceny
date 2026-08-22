/**
 * Credentials for the two seeded users (admin + appraiser), resolved from the
 * environment.
 *
 * The e-mails stay in code — they only *identify* the accounts. The passwords
 * deliberately do not: a password committed here is a password that cannot be
 * rotated without a commit, and one that anyone with repo (or git-history)
 * access can use against the deployed app. "Behind the login screen" would
 * then mean "public".
 *
 * There is no default and no fallback on purpose. A fallback would silently
 * recreate the shared, repo-known password this indirection exists to remove —
 * and it would do so exactly when someone forgot to set the variable, i.e.
 * when nobody is looking. Missing variables abort the seed instead.
 *
 * Kept free of any DB/Better Auth import so it stays unit-testable (and so
 * `scripts/seed.ts` has no password literal of its own to fall back to).
 */
export type SeedUserRole = "admin" | "appraiser";

export type SeedUser = {
  role: SeedUserRole;
  name: string;
  email: string;
  password: string;
};

const SEED_USERS = [
  {
    role: "admin",
    name: "Aneta",
    email: "aneta@wyceny.test",
    passwordEnvVar: "SEED_ADMIN_PASSWORD",
  },
  {
    role: "appraiser",
    name: "Zenon",
    email: "zenon@wyceny.test",
    passwordEnvVar: "SEED_APPRAISER_PASSWORD",
  },
  // Testers who review the app on staging (2026-08-22). Same shape as the two
  // above: the address identifies the account, the password comes from the
  // environment so it can be rotated without a commit. `appraiser`, not
  // `admin` — each of them works on their OWN valuations, which is what the
  // reviewers are testing; `admin` additionally sees everyone else's list
  // (valuation-drizzle.ts:36) and would blur exactly that.
  {
    role: "appraiser",
    name: "Łukasz",
    email: "lukasz@wyceny.test",
    passwordEnvVar: "SEED_LUKASZ_PASSWORD",
  },
  {
    role: "appraiser",
    name: "Monika",
    email: "monika@wyceny.test",
    passwordEnvVar: "SEED_MONIKA_PASSWORD",
  },
  {
    role: "appraiser",
    name: "Adam",
    email: "adam@wyceny.test",
    passwordEnvVar: "SEED_ADAM_PASSWORD",
  },
] as const satisfies readonly (Omit<SeedUser, "password"> & { passwordEnvVar: string })[];

export function resolveSeedUsers(
  env: Record<string, string | undefined> = process.env,
): SeedUser[] {
  const missing = SEED_USERS.filter((user) => !env[user.passwordEnvVar]?.trim()).map(
    (user) => user.passwordEnvVar,
  );

  if (missing.length > 0) {
    throw new Error(
      `Zasiew przerwany: brak zmiennych środowiskowych z hasłami: ${missing.join(", ")}.\n` +
        "Ustaw je przed uruchomieniem `pnpm seed` — lokalnie w apps/web/.env " +
        "(plik, który wczytuje `dotenv`, nie .env.local), a na hostingu/w CI " +
        "w zmiennych środowiskowych.\n" +
        "Hasła nie mają wartości domyślnej celowo — nie trzymamy ich w repozytorium, " +
        "żeby dało się je zrotować.",
    );
  }

  return SEED_USERS.map(({ role, name, email, passwordEnvVar }) => ({
    role,
    name,
    email,
    password: env[passwordEnvVar]!,
  }));
}
