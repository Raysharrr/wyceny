import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";
import { valuationRepo } from "../src/adapters/valuation-drizzle";
import { pgStorage } from "../src/adapters/storage-pg";
import { buildPhotoKey } from "../src/domain/inspection";
import { approvableInput, valuationInput } from "./fixtures/valuation-inputs";
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

describe("/api/docs/[key] — inspection photo thumbnails (Slice 10 FR-2, Task 8b)", () => {
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

  it("photo key present in the owner's manifest -> 200, image/jpeg, inline, correct bytes", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Miniatury 1"),
      inputs: { comparables: [], area: 10, features: [] },
    });
    const key = buildPhotoKey("wnetrza", "photo-1", created.id);
    await repo.updateInspection(created.id, appraiserA, {
      kind: "add_photo",
      section: "wnetrza",
      key,
    });
    await storage.put(key, jpegBytes);

    getSessionMock.mockResolvedValue({ user: appraiserA });
    const res = await GET(new Request(`http://test/api/docs/${key}`), paramsFor(key));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(Buffer.from(await res.arrayBuffer()).equals(jpegBytes)).toBe(true);
  });

  it("photo key not present in the manifest -> 404 (orphaned/guessed key, no fishing)", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Miniatury 2"),
      inputs: { comparables: [], area: 10, features: [] },
    });
    const knownKey = buildPhotoKey("otoczenie", "photo-known", created.id);
    await repo.updateInspection(created.id, appraiserA, {
      kind: "add_photo",
      section: "otoczenie",
      key: knownKey,
    });
    // Well-formed, same (visible) valuationId, but never added to the manifest.
    const guessedKey = buildPhotoKey("otoczenie", "photo-guessed", created.id);

    getSessionMock.mockResolvedValue({ user: appraiserA });
    const res = await GET(new Request(`http://test/api/docs/${guessedKey}`), paramsFor(guessedKey));

    expect(res.status).toBe(404);
  });

  it("repo.get -> null for a non-owner -> 404, no existence leak", async () => {
    const created = await repo.create({
      ...valuationInput(appraiserA.id, "ul. Miniatury 3"),
      inputs: { comparables: [], area: 10, features: [] },
    });
    const key = buildPhotoKey("budynekZewn", "photo-3", created.id);
    await repo.updateInspection(created.id, appraiserA, {
      kind: "add_photo",
      section: "budynekZewn",
      key,
    });
    await storage.put(key, jpegBytes);

    getSessionMock.mockResolvedValue({ user: appraiserB });
    const res = await GET(new Request(`http://test/api/docs/${key}`), paramsFor(key));

    expect(res.status).toBe(404);
  });

  it("malformed key (no embedded UUID) doesn't match the photo branch, falls through to getByDocKey -> 404", async () => {
    getSessionMock.mockResolvedValue({ user: appraiserA });

    const res = await GET(
      new Request("http://test/api/docs/ogledziny-costam.jpg"),
      paramsFor("ogledziny-costam.jpg"),
    );

    expect(res.status).toBe(404);
  });

  it("versioning: a v2 draft inherits a v1-embedded photo key; owner request still resolves via v1 -> 200", async () => {
    const v1 = await repo.create(approvableInput(appraiserA.id));
    const key = buildPhotoKey("wnetrza", "photo-v1", v1.id);
    await repo.updateInspection(v1.id, appraiserA, { kind: "add_photo", section: "wnetrza", key });
    await storage.put(key, jpegBytes);

    await repo.approve(v1.id, appraiserA, {
      docUrl: `/api/docs/operat-${v1.id}.pdf`,
      docxUrl: `/api/docs/operat-${v1.id}.docx`,
    });
    await repo.sign(v1.id, appraiserA, {
      docUrl: `/api/docs/operat-${v1.id}-signed.pdf`,
      docxUrl: `/api/docs/operat-${v1.id}-signed.docx`,
      sha256Docx: "a".repeat(64),
      sha256Pdf: "b".repeat(64),
    });
    const v2 = await repo.createNewVersion(v1.id, appraiserA);
    // Inherited unchanged — the key still embeds v1's id (domain/inspection.ts).
    expect(v2!.inputs!.inspection!.photos.wnetrza).toEqual([key]);

    // The v2 UI's <img> still points at the v1-embedded key.
    getSessionMock.mockResolvedValue({ user: appraiserA });
    const res = await GET(new Request(`http://test/api/docs/${key}`), paramsFor(key));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });
});
