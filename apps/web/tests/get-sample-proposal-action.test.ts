import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } })),
}));
vi.mock("@/app/valuations/_deps");
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
    fetchPoolMock.mockRejectedValue(
      new Error(
        "Nie udało się pobrać próby z RCN — spróbuj ponownie albo wpisz transakcje ręcznie.",
      ),
    );
    const r = await getSampleProposal({ valuationId: valuation.id, address: "a", area: 50 });
    expect(r).toEqual({
      error: expect.stringMatching(/^Nie udało się pobrać próby z RCN.*\(kod: [0-9a-f]{8}\)$/),
    });
  });
});
