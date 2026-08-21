import { describe, it, expect, vi } from "vitest";
import { googleStreetView } from "../src/adapters/street-view-google";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("googleStreetView adapter", () => {
  it("lookup: OK → panoId, date, camera position; request carries key, radius, source=outdoor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        status: "OK",
        pano_id: "P1",
        date: "2023-07",
        location: { lat: 52.3947, lng: 16.8723 },
      }),
    );
    const sv = googleStreetView("KEY", fetchMock as unknown as typeof fetch);
    const meta = await sv.lookup({ lat: 52.3946835, lng: 16.8724944 }, 50);
    expect(meta).toEqual({
      panoId: "P1",
      captureDate: "2023-07",
      camera: { lat: 52.3947, lng: 16.8723 },
    });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(
      "https://maps.googleapis.com/maps/api/streetview/metadata",
    );
    expect(url.searchParams.get("key")).toBe("KEY");
    expect(url.searchParams.get("radius")).toBe("50");
    expect(url.searchParams.get("source")).toBe("outdoor");
    expect(url.searchParams.get("location")).toBe("52.3946835,16.8724944");
  });
  it("lookup: ZERO_RESULTS → null (no panorama is data, not an error)", async () => {
    const sv = googleStreetView(
      "KEY",
      vi.fn().mockResolvedValue(json({ status: "ZERO_RESULTS" })) as unknown as typeof fetch,
    );
    expect(await sv.lookup({ lat: 1, lng: 2 }, 50)).toBeNull();
  });
  it("lookup: REQUEST_DENIED / HTTP 403 → throws (a bad key must surface, never masquerade as 'no panorama')", async () => {
    const sv = googleStreetView(
      "KEY",
      vi
        .fn()
        .mockResolvedValue(
          json({ status: "REQUEST_DENIED", error_message: "bad key" }),
        ) as unknown as typeof fetch,
    );
    await expect(sv.lookup({ lat: 1, lng: 2 }, 50)).rejects.toThrow(/REQUEST_DENIED/);
  });
  it("thumbnail: 160x100 by pano with heading, returns JPEG bytes", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } }),
      );
    const sv = googleStreetView("KEY", fetchMock as unknown as typeof fetch);
    const buf = await sv.thumbnail("P1", 123.4);
    expect(buf.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/maps/api/streetview");
    expect(url.searchParams.get("size")).toBe("160x100");
    expect(url.searchParams.get("pano")).toBe("P1");
    expect(url.searchParams.get("heading")).toBe("123");
    expect(url.searchParams.get("fov")).toBe("80");
  });
});
