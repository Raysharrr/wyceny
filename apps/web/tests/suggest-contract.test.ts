import { afterEach, describe, expect, it, vi } from "vitest";
import { httpAddressSuggest } from "../src/adapters/suggest-http";

const suggestions = [
  {
    label: "Poznań, Sielawy",
    city: "Poznań",
    street: "Sielawy",
    number: null,
    teryt: "306401",
    inCoverage: true,
  },
  {
    label: "Poznań, Sielska",
    city: "Poznań",
    street: "Sielska",
    number: null,
    teryt: "306401",
    inCoverage: true,
  },
];

afterEach(() => vi.unstubAllGlobals());

describe("httpAddressSuggest", () => {
  it("returns suggestions on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions }), { status: 200 })),
    );
    expect(await httpAddressSuggest("http://w").suggest("Poznań, Siel")).toEqual(suggestions);
  });

  it("posts the query with trace headers to /address-suggest", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ suggestions: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await httpAddressSuggest("http://w").suggest("Poznań, Siel");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://w/address-suggest");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ query: "Poznań, Siel" }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("collapses a non-ok response to an empty list (total — never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 502 })));
    expect(await httpAddressSuggest("http://w").suggest("Poznań, Siel")).toEqual([]);
  });

  it("collapses a network error / timeout to an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("The operation was aborted")));
    expect(await httpAddressSuggest("http://w").suggest("Poznań, Siel")).toEqual([]);
  });

  it("collapses a malformed body to an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    expect(await httpAddressSuggest("http://w").suggest("Poznań, Siel")).toEqual([]);
  });
});
