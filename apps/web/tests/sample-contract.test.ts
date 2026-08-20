import { describe, it, expect, vi } from "vitest";
import { httpSampleProposal } from "../src/adapters/sample-http";
import type { CandidatePool } from "../src/ports/sample";

const candidate = {
  transactionId: "abc-1",
  date: "2026-05-10",
  area: 48.5,
  pricePerM2: 12500,
  priceTotal: 606250,
  egib: {
    teryt: "306401_1",
    obreb: "0039",
    arkusz: "22",
    dzialka: "13/24",
    budynek: "1",
    lokal: "7",
  },
  lokalId: "306401_1.0039.AR_22.13/24.1_BUD.7_LOK",
  distanceM: 120.5,
  floor: 2,
  rooms: 2,
  market: null,
  share: "1/1",
  transType: "wolnyRynek",
  function: "mieszkalna",
  seller: "osobaFizyczna",
  pos: { x: 355400.1, y: 505330.3 },
};
const pool: CandidatePool = {
  point: { x: 355300.15, y: 505330.31, source: "subject" },
  maxRadiusM: 3000,
  candidates: [candidate],
  counts: { fetched: 1, deduped: 0, noPos: 0 },
  fetchedAt: "2026-08-21T10:00:00.000Z",
  source: "rcn-wfs-gugik",
  query: {
    bbox: [1, 2, 3, 4],
    count: 5000,
    sort: "dok_data D,tran_lokalny_id_iip D",
    pages: 1,
    truncated: false,
  },
};

describe("PortSampleProposal contract (v3 CandidatePool)", () => {
  it("posts address/area/point/radiusM with a timeout and returns the validated pool", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => pool,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    global.fetch = fetchMock;
    const result = await httpSampleProposal("http://worker.test").fetchPool({
      address: "Poznań, Heweliusza 3",
      area: 50,
      point: { x: 355300.15, y: 505330.31, srid: 2180 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://worker.test/sample-proposal");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      address: "Poznań, Heweliusza 3",
      area: 50,
      point: { x: 355300.15, y: 505330.31, srid: 2180 },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual(pool);
  });

  it("rejects a malformed pool instead of casting it", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...pool, candidates: [{ transactionId: 1 }] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    await expect(
      httpSampleProposal("http://w").fetchPool({ address: "a", area: 1 }),
    ).rejects.toThrow(/candidates/);
  });

  it("includes the backend's Polish detail message in the thrown error on 502", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => ({
        detail:
          "Nie udało się pobrać próby z RCN — spróbuj ponownie albo wpisz transakcje ręcznie.",
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    await expect(
      httpSampleProposal("http://w").fetchPool({ address: "a", area: 1 }),
    ).rejects.toThrow("Nie udało się pobrać próby z RCN");
  });

  it("falls back to status text when the error body has no detail", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    await expect(
      httpSampleProposal("http://w").fetchPool({ address: "a", area: 1 }),
    ).rejects.toThrow("worker /sample-proposal responded 500 Internal Server Error");
  });
});
