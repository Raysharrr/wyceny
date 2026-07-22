/**
 * Byte-level JPEG builder helpers, shared by jpeg-utils.test.ts (pure lib
 * unit tests) and inspection-actions.test.ts (the FR-2 trust-boundary tests
 * for the upload server action) — extracted here (Task 5) so both suites
 * build the exact same synthetic markers instead of drifting copies.
 */

/** Minimal marker stream: SOI + segments; SOF0 carries [prec, H, H, W, W]. */
export function jpegOf(segments: Array<{ marker: number; payload: Buffer }>): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  for (const s of segments) {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(s.payload.length + 2);
    parts.push(Buffer.from([0xff, s.marker]) as Buffer, len as Buffer, s.payload as Buffer);
  }
  return Buffer.concat(parts);
}

export const sof0 = (w: number, h: number) => {
  const p = Buffer.alloc(5);
  p[0] = 8;
  p.writeUInt16BE(h, 1);
  p.writeUInt16BE(w, 3);
  return { marker: 0xc0, payload: p };
};

export const exifApp1 = {
  marker: 0xe1,
  payload: Buffer.concat([Buffer.from("Exif\0\0"), Buffer.alloc(4)]),
};

export const xmpApp1 = { marker: 0xe1, payload: Buffer.from("http://ns.adobe.com/xap/1.0/\0") };
