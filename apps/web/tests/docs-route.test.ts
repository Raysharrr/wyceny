import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import { pgStorage } from "../src/adapters/storage-pg";
import type { SessionUser } from "../src/ports/valuation";

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

const appraiserA: SessionUser = { id: "user-docs-a", role: "appraiser" };
const appraiserB: SessionUser = { id: "user-docs-b", role: "appraiser" };
const admin: SessionUser = { id: "user-docs-admin", role: "admin" };

const repo = valuationRepo(db);
const storage = pgStorage(db);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  for (const u of [appraiserA, appraiserB, admin]) {
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

  it("owner (A) -> 200 + correct content; another appraiser (B) -> 404 (not found, not 'not yours'); admin -> 200", async () => {
    const key = "doc-route-1";
    const content = "Operat (stub) — dokument nalezacy do A";
    const docUrl = await storage.put(key, content);

    await repo.create({
      address: "ul. Docs-Route 1",
      area: 12,
      wr: 120000,
      inputs: null,
      amountInWords: null,
      docUrl,
      ownerId: appraiserA.id,
    });

    const request = new Request(`http://test${docUrl}`);

    getSessionMock.mockResolvedValue({ user: appraiserA });
    const resA = await GET(request, paramsFor(key));
    expect(resA.status).toBe(200);
    expect(await resA.text()).toBe(content);

    getSessionMock.mockResolvedValue({ user: appraiserB });
    const resB = await GET(request, paramsFor(key));
    expect(resB.status).toBe(404);

    getSessionMock.mockResolvedValue({ user: admin });
    const resAdmin = await GET(request, paramsFor(key));
    expect(resAdmin.status).toBe(200);
    expect(await resAdmin.text()).toBe(content);
  });

  it("a key with no owning Valuation visible to the caller -> 404, even with a valid session", async () => {
    getSessionMock.mockResolvedValue({ user: appraiserA });

    const res = await GET(
      new Request("http://test/api/docs/never-created"),
      paramsFor("never-created"),
    );

    expect(res.status).toBe(404);
  });

  it("serves .pdf inline as application/pdf and .docx as attachment", async () => {
    const pdfKey = "doc-route-2.pdf";
    const pdfBytes = Buffer.from("%PDF-1.7 fake");
    const pdfUrl = await storage.put(pdfKey, pdfBytes);
    const docxKey = "doc-route-2.docx";
    const docxUrl = await storage.put(docxKey, Buffer.from("PK-fake"));

    await repo.create({
      address: "ul. Docs-Route 2",
      area: 10,
      wr: 100000,
      inputs: null,
      amountInWords: null,
      docUrl: pdfUrl,
      docxUrl,
      ownerId: appraiserA.id,
    });

    getSessionMock.mockResolvedValue({ user: appraiserA });

    const pdfRes = await GET(new Request(`http://test${pdfUrl}`), paramsFor(pdfKey));
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
    expect(pdfRes.headers.get("content-disposition")).toBe("inline");

    // the DOCX key authorizes via docxUrl (OR-match in getByDocKey)
    const docxRes = await GET(new Request(`http://test${docxUrl}`), paramsFor(docxKey));
    expect(docxRes.status).toBe(200);
    expect(docxRes.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(docxRes.headers.get("content-disposition")).toContain("attachment");
  });
});
