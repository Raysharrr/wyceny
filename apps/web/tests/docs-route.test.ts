import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { wycenyRepo } from "../src/adapters/wyceny-drizzle";
import { pgStorage } from "../src/adapters/storage-pg";
import type { SessionUser } from "../src/ports/wyceny";

/**
 * Ownership auth gate on `/api/docs/[key]` (Task 11a). `getSession` reads
 * `next/headers`, which has no meaning outside a real Next.js request — so
 * it's mocked here, and everything downstream of it (repo lookup, storage
 * read) runs for real against Postgres, proving the ownership gate itself
 * blocks, not just that the happy path works.
 */
const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/auth/session", () => ({ getSession: getSessionMock }));

const { GET } = await import("../src/app/api/docs/[key]/route");

const rzeczoznawcaA: SessionUser = { id: "user-docs-a", role: "rzeczoznawca" };
const rzeczoznawcaB: SessionUser = { id: "user-docs-b", role: "rzeczoznawca" };
const admin: SessionUser = { id: "user-docs-admin", role: "admin" };

const repo = wycenyRepo(db);
const storage = pgStorage(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  for (const u of [rzeczoznawcaA, rzeczoznawcaB, admin]) {
    await db
      .insert(schema.user)
      .values({ id: u.id, name: u.id, email: `${u.id}@example.test`, role: u.role })
      .onConflictDoNothing();
  }
});

afterAll(async () => {
  await pool.end();
});

function paramsFor(key: string) {
  return { params: Promise.resolve({ key }) };
}

describe("/api/docs/[key] — access control (Task 11a)", () => {
  it("no session -> 401", async () => {
    getSessionMock.mockResolvedValue(null);

    const res = await GET(new Request("http://test/api/docs/anything"), paramsFor("anything"));

    expect(res.status).toBe(401);
  });

  it("owner (A) -> 200 + correct content; another rzeczoznawca (B) -> 404 (not found, not 'not yours'); admin -> 200", async () => {
    const key = "doc-route-1";
    const content = "Operat (stub) — dokument nalezacy do A";
    const docUrl = await storage.put(key, content);

    await repo.create({
      address: "ul. Docs-Route 1",
      area: 12,
      stubWr: 120000,
      slownie: null,
      docUrl,
      ownerId: rzeczoznawcaA.id,
    });

    const request = new Request(`http://test${docUrl}`);

    getSessionMock.mockResolvedValue({ user: rzeczoznawcaA });
    const resA = await GET(request, paramsFor(key));
    expect(resA.status).toBe(200);
    expect(await resA.text()).toBe(content);

    getSessionMock.mockResolvedValue({ user: rzeczoznawcaB });
    const resB = await GET(request, paramsFor(key));
    expect(resB.status).toBe(404);

    getSessionMock.mockResolvedValue({ user: admin });
    const resAdmin = await GET(request, paramsFor(key));
    expect(resAdmin.status).toBe(200);
    expect(await resAdmin.text()).toBe(content);
  });

  it("a key with no owning Wycena visible to the caller -> 404, even with a valid session", async () => {
    getSessionMock.mockResolvedValue({ user: rzeczoznawcaA });

    const res = await GET(new Request("http://test/api/docs/never-created"), paramsFor("never-created"));

    expect(res.status).toBe(404);
  });
});
