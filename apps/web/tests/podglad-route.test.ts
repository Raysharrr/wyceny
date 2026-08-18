import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import { pgStorage } from "../src/adapters/storage-pg";
import { previewDocKey } from "../src/lib/preview-doc";
import type { SessionUser } from "../src/ports/valuation";

/**
 * Ownership auth gate on `/api/podglad/[id]` (Slice 14, Task 9) — the route
 * the step-7 reader embeds. Same shape as docs-route.test.ts: only
 * `getSession` is mocked (it reads `next/headers`, meaningless outside a real
 * request); the repo lookup and the storage read run for real against
 * Postgres, so the gate itself is what's under test.
 *
 * The preview is authorized by ownership of the VALUATION, not by a doc key:
 * `getByDocKey` matches `docUrl`/`docxUrl` only, and registering a preview
 * there would mark an unissued document as issued.
 */
const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/auth/session", () => ({ getSession: getSessionMock }));

const { GET } = await import("../src/app/api/podglad/[id]/route");

const appraiserA: SessionUser = { id: "user-podglad-a", role: "appraiser" };
const appraiserB: SessionUser = { id: "user-podglad-b", role: "appraiser" };
const admin: SessionUser = { id: "user-podglad-admin", role: "admin" };

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

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function draftWithPreview(pdf: Buffer) {
  const valuation = await repo.create({
    address: "ul. Klonowa 5, Nowogród",
    area: 50,
    wr: null,
    inputs: null,
    amountInWords: null,
    docUrl: null,
    ownerId: appraiserA.id,
  });
  await storage.put(previewDocKey(valuation.id), pdf);
  return valuation;
}

describe("/api/podglad/[id] — access control", () => {
  it("no session -> 401", async () => {
    getSessionMock.mockResolvedValue(null);

    const res = await GET(new Request("http://test/api/podglad/anything"), paramsFor("anything"));

    expect(res.status).toBe(401);
  });

  it("owner -> the PDF inline and uncached; another appraiser -> 404; admin -> 200", async () => {
    const pdf = Buffer.from("%PDF-1.7 podgląd");
    const valuation = await draftWithPreview(pdf);
    const request = new Request(`http://test/api/podglad/${valuation.id}?v=abc`);

    getSessionMock.mockResolvedValue({ user: appraiserA });
    const resA = await GET(request, paramsFor(valuation.id));
    expect(resA.status).toBe(200);
    expect(resA.headers.get("Content-Type")).toBe("application/pdf");
    expect(resA.headers.get("Content-Disposition")).toBe("inline");
    expect(resA.headers.get("Cache-Control")).toBe("no-store");
    expect(Buffer.from(await resA.arrayBuffer())).toEqual(pdf);

    getSessionMock.mockResolvedValue({ user: appraiserB });
    expect((await GET(request, paramsFor(valuation.id))).status).toBe(404);

    getSessionMock.mockResolvedValue({ user: admin });
    expect((await GET(request, paramsFor(valuation.id))).status).toBe(200);
  });

  it("stops serving the preview once the operat is issued, however the blob survived", async () => {
    // The post-issue delete in approveValuation is deliberately non-fatal, so
    // a storage failure there leaves the blob behind. Without this guard the
    // route would keep serving it forever — the appraiser, or whoever they
    // hand the link to, reading a document that differs from the one actually
    // issued and signed. The action refuses a non-draft; the artefact outlives
    // the action, so the route has to refuse too.
    const valuation = await draftWithPreview(Buffer.from("%PDF-1.7 podgląd sprzed wydania"));
    const request = new Request(`http://test/api/podglad/${valuation.id}`);
    getSessionMock.mockResolvedValue({ user: appraiserA });

    expect((await GET(request, paramsFor(valuation.id))).status).toBe(200);

    await db
      .update(schema.valuation)
      .set({ status: "approved", approvedAt: new Date() })
      .where(eq(schema.valuation.id, valuation.id));
    expect((await GET(request, paramsFor(valuation.id))).status).toBe(404);

    await db
      .update(schema.valuation)
      .set({ status: "signed", signedAt: new Date() })
      .where(eq(schema.valuation.id, valuation.id));
    expect((await GET(request, paramsFor(valuation.id))).status).toBe(404);
  });

  it("a valuation the caller owns but has never previewed -> 404", async () => {
    const valuation = await repo.create({
      address: "ul. Klonowa 7, Nowogród",
      area: 40,
      wr: null,
      inputs: null,
      amountInWords: null,
      docUrl: null,
      ownerId: appraiserA.id,
    });

    getSessionMock.mockResolvedValue({ user: appraiserA });
    const res = await GET(
      new Request(`http://test/api/podglad/${valuation.id}`),
      paramsFor(valuation.id),
    );

    expect(res.status).toBe(404);
  });
});
