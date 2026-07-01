import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { wycenyRepo } from "../src/adapters/wyceny-drizzle";
import { assertNotSigned } from "../src/domain/wycena";
import type { NewWycenaInput, Wycena } from "../src/ports/wyceny";

const owner = { id: "user-test-1", role: "rzeczoznawca" as const };

const repo = wycenyRepo(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db
    .insert(schema.users)
    .values({ id: owner.id, email: "test@example.test", role: owner.role })
    .onConflictDoNothing();
});

afterAll(async () => {
  await pool.end();
});

describe("wycenyRepo (integration, real Postgres)", () => {
  it("creates a Wycena and gets it back with the same fields, status w_toku", async () => {
    const input: NewWycenaInput = {
      address: "ul. Testowa 1, Warszawa",
      area: 54.3,
      stubWr: 1044400,
      slownie: "milion czterdzieści cztery tysiące czterysta złotych",
      docUrl: null,
      ownerId: owner.id,
    };

    const created = await repo.create(input);

    expect(created.id).toBeTruthy();
    expect(created.status).toBe("w_toku");
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created).toMatchObject(input);

    const fetched = await repo.get(created.id, owner);

    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.status).toBe("w_toku");
    expect(fetched).toMatchObject(input);
  });

  it("listForUser returns only wyceny owned by that user", async () => {
    const other = { id: "user-test-2", role: "rzeczoznawca" as const };
    await db
      .insert(schema.users)
      .values({ id: other.id, email: "other@example.test", role: other.role })
      .onConflictDoNothing();

    const mine = await repo.create({
      address: "ul. Moja 1",
      area: 10,
      stubWr: 100000,
      slownie: null,
      docUrl: null,
      ownerId: owner.id,
    });
    await repo.create({
      address: "ul. Cudza 2",
      area: 20,
      stubWr: 200000,
      slownie: null,
      docUrl: null,
      ownerId: other.id,
    });

    const list = await repo.listForUser(owner);

    expect(list.some((w) => w.id === mine.id)).toBe(true);
    expect(list.every((w) => w.ownerId === owner.id)).toBe(true);
  });

  it("throws when assertNotSigned is called on a podpisany Wycena (write-once, F-7)", async () => {
    const created = await repo.create({
      address: "ul. Podpisana 2, Kraków",
      area: 40,
      stubWr: 500000,
      slownie: null,
      docUrl: null,
      ownerId: owner.id,
    });

    // No update/sign method exists (YAGNI) — simulate loading an already-signed
    // Wycena from persistence to prove the domain invariant holds regardless
    // of where the record came from.
    const signed: Wycena = { ...created, status: "podpisany" };

    expect(() => assertNotSigned(signed)).toThrow();
    expect(() => assertNotSigned(created)).not.toThrow();
  });
});
