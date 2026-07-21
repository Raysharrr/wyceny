import { afterEach, describe, expect, it, vi } from "vitest";
import { httpMapImages } from "../src/adapters/maps-http";

const b64 = (buf: Buffer) => buf.toString("base64");
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const JPG = Buffer.from("ffd8ffe0", "hex");

afterEach(() => vi.unstubAllGlobals());

describe("httpMapImages contract", () => {
  it("decodes base64 maps on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ewidencyjna: b64(PNG),
            orto: b64(JPG),
            parcelId: "p1",
            fetchedAt: "2026-07-21T00:00:00Z",
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await httpMapImages("http://worker").fetchMaps("Poznań, Testowa 1");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.maps.ewidencyjna.subarray(0, 4)).toEqual(PNG.subarray(0, 4));
      expect(result.maps.orto.subarray(0, 2)).toEqual(JPG.subarray(0, 2));
    }
  });

  it("maps 422 to unavailable with the worker's Polish detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ detail: "Mapy do operatu dostępne na razie dla Poznania." }),
          {
            status: 422,
          },
        ),
      ),
    );
    const result = await httpMapImages("http://worker").fetchMaps("Warszawa 1");
    expect(result).toEqual({
      kind: "unavailable",
      message: "Mapy do operatu dostępne na razie dla Poznania.",
    });
  });

  it("maps network failure to unavailable (adapter never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await httpMapImages("http://worker").fetchMaps("Poznań, Testowa 1");
    expect(result.kind).toBe("unavailable");
  });

  it("maps a non-2xx response with a non-JSON body to unavailable with the generic message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>gateway error</html>", { status: 502 })),
    );
    const result = await httpMapImages("http://worker").fetchMaps("Poznań, Testowa 1");
    expect(result).toEqual({
      kind: "unavailable",
      message: "Usługa map (Geoportal) jest chwilowo niedostępna.",
    });
  });

  it("maps a 200 response with a malformed JSON body to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json{", { status: 200 })));
    const result = await httpMapImages("http://worker").fetchMaps("Poznań, Testowa 1");
    expect(result.kind).toBe("unavailable");
  });
});
