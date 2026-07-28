import { describe, expect, it } from "vitest";
// Relative, not `@/` — the alias maps to `src/` only, and this resolver
// deliberately lives in `scripts/` (seed-only tooling, never bundled).
import { resolveSeedUsers } from "../scripts/seed-users";

const BOTH = {
  SEED_ADMIN_PASSWORD: "haslo-admina",
  SEED_APPRAISER_PASSWORD: "haslo-rzeczoznawcy",
};

describe("resolveSeedUsers", () => {
  it("uses exactly the passwords from the environment", () => {
    const users = resolveSeedUsers(BOTH);

    expect(users.map((u) => [u.role, u.email, u.password])).toEqual([
      ["admin", "aneta@wyceny.test", "haslo-admina"],
      ["appraiser", "zenon@wyceny.test", "haslo-rzeczoznawcy"],
    ]);
  });

  it("aborts naming both variables when neither is set", () => {
    // `[\s\S]*` rather than the `s` flag — tsconfig targets ES2017.
    expect(() => resolveSeedUsers({})).toThrow(/SEED_ADMIN_PASSWORD[\s\S]*SEED_APPRAISER_PASSWORD/);
  });

  it("aborts naming only the missing variable", () => {
    let message = "";
    try {
      resolveSeedUsers({ SEED_ADMIN_PASSWORD: "haslo-admina" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("SEED_APPRAISER_PASSWORD");
    expect(message).not.toContain("SEED_ADMIN_PASSWORD");
  });

  it("treats a blank value as missing rather than as a password", () => {
    expect(() => resolveSeedUsers({ ...BOTH, SEED_ADMIN_PASSWORD: "   " })).toThrow(
      /SEED_ADMIN_PASSWORD/,
    );
  });

  it("explains in Polish what to set", () => {
    let message = "";
    try {
      resolveSeedUsers({});
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/zasiew/i);
    expect(message).toMatch(/ustaw/i);
  });

  it("carries no password literal of its own", () => {
    // Kills the "harmless default" mutation at the source: any fallback
    // password written into the resolver would have to appear here.
    const users = resolveSeedUsers({
      SEED_ADMIN_PASSWORD: "a",
      SEED_APPRAISER_PASSWORD: "b",
    });

    expect(users.map((u) => u.password)).toEqual(["a", "b"]);
  });
});
