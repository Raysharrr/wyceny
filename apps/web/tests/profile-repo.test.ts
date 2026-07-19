import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { profileRepo } from "../src/adapters/profile-drizzle";

const USER = "user-profile-test";
const repo = profileRepo(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db
    .insert(schema.user)
    .values({ id: USER, name: USER, email: `${USER}@example.test`, role: "appraiser" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await pool.end();
});

describe("profileRepo signature roundtrip", () => {
  it("returns null when no scan was uploaded", async () => {
    expect(await repo.getSignature("user-without-profile")).toBeNull();
  });

  it("stores and returns the scan; re-upload replaces it", async () => {
    await repo.saveSignature(USER, Buffer.from("png-v1"), "image/png");
    const first = await repo.getSignature(USER);
    expect(first!.bytes.toString()).toBe("png-v1");
    expect(first!.mime).toBe("image/png");
    await repo.saveSignature(USER, Buffer.from("jpeg-v2"), "image/jpeg");
    const second = await repo.getSignature(USER);
    expect(second!.bytes.toString()).toBe("jpeg-v2");
    expect(second!.mime).toBe("image/jpeg");
  });
});
