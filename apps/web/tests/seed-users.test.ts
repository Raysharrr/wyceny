import { describe, expect, it } from "vitest";
// Relative, not `@/` — the alias maps to `src/` only, and this resolver
// deliberately lives in `scripts/` (seed-only tooling, never bundled).
import { resolveSeedUsers } from "../scripts/seed-users";

const ALL = {
  SEED_ADMIN_PASSWORD: "haslo-admina",
  SEED_APPRAISER_PASSWORD: "haslo-rzeczoznawcy",
  SEED_LUKASZ_PASSWORD: "haslo-lukasza",
  SEED_MONIKA_PASSWORD: "haslo-moniki",
  SEED_ADAM_PASSWORD: "haslo-adama",
};

describe("resolveSeedUsers", () => {
  it("uses exactly the passwords from the environment", () => {
    const users = resolveSeedUsers(ALL);

    expect(users.map((u) => [u.role, u.email, u.password])).toEqual([
      ["admin", "aneta@wyceny.test", "haslo-admina"],
      ["appraiser", "zenon@wyceny.test", "haslo-rzeczoznawcy"],
      ["appraiser", "lukasz@wyceny.test", "haslo-lukasza"],
      ["appraiser", "monika@wyceny.test", "haslo-moniki"],
      ["appraiser", "adam@wyceny.test", "haslo-adama"],
    ]);
  });

  it("aborts naming every missing variable when none is set", () => {
    // `[\s\S]*` rather than the `s` flag — tsconfig targets ES2017.
    expect(() => resolveSeedUsers({})).toThrow(
      /SEED_ADMIN_PASSWORD[\s\S]*SEED_APPRAISER_PASSWORD[\s\S]*SEED_LUKASZ_PASSWORD[\s\S]*SEED_MONIKA_PASSWORD[\s\S]*SEED_ADAM_PASSWORD/,
    );
  });

  it("aborts naming only the missing variable", () => {
    let message = "";
    try {
      resolveSeedUsers({ ...ALL, SEED_APPRAISER_PASSWORD: undefined });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("SEED_APPRAISER_PASSWORD");
    expect(message).not.toContain("SEED_ADMIN_PASSWORD");
    expect(message).not.toContain("SEED_LUKASZ_PASSWORD");
  });

  it("treats a blank value as missing rather than as a password", () => {
    expect(() => resolveSeedUsers({ ...ALL, SEED_ADMIN_PASSWORD: "   " })).toThrow(
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
      SEED_LUKASZ_PASSWORD: "c",
      SEED_MONIKA_PASSWORD: "d",
      SEED_ADAM_PASSWORD: "e",
    });

    expect(users.map((u) => u.password)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
