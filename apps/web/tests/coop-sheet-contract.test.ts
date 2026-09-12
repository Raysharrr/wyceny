import { afterEach, describe, expect, it, vi } from "vitest";
import { httpCoopSheet } from "../src/adapters/coop-sheet-http";
import { httpGeocoder } from "../src/adapters/geocoder-http";
import fixture from "./fixtures/coop-registry-synthetic.sheets.json";

/** Wire contracts of the two worker adapters (S2a): multipart + token, chunking, error detail. */
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("httpCoopSheet", () => {
  it("posts the file and token as multipart and returns the sheets", async () => {
    const fn = mockFetch(fixture);
    const sheets = await httpCoopSheet("http://w").readSheets(
      { bytes: new Uint8Array([1, 2, 3]), name: "rejestr.xlsx" },
      "tok",
    );
    expect(sheets).toEqual(fixture.sheets);
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe("http://w/coop-sheet");
    const form = init.body as FormData;
    expect(form.get("token")).toBe("tok");
    expect((form.get("file") as File).name).toBe("rejestr.xlsx");
  });

  it("surfaces the worker's Polish detail on failure", async () => {
    mockFetch({ detail: "Plik jest za duży (limit 12 MB)." }, 413);
    await expect(
      httpCoopSheet("http://w").readSheets({ bytes: new Uint8Array(), name: "x.xlsx" }, "tok"),
    ).rejects.toThrow("Plik jest za duży (limit 12 MB).");
  });
});

describe("httpGeocoder", () => {
  it("chunks by 50, keeps order, passes null through", async () => {
    const fn = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const { addresses } = JSON.parse(init.body as string) as { addresses: string[] };
      return new Response(
        JSON.stringify({
          results: addresses.map((a, i) =>
            a.endsWith("brak") ? null : { x: i, y: 0, source: "uug" },
          ),
        }),
      );
    });
    global.fetch = fn as unknown as typeof fetch;
    const addresses = Array.from({ length: 120 }, (_, i) =>
      i === 7 ? "Poznań, brak" : `Poznań, Zmyślona ${i}`,
    );
    const out = await httpGeocoder("http://w").geocodeMany(addresses, "tok");
    expect(out).toHaveLength(120);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(out[7]).toBeNull();
    expect(out[50]).toEqual({ x: 0, y: 0, source: "uug" });
    expect(JSON.parse(fn.mock.calls[0]![1].body).token).toBe("tok");
  });
});
