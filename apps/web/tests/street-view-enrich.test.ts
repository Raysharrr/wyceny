import { describe, it, expect, vi } from "vitest";
import {
  enrichStreetView,
  ENRICH_BUDGET_MS,
  isThumbnailKey,
  metaKey,
  MIN_BUDGET_MS,
  thumbnailKey,
} from "../src/app/actions/_street-view-enrich";
import { StorageNotFoundError, type PortStorage } from "../src/ports/storage";
import type { PortStreetView } from "../src/ports/street-view";
import { buildingKey, type Candidate } from "../src/domain/sample-selection";
import { loadSnapshot } from "./fixtures/rcn-snapshots/load";

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
    expect(meta).toEqual({ requested: 2, cached: 0, missing: 0, failed: 0, skipped: 0 });
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
    expect(meta).toEqual({ requested: 1, cached: 1, missing: 0, failed: 0, skipped: 0 });
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
  it("a frozen entry with panoId === null counts as missing too, same as the sidecar branch", async () => {
    const port = sv();
    const storage = memStorage();
    const existing = {
      "0039.22.13/82.1": {
        panoId: null,
        captureDate: null,
        thumbnailKey: null,
        heading: null,
        lat: 1,
        lng: 2,
      },
    };
    const { meta } = await enrichStreetView([mk("1")], {
      streetView: port,
      storage,
      now: NOW,
      existing,
    });
    expect(port.lookup).not.toHaveBeenCalled();
    expect(meta).toEqual({ requested: 1, cached: 1, missing: 1, failed: 0, skipped: 0 });
  });
  it("a corrupt/malformed sidecar self-heals as a cache miss — re-fetches from Google, overwrites with a fresh valid sidecar (Important #2)", async () => {
    const port = sv();
    const b = "0039.22.13/82.1";
    const storage = memStorage({ [metaKey(b)]: "{not json" });
    const { snapshot, meta } = await enrichStreetView([mk("1")], {
      streetView: port,
      storage,
      now: NOW,
    });
    expect(port.lookup).toHaveBeenCalledTimes(1);
    expect(meta).toEqual({ requested: 1, cached: 0, missing: 0, failed: 0, skipped: 0 });
    expect(snapshot[b].panoId).toBe("P1");
    const stored = JSON.parse(String(storage.store.get(metaKey(b))));
    expect(stored).toMatchObject({ panoId: "P1", fetchedAt: "2026-08-21T10:00:00.000Z" });
  });
  it("a wall-clock budget stops new buildings once ENRICH_BUDGET_MS elapses — some processed, the rest skipped, sample still returns (Important #1)", async () => {
    const port = sv();
    const storage = memStorage();
    const start = new Date("2026-08-21T10:00:00Z");
    const pastDeadline = new Date(start.getTime() + ENRICH_BUDGET_MS + 1);
    // No `deps.budgetMs` passed — exercises the ENRICH_BUDGET_MS default
    // fix round 2 kept (`budgetMs = deps.budgetMs ?? ENRICH_BUDGET_MS`), the
    // same value this test always used.
    //
    // Fixed start time while the enrichment's own setup + the first wave of
    // concurrent workers are still dispatching (all of that happens before
    // any of their `readCache`/Google awaits actually suspend execution —
    // JS runs the synchronous prefix of CONCURRENCY=6 workers in one go, so
    // all 6 workers' `job = queue.shift()` + deadline-check calls land in
    // the SAME synchronous burst as the two setup calls, `now` and
    // `deadline`; that's 2 + 6 = 8 calls before any of them actually starts
    // Google/storage work), then flips to a time past the deadline for
    // every check after — proven empirically against this implementation
    // (threshold 2, as a first reading of the ruling might suggest, made
    // ALL 8 buildings skip instead of a partial split) rather than assumed.
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls <= 8 ? start : pastDeadline;
    };
    const cands = Array.from({ length: 8 }, (_, i) => mk(String(i + 1)));
    const { snapshot, meta } = await enrichStreetView(cands, { streetView: port, storage, now });
    expect(meta.requested).toBe(8);
    expect(meta.skipped).toBeGreaterThan(0);
    expect(meta.skipped).toBeLessThan(8);
    expect(meta.skipped + Object.keys(snapshot).length).toBe(8);
    expect(port.lookup.mock.calls.length).toBe(Object.keys(snapshot).length);
    expect(Object.values(meta).every((v) => typeof v === "number")).toBe(true);
  });
  it("budgetMs below MIN_BUDGET_MS skips the whole pool without starting it — frozen entries still returned, no port calls (Important #1, round 2)", async () => {
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
    const cands = [mk("1"), mk("2"), mk("3")];
    expect(1000).toBeLessThan(MIN_BUDGET_MS);
    const { snapshot, meta } = await enrichStreetView(cands, {
      streetView: port,
      storage,
      now: NOW,
      existing,
      budgetMs: 1000,
    });
    expect(meta).toEqual({ requested: 3, cached: 1, missing: 0, failed: 0, skipped: 2 });
    expect(snapshot["0039.22.13/82.1"].panoId).toBe("OLD");
    expect(port.lookup).not.toHaveBeenCalled();
    expect(port.thumbnail).not.toHaveBeenCalled();
    expect(storage.store.size).toBe(0);
  });
});

describe("isThumbnailKey", () => {
  it("accepts a key produced by thumbnailKey()", () => {
    expect(isThumbnailKey(thumbnailKey("0039.22.13/82.1"))).toBe(true);
  });
  it("round-trips for every buildingKey the real RCN fixtures produce (not just a hand-picked example)", () => {
    // thumbnailKey passes any buildingKey through untouched except / -> ~;
    // isThumbnailKey requires [0-9A-Za-z._~-]+. buildingKey's dzialka
    // component comes from parseLokalId's `([^.]+)` — anything but a dot —
    // so a stray space/diacritic/punctuation there would silently produce a
    // key the route then refuses to serve. Checked against every unique
    // buildingKey across all real snapshot fixtures, not just one example.
    const slugs = [
      "heweliusza",
      "koscielna",
      "meissnera",
      "olga",
      "sielawy",
      "starolecka",
      "wojska-polskiego",
    ];
    let checked = 0;
    for (const slug of slugs) {
      const { candidates } = loadSnapshot(slug);
      for (const c of candidates) {
        const b = buildingKey(c);
        if (b) {
          expect(isThumbnailKey(thumbnailKey(b))).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
  it("rejects a .json sidecar key, a slash-containing key, an inspection-photo key, and a key with a space", () => {
    expect(isThumbnailKey("streetview-x.json")).toBe(false);
    expect(isThumbnailKey("streetview/x.jpg")).toBe(false);
    expect(isThumbnailKey("ogledziny-budynek-x-11111111-1111-4111-8111-111111111111.jpg")).toBe(
      false,
    );
    expect(isThumbnailKey("streetview-a b.jpg")).toBe(false);
  });
});
