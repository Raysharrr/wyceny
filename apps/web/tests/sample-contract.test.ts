import { describe, it, expect, vi } from "vitest";
import { httpSampleProposal } from "../src/adapters/sample-http";

describe("PortSampleProposal contract", () => {
  it("posts address+area and maps the full response (transactions + meta)", async () => {
    const responseBody = {
      transactions: [{ date: "2026-05", area: 48.5, pricePerM2: 12500, transactionId: "abc-123" }],
      meta: {
        lat: 52.2297,
        lon: 21.0122,
        fetchedAt: "2026-07-14T10:00:00.000Z",
        source: "rcn-wfs-gugik",
        query: { bbox: [52.2117, 20.9832, 52.2477, 21.0412], count: 5000, sort: "dok_data D" },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => responseBody,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    global.fetch = fetchMock;

    const port = httpSampleProposal("http://worker.test");
    const result = await port.fetchProposal("ul. Testowa 1, Warszawa", 48.5);

    expect(fetchMock).toHaveBeenCalledWith("http://worker.test/sample-proposal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: "ul. Testowa 1, Warszawa", area: 48.5 }),
    });
    expect(result).toEqual(responseBody);
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

    const port = httpSampleProposal("http://worker.test");
    await expect(port.fetchProposal("ul. Testowa 1, Warszawa", 48.5)).rejects.toThrow(
      "Nie udało się pobrać próby z RCN — spróbuj ponownie albo wpisz transakcje ręcznie.",
    );
  });

  it("falls back to status text when the error body has no detail", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const port = httpSampleProposal("http://worker.test");
    await expect(port.fetchProposal("ul. Testowa 1, Warszawa", 48.5)).rejects.toThrow(
      /500.*Internal Server Error/,
    );
  });
});
