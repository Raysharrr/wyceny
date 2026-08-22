import { describe, expect, it } from "vitest";
import { StorageNotFoundError, type PortStorage } from "@/ports/storage";
import type { CandidatePool } from "@/ports/sample";
import { savePool, loadPool, poolKey } from "@/app/actions/_pool-cache";
import { loadSnapshot } from "./fixtures/rcn-snapshots/load";

/** In-memory `PortStorage` — mirrors the pattern in get-sample-proposal-action.test.ts. */
function memStorage(): PortStorage {
  const store = new Map<string, Buffer>();
  return {
    async put(k: string, d: Buffer | string) {
      store.set(k, Buffer.isBuffer(d) ? d : Buffer.from(d));
      return `/api/docs/${encodeURIComponent(k)}`;
    },
    async get(k: string) {
      const v = store.get(k);
      if (v === undefined) throw new StorageNotFoundError(k);
      return v;
    },
    async delete(k: string) {
      store.delete(k);
    },
  };
}

function buildPool(): CandidatePool {
  const { subject, candidates, pages } = loadSnapshot("heweliusza");
  return {
    point: { x: subject.x, y: subject.y, source: "subject" },
    maxRadiusM: 3000,
    candidates,
    counts: { fetched: candidates.length + 200, deduped: 200, noPos: 0 },
    fetchedAt: "2026-08-21T10:00:00Z",
    source: "rcn-wfs-gugik",
    query: { bbox: [0, 0, 0, 0], count: 5000, sort: "dok_data D", pages, truncated: false },
  };
}

const SAVED_FOR = { address: "Poznań, Heweliusza 3", area: 50 };

describe("_pool-cache", () => {
  it("savePool writes a gzip Buffer under pool/<valuationId>.json.gz", async () => {
    const storage = memStorage();
    const pool = buildPool();
    await savePool(storage, "11111111-1111-4111-8111-111111111111", pool, SAVED_FOR);
    const raw = await storage.get(poolKey("11111111-1111-4111-8111-111111111111"));
    expect(Buffer.isBuffer(raw)).toBe(true);
    // gzip magic bytes (RFC 1952).
    expect(raw[0]).toBe(0x1f);
    expect(raw[1]).toBe(0x8b);
  });

  it("loadPool restores the pool AND its savedFor byte-for-byte (toEqual)", async () => {
    const storage = memStorage();
    const pool = buildPool();
    await savePool(storage, "11111111-1111-4111-8111-111111111111", pool, SAVED_FOR);
    const restored = await loadPool(storage, "11111111-1111-4111-8111-111111111111");
    expect(restored).toEqual({ savedFor: SAVED_FOR, pool });
  });

  it("missing key → null", async () => {
    const storage = memStorage();
    const restored = await loadPool(storage, "22222222-2222-4222-8222-222222222222");
    expect(restored).toBeNull();
  });

  it("corrupt cache (not valid gzip/JSON) → throws, never masked as null", async () => {
    const storage = memStorage();
    await storage.put(
      poolKey("33333333-3333-4333-8333-333333333333"),
      Buffer.from("not a gzip stream"),
    );
    await expect(loadPool(storage, "33333333-3333-4333-8333-333333333333")).rejects.toThrow();
  });

  it("gzip size of the Heweliusza pool (with savedFor wrapper) is under 2 MB (team-lead condition 2)", async () => {
    const storage = memStorage();
    const pool = buildPool();
    await savePool(storage, "11111111-1111-4111-8111-111111111111", pool, SAVED_FOR);
    const raw = await storage.get(poolKey("11111111-1111-4111-8111-111111111111"));
    expect(raw.byteLength).toBeLessThan(2 * 1024 * 1024);
  });
});

describe("_pool-cache — street index state survives the round trip (Slice 3d)", () => {
  /**
   * The whole four-state badge design rests on this: `reselectSample` re-selects from the
   * CACHED pool without calling the worker, so if `streetIndex` were dropped by
   * gzip+schema on the way in or out, every row after a radius change would claim "pool
   * fetched without addresses" — a false statement about a pool that has them.
   */
  it("keeps streetIndex and the candidates' street/city through save+load", async () => {
    const storage = memStorage();
    const pool = buildPool();
    const withStreets: CandidatePool = {
      ...pool,
      candidates: [
        { ...pool.candidates[0], street: "ul. Heweliusza", streetNumber: "3", city: "Poznań" },
        ...pool.candidates.slice(1),
      ],
      streetIndex: { status: "ready", cutoff: "2026-08-13", generatedAt: "2026-08-22T10:00:00Z" },
    };

    await savePool(storage, "v1", withStreets, { address: "Poznań, Heweliusza 3", area: 50 });
    const loaded = await loadPool(storage, "v1");

    expect(loaded?.pool.streetIndex).toEqual(withStreets.streetIndex);
    expect(loaded?.pool.candidates[0]).toMatchObject({
      street: "ul. Heweliusza",
      streetNumber: "3",
      city: "Poznań",
    });
  });

  it("a pool cached BEFORE this slice still loads — old is not corrupt", async () => {
    // `loadPool` re-validates and a corrupt cache must throw; an entry frozen before 3d
    // simply has no such field, and rejecting it would break drafts mid-valuation.
    const storage = memStorage();
    await savePool(storage, "v2", buildPool(), { address: "Poznań, Heweliusza 3", area: 50 });
    const loaded = await loadPool(storage, "v2");

    expect(loaded).not.toBeNull();
    expect(loaded?.pool.streetIndex).toBeUndefined();
  });
});
