import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualRejection } from "../src/domain/sample-manual";
import type { CandidatePool } from "../src/ports/sample";

/**
 * Server Action `reselectSample` (Task 8, ADR-015 "Dobor proby v3") — the
 * radius-button re-selection over the pool `getSampleProposal` cached in
 * `_pool-cache.ts`. `next/navigation`'s `redirect` throws, like Next's real
 * one (mirrors confirm-prose.test.ts). `_deps` is NOT automocked, same
 * reasoning as get-sample-proposal-action.test.ts: `storage` needs to be a
 * genuine in-memory `PortStorage` so `savePool`/`loadPool` (and, inside
 * `buildProposal`, `enrichStreetView`'s cache) actually round-trip through
 * it; `streetView` stays `null` (no GOOGLE_STREET_VIEW_KEY) — enrichment
 * itself is exercised by get-sample-proposal-action.test.ts, not repeated
 * here.
 */
const getSessionMock = vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } }));
vi.mock("@/auth/session", () => ({ getSession: () => getSessionMock() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const depsState = vi.hoisted(() => ({
  store: new Map<string, Buffer | string>(),
}));

vi.mock("@/app/valuations/_deps", async () => {
  const { StorageNotFoundError } = await import("../src/ports/storage");
  return {
    valuationRepository: { get: vi.fn() },
    storage: {
      async put(k: string, d: Buffer | string) {
        depsState.store.set(k, d);
        return `/api/docs/${encodeURIComponent(k)}`;
      },
      async get(k: string) {
        const v = depsState.store.get(k);
        if (v === undefined) throw new StorageNotFoundError(k);
        return Buffer.isBuffer(v) ? v : Buffer.from(v);
      },
      async delete(k: string) {
        depsState.store.delete(k);
      },
    },
    streetView: null,
  };
});

vi.mock("@/app/actions/_record-failure", () => ({
  recordEvent: vi.fn(async () => {}),
  recordFailure: vi.fn(async () => {}),
}));

import { reselectSample } from "../src/app/actions/reselect-sample";
import { valuationRepository, storage } from "@/app/valuations/_deps";
import { recordEvent } from "@/app/actions/_record-failure";
import { savePool } from "@/app/actions/_pool-cache";
import { loadSnapshot } from "./fixtures/rcn-snapshots/load";

const getMock = vi.mocked(valuationRepository.get);
const { subject, candidates } = loadSnapshot("heweliusza");
const pool: CandidatePool = {
  point: { x: subject.x, y: subject.y, source: "subject" },
  maxRadiusM: 3000,
  candidates,
  counts: { fetched: 10000, deduped: 1200, noPos: 0 },
  fetchedAt: "2026-08-21T10:00:00.000Z",
  source: "rcn-wfs-gugik",
  query: {
    bbox: [1, 2, 3, 4],
    count: 5000,
    sort: "dok_data D,tran_lokalny_id_iip D",
    pages: 2,
    truncated: false,
  },
};
const VALUATION_ID = "11111111-1111-4111-8111-111111111111";
const valuation = {
  id: VALUATION_ID,
  address: "Poznań, Heweliusza 3",
  area: 50,
  inputs: {
    subject: { parcelId: subject.parcelId },
    subjectMeta: {
      x: subject.x,
      y: subject.y,
      teryt: "306401",
      fetchedAt: "",
      source: "geopoz-gugik",
      mpzpAbsent: false,
      buildingId: subject.buildingId,
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("reselectSample", () => {
  beforeEach(() => {
    getMock.mockReset();
    vi.mocked(recordEvent).mockClear();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ user: { id: "test-user", role: "appraiser" } });
    depsState.store.clear();
  });

  it("(a) no session → redirect to /login, nothing persisted", async () => {
    getSessionMock.mockResolvedValue(null as never);
    await expect(
      reselectSample({ valuationId: VALUATION_ID, radiusOverrideM: 1000, manualRejections: [] }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(getMock).not.toHaveBeenCalled();
  });

  it("(b) radiusOverrideM outside {500,1000,2000,3000} → validation error, no repo call", async () => {
    const r = await reselectSample({
      valuationId: VALUATION_ID,
      radiusOverrideM: 700,
      manualRejections: [],
    } as never);
    expect(r).toEqual({ error: expect.any(String) });
    expect(getMock).not.toHaveBeenCalled();
  });

  it("(c) no cached pool → { error, code: 'pool_missing' }, never a silent re-selection", async () => {
    getMock.mockResolvedValue(valuation);
    const r = await reselectSample({
      valuationId: VALUATION_ID,
      radiusOverrideM: 1000,
      manualRejections: [],
    });
    expect(r).toEqual({
      error: expect.stringMatching(/pobierz próbę z RCN ponownie/i),
      code: "pool_missing",
    });
  });

  it("(d) with a cached pool: re-runs the domain at the given radius, carries manualRejections 1:1, logs proposal.reselect with numbers/fields-only meta (F-13)", async () => {
    getMock.mockResolvedValue(valuation);
    await savePool(storage, VALUATION_ID, pool);
    const manualRejections: ManualRejection[] = [
      { transactionId: "X", lokalId: "Y", reason: "too_far", at: "2026-08-21T09:00:00Z" },
    ];

    const r = await reselectSample({
      valuationId: VALUATION_ID,
      radiusOverrideM: 1000,
      manualRejections,
    });
    if ("error" in r) throw new Error(r.error);

    expect(r.proposal.sampleSelection.radiusUsedM).toBe(1000);
    expect(r.proposal.sampleSelection.params.radiusOverrideM).toBe(1000);
    expect(r.proposal.sampleSelection.manualRejections).toEqual(manualRejections);

    const call = vi.mocked(recordEvent).mock.calls.find((c) => c[0].event === "proposal.reselect");
    expect(call).toBeDefined();
    expect(call![0].valuationId).toBe(VALUATION_ID);
    // No proposal.sample event — a reselect is not a fresh fetch.
    expect(vi.mocked(recordEvent).mock.calls.some((c) => c[0].event === "proposal.sample")).toBe(
      false,
    );

    const meta = call![0].meta as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(["counts", "fields", "radiusOverrideM"]);
    expect(meta.radiusOverrideM).toBe(1000);
    expect(
      Object.values(meta.counts as Record<string, unknown>).every((v) => typeof v === "number"),
    ).toBe(true);
    expect(
      Object.values(meta.fields as Record<string, unknown>).every((v) => typeof v === "string"),
    ).toBe(true);
    expect(JSON.stringify(meta)).not.toMatch(/Heweliusza|306401|X\|Y/);
  });

  it("(e) determinism: same pool + radius + manualRejections ⇒ identical `proposed` across two calls", async () => {
    getMock.mockResolvedValue(valuation);
    await savePool(storage, VALUATION_ID, pool);
    const input = {
      valuationId: VALUATION_ID,
      radiusOverrideM: 1000 as const,
      manualRejections: [] as ManualRejection[],
    };
    const r1 = await reselectSample(input);
    const r2 = await reselectSample(input);
    if ("error" in r1) throw new Error(r1.error);
    if ("error" in r2) throw new Error(r2.error);
    expect(r2.proposal.sampleSelection.proposed).toEqual(r1.proposal.sampleSelection.proposed);
  });
});
