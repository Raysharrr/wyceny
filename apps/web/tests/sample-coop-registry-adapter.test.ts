import { describe, expect, it, vi } from "vitest";
import { coopRegistrySampleProposal } from "../src/adapters/sample-coop-registry";
import type { CoopTransaction, PortCoopRegistry } from "../src/ports/coop-registry";

/**
 * Second `PortSampleProposal` adapter (T-14, S3): the office coop register
 * instead of the worker's RCN WFS. Rows without `pos` never reach the pool
 * (the port filters them), `distanceM` is planar EPSG:2180 — the same metric
 * as the adapter's SQL radius filter — and every field the register does not
 * have is null, never a default (ADR-010).
 */
const SUBJECT = { x: 361000, y: 503000 };

function row(over: Partial<CoopTransaction> = {}): CoopTransaction {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    cooperative: "SM Osiedle Młodych",
    address: "os. Piastowskie",
    buildingNumber: "57",
    flatNumber: "12",
    area: 43.34,
    priceTotal: 439000,
    pricePerM2: 439000 / 43.34,
    date: "2025-08-14",
    priceKind: "transakcyjna",
    rightType: null,
    rep: null,
    floor: 6,
    rooms: 2,
    buildYear: null,
    pos: { x: SUBJECT.x + 300, y: SUBJECT.y + 400 },
    source: "xls",
    dedupeKey: "k1",
    ...over,
  };
}

function registry(
  rows: CoopTransaction[],
  truncated = false,
): PortCoopRegistry & { list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async () => ({ rows, total: rows.length, hasMore: false, truncated }));
  return {
    list,
    upsertMany: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    stats: vi.fn(async () => ({
      total: rows.length,
      byCooperative: {},
      needsGeocoding: 0,
      lastImport: { at: "2026-09-07T10:00:00.000Z", file: "x.xlsx", rows: rows.length },
    })),
    recordBatch: vi.fn(),
    getMapping: vi.fn(),
    saveMapping: vi.fn(),
  } as unknown as PortCoopRegistry & { list: ReturnType<typeof vi.fn> };
}

const geocode = vi.fn(async () => ({ ...SUBJECT, source: "uug" as const }));

describe("coopRegistrySampleProposal", () => {
  it("geocodes the subject when no point is given and queries the register by the max radius", async () => {
    const reg = registry([row()]);
    const pool = await coopRegistrySampleProposal(reg, geocode).fetchPool({
      address: "os. Piastowskie 24, Poznań",
      area: 43.34,
    });
    expect(geocode).toHaveBeenCalledWith("os. Piastowskie 24, Poznań");
    expect(reg.list).toHaveBeenCalledWith({ near: { ...SUBJECT, radiusM: 3000 } });
    expect(pool.point).toEqual({ ...SUBJECT, source: "uug" });
    expect(pool.source).toBe("rejestr-sm");
    expect(pool.maxRadiusM).toBe(3000);
    expect(pool.query.truncated).toBe(false);
    expect(pool.importedAt).toBe("2026-09-07T10:00:00.000Z");
  });

  it("uses the already-resolved subject point (step 1) instead of geocoding", async () => {
    const g = vi.fn();
    const reg = registry([row()]);
    const pool = await coopRegistrySampleProposal(reg, g).fetchPool({
      address: "x",
      area: 40,
      point: { x: 1, y: 2, srid: 2180 },
    });
    expect(g).not.toHaveBeenCalled();
    expect(pool.point).toEqual({ x: 1, y: 2, source: "subject" });
  });

  it("maps a register row to a Candidate: nulls stay null, buildingRef and planar distance filled", async () => {
    const pool = await coopRegistrySampleProposal(registry([row()]), geocode).fetchPool({
      address: "x",
      area: 43.34,
      point: { ...SUBJECT, srid: 2180 },
    });
    expect(pool.candidates).toHaveLength(1);
    const c = pool.candidates[0];
    expect(c.transactionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(c.egib).toBeNull();
    expect(c.buildingRef).toBe("piastowskie|57");
    expect(c.distanceM).toBe(500); // 3-4-5 triangle on EPSG:2180
    expect(c.function).toBeNull();
    expect(c.transType).toBeNull();
    expect(c.market).toBeNull();
    expect(c.share).toBeNull();
    expect(c.rightType).toBeNull();
    expect(c.seller).toBeNull();
    expect(c.date).toBe("2025-08-14");
    expect(c.pricePerM2).toBeCloseTo(439000 / 43.34, 6);
    expect(c.priceTotal).toBe(439000);
    expect(c.floor).toBe(6);
    expect(c.street).toBe("os. Piastowskie");
    expect(c.streetNumber).toBe("57");
    expect(c.cooperative).toBe("SM Osiedle Młodych");
    expect(pool.counts).toEqual({ fetched: 1, deduped: 1, noPos: 0 });
  });

  it("keeps a known rightType", async () => {
    const pool = await coopRegistrySampleProposal(
      registry([row({ rightType: "spoldzielcze_wlasnosciowe" })]),
      geocode,
    ).fetchPool({ address: "x", area: 40, point: { ...SUBJECT, srid: 2180 } });
    expect(pool.candidates[0].rightType).toBe("spoldzielcze_wlasnosciowe");
  });

  it("rows without pos never enter the pool (defensive: the port already filters them)", async () => {
    const pool = await coopRegistrySampleProposal(
      registry([row(), row({ id: "22222222-2222-4222-8222-222222222222", pos: null })]),
      geocode,
    ).fetchPool({ address: "x", area: 40, point: { ...SUBJECT, srid: 2180 } });
    expect(pool.candidates).toHaveLength(1);
    expect(pool.counts.noPos).toBe(1);
  });

  it("refuses to build a pool the register truncated (5 000-row ceiling)", async () => {
    await expect(
      coopRegistrySampleProposal(registry([row()], true), geocode).fetchPool({
        address: "x",
        area: 40,
        point: { ...SUBJECT, srid: 2180 },
      }),
    ).rejects.toThrow(/niekompletna/);
  });
});
