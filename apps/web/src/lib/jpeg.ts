/**
 * Byte-level JPEG helpers (Slice 10) — the SERVER-SIDE trust boundary for
 * inspection photos. Processed bytes arrive from the CLIENT (unlike maps,
 * which the server fetched itself), so the RODO guarantee "no EXIF/GPS in
 * the operat" must be enforced here, independently of the worker: magic
 * bytes, APP1/Exif absence, and dimensions all checked on raw bytes.
 * Pure — no I/O, no deps (F-10-friendly, usable from domain-adjacent code).
 */

export function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * Walks JPEG segments up to SOS; true iff ANY APP1 segment exists. APP1
 * carries Exif (GPS/device) but ALSO XMP — and XMP can carry GPS too
 * (exif:GPSLatitude), so an "Exif"-only check would leave an XMP bypass
 * (advisor I-2). The worker's Pillow re-encode emits NO APP1 at all, so
 * rejecting every APP1 has zero false positives on legit uploads.
 */
export function hasApp1(buf: Buffer): boolean {
  if (!isJpeg(buf)) return false;
  let off = 2;
  while (off + 4 < buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    if (marker === 0xda) break; // SOS — entropy-coded data, no more metadata
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xe1) {
      return true;
    }
    off += 2 + len;
  }
  return false;
}

/** Reads dimensions from the first SOF0-SOF15 frame header (C4/C8/CC are not SOFs). */
export function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (!isJpeg(buf)) return null;
  let off = 2;
  while (off + 8 < buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    if (marker === 0xda) break;
    const len = buf.readUInt16BE(off + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

/** Scales dims to fit box (w,h), preserving aspect; never upscales. */
export function fitBox(
  dims: { width: number; height: number },
  box: [number, number],
): [number, number] {
  const scale = Math.min(box[0] / dims.width, box[1] / dims.height, 1);
  return [Math.round(dims.width * scale), Math.round(dims.height * scale)];
}
