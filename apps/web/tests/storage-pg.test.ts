import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import { pgStorage } from "../src/adapters/storage-pg";

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await pool.end();
});

describe("PortStorage — Postgres adapter (Task 11a)", () => {
  it("put() stores content and returns a URL; get() round-trips the content", async () => {
    const storage = pgStorage(db);
    const content = "<stub operat content, pg-backed>";

    const url = await storage.put("doc-pg-1", content);
    expect(url).toBe("/api/docs/doc-pg-1");

    const buf = await storage.get("doc-pg-1");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe(content);
  });

  it("put() on an existing key upserts (overwrites) the content", async () => {
    const storage = pgStorage(db);

    await storage.put("doc-pg-2", "first version");
    await storage.put("doc-pg-2", "second version");

    const buf = await storage.get("doc-pg-2");
    expect(buf.toString()).toBe("second version");
  });

  it("get() on a missing key rejects", async () => {
    const storage = pgStorage(db);
    await expect(storage.get("does-not-exist-pg")).rejects.toThrow();
  });

  it("stores and returns binary content byte-identical (bytea path)", async () => {
    const storage = pgStorage(db);
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0x01]); // "%PDF-" + binary
    const url = await storage.put("binary-roundtrip.pdf", bytes);
    expect(url).toBe("/api/docs/binary-roundtrip.pdf");
    const back = await storage.get("binary-roundtrip.pdf");
    expect(Buffer.compare(back, bytes)).toBe(0);
  });

  it("overwrites text with binary on upsert (retry path)", async () => {
    const storage = pgStorage(db);
    await storage.put("upsert-key.pdf", "old text");
    const bytes = Buffer.from([1, 2, 3]);
    await storage.put("upsert-key.pdf", bytes);
    const back = await storage.get("upsert-key.pdf");
    expect(Buffer.compare(back, bytes)).toBe(0);
  });
});
