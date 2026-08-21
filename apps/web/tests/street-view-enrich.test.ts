import { describe, it, expect, vi } from "vitest";
import { enrichStreetView, metaKey, thumbnailKey } from "../src/app/actions/_street-view-enrich";
import { StorageNotFoundError, type PortStorage } from "../src/ports/storage";
import type { PortStreetView } from "../src/ports/street-view";
import type { Candidate } from "../src/domain/sample-selection";

function memStorage(
  seed: Record<string, Buffer | string> = {},
): PortStorage & { store: Map<string, Buffer | string> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async put(k, d) {
      store.set(k, d);
      return `/api/docs/${encodeURIComponent(k)}`;
    },
    async get(k) {
      const v = store.get(k);
      if (v === undefined) throw new StorageNotFoundError(k);
      return Buffer.isBuffer(v) ? v : Buffer.from(v);
    },
    async delete(k) {
      store.delete(k);
    },
  };
}
let n = 0;
function mk(budynek: string, over: Partial<Candidate> = {}): Candidate {
  n += 1;
  return {
    transactionId: `T${n}`,
    date: "2026-05-10",
    area: 50,
    pricePerM2: 12000,
    priceTotal: 600000,
    egib: {
      teryt: "306401_1",
      obreb: "0039",
      arkusz: "22",
      dzialka: "13/82",
      budynek,
      lokal: String(n),
    },
    lokalId: `306401_1.0039.AR_22.13/82.${budynek}_BUD.${n}_LOK`,
    distanceM: 10,
    floor: 1,
    rooms: 2,
    market: "wtorny",
    share: "1/1",
    transType: "wolnyRynek",
    function: "mieszkalna",
    seller: "osobaFizyczna",
    pos: { x: 355285, y: 505324 },
    ...over,
  };
}
const NOW = () => new Date("2026-08-21T10:00:00Z");
const sv = (): PortStreetView & {
  lookup: ReturnType<typeof vi.fn>;
  thumbnail: ReturnType<typeof vi.fn>;
} => ({
  lookup: vi.fn().mockResolvedValue({
    panoId: "P1",
    captureDate: "2023-07",
    camera: { lat: 52.3948, lng: 16.8725 },
  }),
  thumbnail: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8])),
});

describe("enrichStreetView", () => {
  it("one lookup + one thumbnail per UNIQUE building; entry frozen with heading camera→building", async () => {
    const port = sv();
    const storage = memStorage();
    const cands = [mk("1"), mk("1"), mk("2")];
    const { snapshot, meta } = await enrichStreetView(cands, {
      streetView: port,
      storage,
      now: NOW,
    });
    expect(port.lookup).toHaveBeenCalledTimes(2);
    expect(port.thumbnail).toHaveBeenCalledTimes(2);
    expect(meta).toEqual({ requested: 2, cached: 0, missing: 0, failed: 0 });
    const e = snapshot["0039.22.13/82.1"];
    expect(e.panoId).toBe("P1");
    expect(e.captureDate).toBe("2023-07");
    expect(e.thumbnailKey).toBe(thumbnailKey("0039.22.13/82.1"));
    expect(e.lat).toBeCloseTo(52.39468, 4);
    expect(e.heading).toBeGreaterThanOrEqual(0);
    expect(e.heading).toBeLessThan(360);
    expect(storage.store.has(thumbnailKey("0039.22.13/82.1"))).toBe(true);
    expect(JSON.parse(String(storage.store.get(metaKey("0039.22.13/82.1"))))).toMatchObject({
      panoId: "P1",
      fetchedAt: "2026-08-21T10:00:00.000Z",
    });
  });
  it("second run hits the cache — zero Google calls, cached counted", async () => {
    const port = sv();
    const storage = memStorage();
    await enrichStreetView([mk("1")], { streetView: port, storage, now: NOW });
    const port2 = sv();
    const { meta, snapshot } = await enrichStreetView([mk("1")], {
      streetView: port2,
      storage,
      now: NOW,
    });
    expect(port2.lookup).not.toHaveBeenCalled();
    expect(port2.thumbnail).not.toHaveBeenCalled();
    expect(meta).toEqual({ requested: 1, cached: 1, missing: 0, failed: 0 });
    expect(snapshot["0039.22.13/82.1"].panoId).toBe("P1");
  });
  it("cache older than TTL (365 days) is refreshed", async () => {
    const port = sv();
    const storage = memStorage();
    await enrichStreetView([mk("1")], {
      streetView: port,
      storage,
      now: () => new Date("2025-01-01T00:00:00Z"),
    });
    const port2 = sv();
    const { meta } = await enrichStreetView([mk("1")], { streetView: port2, storage, now: NOW });
    expect(port2.lookup).toHaveBeenCalledTimes(1);
    expect(meta.cached).toBe(0);
  });
  it("no panorama → entry with nulls, counted as missing, nothing stored as thumbnail, meta sidecar stored (cached miss)", async () => {
    const port = sv();
    port.lookup.mockResolvedValue(null);
    const storage = memStorage();
    const { snapshot, meta } = await enrichStreetView([mk("1")], {
      streetView: port,
      storage,
      now: NOW,
    });
    expect(snapshot["0039.22.13/82.1"]).toMatchObject({
      panoId: null,
      captureDate: null,
      thumbnailKey: null,
      heading: null,
    });
    expect(meta.missing).toBe(1);
    expect(port.thumbnail).not.toHaveBeenCalled();
    expect(storage.store.has(metaKey("0039.22.13/82.1"))).toBe(true);
  });
  it("a Google failure for one building does not sink the others (failed counted, entry absent)", async () => {
    const port = sv();
    port.lookup.mockRejectedValueOnce(new Error("HTTP 500"));
    const storage = memStorage();
    const { snapshot, meta } = await enrichStreetView([mk("1"), mk("2")], {
      streetView: port,
      storage,
      now: NOW,
    });
    expect(Object.keys(snapshot)).toHaveLength(1);
    expect(meta.failed).toBe(1);
  });
  it("candidates without egib or pos are skipped (no buildingKey / no coordinate)", async () => {
    const port = sv();
    const storage = memStorage();
    const { snapshot, meta } = await enrichStreetView(
      [mk("1", { egib: null }), mk("2", { pos: null })],
      { streetView: port, storage, now: NOW },
    );
    expect(snapshot).toEqual({});
    expect(meta.requested).toBe(0);
  });
  it("existing frozen entries are reused without any call (ADR-011: a re-open never re-asks Google)", async () => {
    const port = sv();
    const storage = memStorage();
    const existing = {
      "0039.22.13/82.1": {
        panoId: "OLD",
        captureDate: "2020-01",
        thumbnailKey: thumbnailKey("0039.22.13/82.1"),
        heading: 10,
        lat: 1,
        lng: 2,
      },
    };
    const { snapshot, meta } = await enrichStreetView([mk("1")], {
      streetView: port,
      storage,
      now: NOW,
      existing,
    });
    expect(port.lookup).not.toHaveBeenCalled();
    expect(snapshot["0039.22.13/82.1"].panoId).toBe("OLD");
    expect(meta.cached).toBe(1);
  });
});
