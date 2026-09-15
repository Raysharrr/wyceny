import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { profileRepo } from "../src/adapters/profile-drizzle";

const USER = "user-profile-test";
/** Own row: the author/insurance writes below must not disturb the signature test. */
const AUTHOR_USER = "user-profile-author-test";
const repo = profileRepo(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db
    .insert(schema.user)
    .values(
      [USER, AUTHOR_USER].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
        role: "appraiser" as const,
      })),
    )
    .onConflictDoNothing();
  // The rows outlive the run (one long-lived local Postgres), and the tests
  // below assert on ABSENT columns — a scan left by the previous run would
  // make "author data but no scan" pass or fail depending on history.
  await db
    .delete(schema.appraiserProfile)
    .where(inArray(schema.appraiserProfile.userId, [USER, AUTHOR_USER]));
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

  /**
   * `0017` drops the NOT NULL on both signature columns so the author data can
   * be saved first. `getSignature` must keep answering `null` for such a row —
   * a row-exists check alone would hand `{ bytes: null }` to the `<img>` on
   * /profile and to the sign action's "scan required" guard (ADR-020 reg. 2).
   */
  it("returns null for a profile row that carries author data but no scan", async () => {
    await repo.saveAuthor(AUTHOR_USER, {
      fullName: "Jan Testowy",
      licenseNo: "0000",
      officeBlock: "Biuro Testowe\nul. Przykładowa 1",
    });
    expect(await repo.getSignature(AUTHOR_USER)).toBeNull();
  });
});

describe("profileRepo author and insurance (ADR-020 reg. 1)", () => {
  it("returns null when the appraiser has no profile row at all", async () => {
    expect(await repo.get("user-without-profile")).toBeNull();
  });

  it("stores and returns author data, insurance key and validity", async () => {
    await repo.saveAuthor(AUTHOR_USER, {
      fullName: "Anna Przykładowa",
      licenseNo: "1234",
      officeBlock: "Biuro Wycen Przykład\nul. Testowa 7\n60-000 Poznań",
    });
    await repo.saveInsurance(AUTHOR_USER, {
      docKey: "polisa/user-profile-author-test/abc123",
      validUntil: "2027-01-31",
    });
    const profile = await repo.get(AUTHOR_USER);
    expect(profile).toEqual({
      fullName: "Anna Przykładowa",
      licenseNo: "1234",
      officeBlock: "Biuro Wycen Przykład\nul. Testowa 7\n60-000 Poznań",
      insuranceDocKey: "polisa/user-profile-author-test/abc123",
      insuranceValidUntil: "2027-01-31",
    });
  });

  /** The two writes touch disjoint columns — neither may blank the other's. */
  it("keeps the signature when author data is saved, and vice versa", async () => {
    await repo.saveSignature(AUTHOR_USER, Buffer.from("scan"), "image/png");
    await repo.saveAuthor(AUTHOR_USER, {
      fullName: "Anna Przykładowa",
      licenseNo: "1234",
      officeBlock: "Biuro Wycen Przykład",
    });
    expect((await repo.getSignature(AUTHOR_USER))!.bytes.toString()).toBe("scan");
    expect((await repo.get(AUTHOR_USER))!.fullName).toBe("Anna Przykładowa");
  });

  it("reads an existing signature-only profile with empty author fields", async () => {
    const profile = await repo.get(USER);
    expect(profile).toEqual({
      fullName: null,
      licenseNo: null,
      officeBlock: null,
      insuranceDocKey: null,
      insuranceValidUntil: null,
    });
  });
});
