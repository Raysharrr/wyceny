import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import { assertNotSigned } from "../src/domain/valuation";
import type { NewValuationInput, Valuation } from "../src/ports/valuation";

const owner = { id: "user-test-1", role: "appraiser" as const };

const repo = valuationRepo(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db
    .insert(schema.user)
    .values({ id: owner.id, name: "Test Owner", email: "test@example.test", role: owner.role })
    .onConflictDoNothing();
});

afterAll(async () => {
  await pool.end();
});

describe("valuationRepo (integration, real Postgres)", () => {
  it("creates a Valuation and gets it back with the same fields, status in_progress", async () => {
    const input: NewValuationInput = {
      address: "ul. Testowa 1, Warszawa",
      area: 54.3,
      wr: 1044400,
      inputs: null,
      amountInWords: "milion czterdzieści cztery tysiące czterysta złotych",
      docUrl: null,
      ownerId: owner.id,
    };

    const created = await repo.create(input);

    expect(created.id).toBeTruthy();
    expect(created.status).toBe("in_progress");
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created).toMatchObject(input);

    const fetched = await repo.get(created.id, owner);

    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.status).toBe("in_progress");
    expect(fetched).toMatchObject(input);
  });

  it("listForUser returns only valuations owned by that user", async () => {
    const other = { id: "user-test-2", role: "appraiser" as const };
    await db
      .insert(schema.user)
      .values({ id: other.id, name: "Other Owner", email: "other@example.test", role: other.role })
      .onConflictDoNothing();

    const mine = await repo.create({
      address: "ul. Moja 1",
      area: 10,
      wr: 100000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      ownerId: owner.id,
    });
    await repo.create({
      address: "ul. Cudza 2",
      area: 20,
      wr: 200000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      ownerId: other.id,
    });

    const list = await repo.listForUser(owner);

    expect(list.some((w) => w.id === mine.id)).toBe(true);
    expect(list.every((w) => w.ownerId === owner.id)).toBe(true);
  });

  it("throws when assertNotSigned is called on a signed Valuation (write-once, F-7)", async () => {
    const created = await repo.create({
      address: "ul. Podpisana 2, Kraków",
      area: 40,
      wr: 500000,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      ownerId: owner.id,
    });

    // No update/sign method exists (YAGNI) — simulate loading an already-signed
    // Valuation from persistence to prove the domain invariant holds
    // regardless of where the record came from.
    const signed: Valuation = { ...created, status: "signed" };

    expect(() => assertNotSigned(signed)).toThrow();
    expect(() => assertNotSigned(created)).not.toThrow();
  });

  it("persists and returns the KCS inputs snapshot (F-3 at the app level)", async () => {
    const created = await repo.create({
      address: "ul. Kościelna 33A, Poznań",
      area: 71.63,
      wr: 1_044_400,
      inputs: {
        area: 71.63,
        comparables: [{ date: "2024-07", area: 63.27, pricePerM2: 14698.91 }],
        features: [{ name: "standard wykończenia", weight: 1, rating: "lepsza" }],
      },
      amountInWords: null,
      docUrl: null,
      ownerId: owner.id,
    });
    const fetched = await repo.get(created.id, owner);
    expect(fetched?.wr).toBe(1_044_400);
    expect(fetched?.inputs?.comparables[0]?.pricePerM2).toBe(14698.91);
  });
});
