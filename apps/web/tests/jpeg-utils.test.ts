import { describe, expect, it } from "vitest";
import { fitBox, hasApp1, isJpeg, jpegDimensions } from "../src/lib/jpeg";

/** Minimal marker stream: SOI + segments; SOF0 carries [prec, H, H, W, W]. */
function jpegOf(segments: Array<{ marker: number; payload: Buffer }>): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  for (const s of segments) {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(s.payload.length + 2);
    parts.push(Buffer.from([0xff, s.marker]) as Buffer, len as Buffer, s.payload as Buffer);
  }
  return Buffer.concat(parts);
}
const sof0 = (w: number, h: number) => {
  const p = Buffer.alloc(5);
  p[0] = 8;
  p.writeUInt16BE(h, 1);
  p.writeUInt16BE(w, 3);
  return { marker: 0xc0, payload: p };
};
const exifApp1 = {
  marker: 0xe1,
  payload: Buffer.concat([Buffer.from("Exif\0\0"), Buffer.alloc(4)]),
};
const xmpApp1 = { marker: 0xe1, payload: Buffer.from("http://ns.adobe.com/xap/1.0/\0") };

describe("jpeg utils", () => {
  it("isJpeg checks the SOI+marker magic", () => {
    expect(isJpeg(jpegOf([sof0(10, 20)]))).toBe(true);
    expect(isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(Buffer.alloc(0))).toBe(false);
  });
  it("hasApp1 rejects EVERY APP1 segment — Exif AND XMP (XMP carries GPS too)", () => {
    expect(hasApp1(jpegOf([exifApp1, sof0(10, 20)]))).toBe(true);
    expect(hasApp1(jpegOf([xmpApp1, sof0(10, 20)]))).toBe(true); // advisor I-2: XMP-GPS bypass
    expect(hasApp1(jpegOf([sof0(10, 20)]))).toBe(false);
  });
  it("jpegDimensions reads SOF0 landscape and portrait", () => {
    expect(jpegDimensions(jpegOf([sof0(1200, 800)]))).toEqual({ width: 1200, height: 800 });
    expect(jpegDimensions(jpegOf([exifApp1, sof0(600, 900)]))).toEqual({ width: 600, height: 900 });
    expect(jpegDimensions(Buffer.from("plain text"))).toBeNull();
  });
  it("fitBox preserves aspect, landscape and portrait, and never upscales", () => {
    expect(fitBox({ width: 1200, height: 800 }, [600, 450])).toEqual([600, 400]);
    expect(fitBox({ width: 800, height: 1200 }, [600, 450])).toEqual([300, 450]);
    expect(fitBox({ width: 300, height: 200 }, [600, 450])).toEqual([300, 200]);
  });
});
