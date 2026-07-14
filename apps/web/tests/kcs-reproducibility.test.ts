import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import { computeKcs, type KcsInput } from "../src/domain/kcs";
import type { SessionUser } from "../src/ports/valuation";

// Style/setup mirrors valuation-repo.test.ts — real DB, no network.
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/koscielna.json", import.meta.url)), "utf8"),
) as { input: KcsInput };

const owner: SessionUser = { id: "user-test-kcs-owner", role: "appraiser" };
const adminUser: SessionUser = { id: "user-test-kcs-admin", role: "admin" };

const repo = valuationRepo(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  for (const u of [owner, adminUser]) {
    await db
      .insert(schema.user)
      .values({ id: u.id, name: u.id, email: `${u.id}@example.test`, role: u.role })
      .onConflictDoNothing();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("F-3: stored inputs snapshot reproduces the stored WR", () => {
  it("create → read inputs → recompute === stored wr", async () => {
    const wr = computeKcs(fixture.input).wr;
    const created = await repo.create({
      address: "ul. Kościelna 33A, Poznań",
      area: fixture.input.area,
      wr,
      inputs: fixture.input,
      amountInWords: null,
      docUrl: null,
      ownerId: owner.id,
    });
    const fetched = await repo.get(created.id, adminUser);
    expect(fetched?.inputs).toBeTruthy();
    expect(computeKcs(fetched!.inputs!).wr).toBe(fetched!.wr);
    expect(fetched!.wr).toBe(1_044_400);
  });
});

describe("F-5: sample snapshot provenance round-trips (RCN comparables + sampleMeta)", () => {
  it("create → read: comparables keep source/transactionId, sampleMeta.fetchedAt exists, length >= 12", async () => {
    const sampleMeta = {
      lat: 52.4064,
      lon: 16.9252,
      fetchedAt: "2026-07-14T09:00:00.000Z",
      source: "rcn-wfs-gugik",
      query: { bbox: [52.39, 16.9, 52.42, 16.95], count: 5000, sort: "dok_data D" },
    };
    const comparables = fixture.input.comparables.map((c, i) => ({
      ...c,
      source: "rcn" as const,
      transactionId: `koscielna-${i}`,
    }));
    const input: KcsInput = { ...fixture.input, comparables, sampleMeta };

    const wr = computeKcs(input).wr;
    const created = await repo.create({
      address: "ul. Kościelna 33A, Poznań",
      area: input.area,
      wr,
      inputs: input,
      amountInWords: null,
      docUrl: null,
      ownerId: owner.id,
    });

    const fetched = await repo.get(created.id, adminUser);
    expect(fetched?.inputs).toBeTruthy();
    const fetchedInputs = fetched!.inputs!;
    expect(fetchedInputs.comparables.length).toBeGreaterThanOrEqual(12);
    for (const c of fetchedInputs.comparables) {
      expect(c.source).toBe("rcn");
      expect(c.transactionId).toBeTruthy();
    }
    expect(fetchedInputs.sampleMeta?.fetchedAt).toBe(sampleMeta.fetchedAt);
  });
});
