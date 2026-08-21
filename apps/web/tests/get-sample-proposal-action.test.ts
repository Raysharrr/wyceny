import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { PortStreetView } from "../src/ports/street-view";

vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } })),
}));

/**
 * `_deps` is NOT automocked here (unlike approve-valuation-action.test.ts):
 * `streetView` needs to be BOTH `null` (the default — no GOOGLE_STREET_VIEW_KEY
 * in the unit-test env, which is exactly what automock would already give)
 * AND a controllable stub port within the SAME file, to cover both branches
 * of `getSampleProposal`'s `if (streetView)`. Automock can only ever resolve
 * one value for a module-level const, so the port is held in `depsState`
 * (via `vi.hoisted`, which runs before this factory) and exposed through a
 * getter — a live ES-module binding that `get-sample-proposal.ts`'s
 * `import { streetView } from "@/app/valuations/_deps"` re-reads on every
 * access, so mutating `depsState.streetView` between tests changes what the
 * action sees. `storage` is a genuine in-memory `PortStorage` (mirrors
 * `memStorage()` in street-view-enrich.test.ts) rather than an automocked
 * `vi.fn()`, since `enrichStreetView` both reads (cache) and writes
 * (thumbnail + sidecar) through it.
 */
const depsState = vi.hoisted(() => ({
  streetView: null as unknown,
  store: new Map<string, Buffer | string>(),
}));

vi.mock("@/app/valuations/_deps", async () => {
  const { StorageNotFoundError } = await import("../src/ports/storage");
  return {
    sampleProposal: { fetchPool: vi.fn() },
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
    get streetView() {
      return depsState.streetView;
    },
  };
});

vi.mock("@/app/actions/_record-failure", () => ({
  recordEvent: vi.fn(async () => {}),
  recordFailure: vi.fn(async () => {}),
}));

import { getSampleProposal } from "../src/app/actions/get-sample-proposal";
import { sampleProposal, valuationRepository } from "@/app/valuations/_deps";
import { recordEvent } from "@/app/actions/_record-failure";
import { loadSnapshot } from "./fixtures/rcn-snapshots/load";
import type { CandidatePool } from "@/ports/sample";

const fetchPoolMock = vi.mocked(sampleProposal.fetchPool);
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
const valuation = {
  id: "11111111-1111-4111-8111-111111111111",
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

describe("getSampleProposal (v3)", () => {
  beforeEach(() => {
    fetchPoolMock.mockReset();
    getMock.mockReset();
    vi.mocked(recordEvent).mockClear();
    depsState.streetView = null;
    depsState.store.clear();
  });

  it("passes the step-1 point, runs the domain, returns comparables + snapshot + meta, logs numbers only", async () => {
    getMock.mockResolvedValue(valuation);
    fetchPoolMock.mockResolvedValue(pool);
    const r = await getSampleProposal({
      valuationId: valuation.id,
      address: valuation.address,
      area: 50,
    });
    expect(fetchPoolMock).toHaveBeenCalledWith({
      address: valuation.address,
      area: 50,
      point: { x: subject.x, y: subject.y, srid: 2180 },
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.proposal.comparables.length).toBeGreaterThanOrEqual(6);
    expect(r.proposal.comparables.length).toBeLessThanOrEqual(12);
    expect(r.proposal.comparables[0]).toEqual(
      expect.objectContaining({
        date: expect.any(String),
        area: expect.any(Number),
        pricePerM2: expect.any(Number),
        transactionId: expect.any(String),
      }),
    );
    expect(r.proposal.sampleSelection.radiusUsedM).toBe(500);
    expect(r.proposal.sampleSelection.params.subjectEgib).toEqual({
      obreb: "0039",
      arkusz: "22",
      dzialka: "13/24",
      budynek: "1",
    });
    expect("candidates" in r.proposal.sampleMeta).toBe(false);
    // streetView is null by default (no GOOGLE_STREET_VIEW_KEY) — the port
    // isn't wired, so enrichment is skipped entirely.
    expect(r.proposal.streetView).toEqual({});
    expect(
      vi.mocked(recordEvent).mock.calls.some((c) => c[0].event === "proposal.streetview"),
    ).toBe(false);
    const meta = vi.mocked(recordEvent).mock.calls[0][0].meta as Record<string, unknown>;
    expect(meta).toMatchObject({
      geocoder: "subject",
      radiusUsedM: 500,
      truncated: false,
      counts: expect.any(Object),
    });
    expect(JSON.stringify(meta)).not.toMatch(/Heweliusza|306401|355300/);
    expect(vi.mocked(recordEvent).mock.calls[0][0].valuationId).toBe(valuation.id);
  });

  it("without subjectMeta the worker geocodes (no point sent) and ranking is distance-only", async () => {
    getMock.mockResolvedValue({ ...valuation, inputs: {} });
    fetchPoolMock.mockResolvedValue({ ...pool, point: { ...pool.point, source: "uug" } });
    const r = await getSampleProposal({
      valuationId: valuation.id,
      address: valuation.address,
      area: 50,
    });
    expect(fetchPoolMock.mock.calls[0][0].point).toBeUndefined();
    if ("error" in r) throw new Error(r.error);
    expect(r.proposal.sampleSelection.params.subjectEgib).toBeUndefined();
  });

  it("unknown valuation → error, no worker call", async () => {
    getMock.mockResolvedValue(null);
    const r = await getSampleProposal({ valuationId: valuation.id, address: "a", area: 1 });
    expect(r).toEqual({ error: expect.stringMatching(/Nie znaleziono wyceny/) });
    expect(fetchPoolMock).not.toHaveBeenCalled();
  });

  it("adapter throw with the worker's Polish detail → { error } with that message + code", async () => {
    getMock.mockResolvedValue(valuation);
    // Deliberately a DIFFERENT Polish message than GENERIC_ERROR — proves the
    // detail is passed through verbatim, not just re-derived from the fallback.
    fetchPoolMock.mockRejectedValue(
      new Error(
        "Za mało transakcji w okolicy (znaleziono 5) — zawęź adres albo uzupełnij próbę ręcznie.",
      ),
    );
    const r = await getSampleProposal({ valuationId: valuation.id, address: "a", area: 50 });
    expect(r).toEqual({
      error: expect.stringMatching(
        /^Za mało transakcji w okolicy \(znaleziono 5\).*\(kod: [0-9a-f]{8}\)$/,
      ),
    });
  });

  it("adapter throw of its own English status-text fallback → generic Polish message + code", async () => {
    getMock.mockResolvedValue(valuation);
    fetchPoolMock.mockRejectedValue(
      new Error("worker /sample-proposal responded 500 Internal Server Error"),
    );
    const r = await getSampleProposal({ valuationId: valuation.id, address: "a", area: 50 });
    expect(r).toEqual({
      error: expect.stringMatching(/^Nie udało się pobrać próby z RCN.*\(kod: [0-9a-f]{8}\)$/),
    });
  });

  it("adapter throws a TimeoutError (AbortSignal.timeout) → generic Polish message + code, no English leak", async () => {
    getMock.mockResolvedValue(valuation);
    fetchPoolMock.mockRejectedValue(
      Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
    );
    const r = await getSampleProposal({ valuationId: valuation.id, address: "a", area: 50 });
    expect(r).toEqual({
      error: expect.stringMatching(/^Nie udało się pobrać próby z RCN.*\(kod: [0-9a-f]{8}\)$/),
    });
  });

  it("adapter throws a real ZodError (trust-boundary parse failure) → generic Polish message + code, no JSON blob", async () => {
    getMock.mockResolvedValue(valuation);
    const zodError = z.object({ a: z.string() }).safeParse({}).error!;
    fetchPoolMock.mockRejectedValue(zodError);
    const r = await getSampleProposal({ valuationId: valuation.id, address: "a", area: 50 });
    expect(r).toEqual({
      error: expect.stringMatching(/^Nie udało się pobrać próby z RCN.*\(kod: [0-9a-f]{8}\)$/),
    });
  });

  it("empty address → { error }, no repo or worker call", async () => {
    const r = await getSampleProposal({ valuationId: valuation.id, address: "", area: 50 });
    expect(r).toEqual({ error: expect.any(String) });
    expect(getMock).not.toHaveBeenCalled();
    expect(fetchPoolMock).not.toHaveBeenCalled();
  });

  it("area: 0 → { error }, no repo or worker call", async () => {
    const r = await getSampleProposal({ valuationId: valuation.id, address: "a", area: 0 });
    expect(r).toEqual({ error: expect.any(String) });
    expect(getMock).not.toHaveBeenCalled();
    expect(fetchPoolMock).not.toHaveBeenCalled();
  });

  it("streetView wired (stub port) → enrichment runs, proposal.streetview event carries numbers-only meta (F-13)", async () => {
    const stubPort: PortStreetView = {
      lookup: vi.fn().mockResolvedValue({
        panoId: "P1",
        captureDate: "2023-07",
        camera: { lat: 52.3948, lng: 16.8725 },
      }),
      thumbnail: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8])),
    };
    depsState.streetView = stubPort;
    getMock.mockResolvedValue(valuation);
    fetchPoolMock.mockResolvedValue(pool);
    const r = await getSampleProposal({
      valuationId: valuation.id,
      address: valuation.address,
      area: 50,
    });
    if ("error" in r) throw new Error(r.error);
    expect(Object.keys(r.proposal.streetView).length).toBeGreaterThan(0);
    const call = vi
      .mocked(recordEvent)
      .mock.calls.find((c) => c[0].event === "proposal.streetview");
    expect(call).toBeDefined();
    const meta = call![0].meta as Record<string, unknown>;
    expect(Object.values(meta).every((v) => typeof v === "number")).toBe(true);
  });
});
