// Deterministic 1280x720 PNG cover stand-ins. No dependency (not even node:zlib): integer-only pixels, a fixed-Huffman deflate
// with a fixed match search, CRC-32 and Adler-32 written here, so the bytes depend on nothing but this file and COVER_COLORS.
// Chrome and the native apps decode the same bitmap from the same bytes.
import { COVER_COLORS } from './snapshot.ts';

export const COVER_WIDTH = 1280;
export const COVER_HEIGHT = 720;
/** Ring: centre of the image, radius 160 px, 24 px wide, white at 35% over the gradient (the SVG stand-in's shape). */
const RING_INNER = 160 - 12;
const RING_OUTER = 160 + 12;

/**
 * Flat marker patches (notes/T045 R8, REPL-a's image-flat sample rule): the gradient has almost no source region that is uniform
 * over a resampling filter's support, so squares of one colour sit where the lane's sample grid (fractions 1/4, 1/2 and 3/4 of
 * the drawn part) lands under object-fit contain (the library covers: the whole image) and cover (the record: the centre 720 x
 * 720). The largest support is at the smallest scale, a 104 CSS px library cover at DPR 2: ceil(1280 / 208) + 2 = 9 source px.
 * Each patch reaches MARKER_REACH source px from its centre: that support plus 16 source px.
 */
export const MARKER_SUPPORT_SOURCE_PX = 9;
export const MARKER_REACH = MARKER_SUPPORT_SOURCE_PX + 16;
/** Patch centres in source px: the shared centre, the contain quarter points, then the cover quarter points. */
export const MARKER_CENTRES: readonly (readonly [number, number])[] = [
  [640, 360],
  [320, 180], [960, 180], [320, 540], [960, 540],
  [460, 180], [820, 180], [460, 540], [820, 540],
];

/** The marker patch that holds source pixel (x, y), or -1. */
export function markerAt(x: number, y: number): number {
  return MARKER_CENTRES.findIndex(([cx, cy]) => Math.abs(x - cx) <= MARKER_REACH && Math.abs(y - cy) <= MARKER_REACH);
}

/** The video ids with a cover, in COVER_COLORS order. */
export const COVER_IDS: readonly string[] = Object.keys(COVER_COLORS);

export const coverFile = (videoId: string): string => `covers/${videoId}.png`;

function hexColor(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error(`bad colour ${hex}`);
  return [parseInt(m[1] as string, 16), parseInt(m[2] as string, 16), parseInt(m[3] as string, 16)];
}

/**
 * RGB bytes, row-major. The gradient runs along x + y (top-left to bottom-right), so row y is row y-1 shifted by one pixel,
 * outside the marker patches.
 */
export function coverPixels(videoId: string): Uint8Array {
  const colors = COVER_COLORS[videoId];
  if (colors === undefined) throw new Error(`no cover colours for ${videoId}`);
  const c0 = hexColor(colors[0]);
  const c1 = hexColor(colors[1]);
  const span = COVER_WIDTH + COVER_HEIGHT - 2;
  const out = new Uint8Array(COVER_WIDTH * COVER_HEIGHT * 3);
  for (let y = 0; y < COVER_HEIGHT; y++) {
    const dy = 2 * y + 1 - COVER_HEIGHT;
    for (let x = 0; x < COVER_WIDTH; x++) {
      const s = x + y;
      const dx = 2 * x + 1 - COVER_WIDTH;
      const d = dx * dx + dy * dy;
      const ring = d >= 4 * RING_INNER * RING_INNER && d <= 4 * RING_OUTER * RING_OUTER;
      const marker = markerAt(x, y);
      if (marker >= 0) {
        // A patch takes the far end's colour of the gradient where it sits, so it stands out.
        const [cx, cy] = MARKER_CENTRES[marker] as readonly [number, number];
        out.set(2 * (cx + cy) < span ? c1 : c0, (y * COVER_WIDTH + x) * 3);
        continue;
      }
      for (let c = 0; c < 3; c++) {
        let v = Math.floor((2 * ((c0[c] as number) * (span - s) + (c1[c] as number) * s) + span) / (2 * span));
        if (ring) v = Math.floor((v * 65 + 255 * 35 + 50) / 100);
        out[(y * COVER_WIDTH + x) * 3 + c] = v;
      }
    }
  }
  return out;
}

class BitWriter {
  private readonly bytes: number[] = [];
  private cur = 0;
  private n = 0;
  /** value's low `count` bits, least significant first (deflate extra bits and header fields). */
  bits(value: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.cur |= ((value >>> i) & 1) << this.n;
      if (++this.n === 8) this.flush();
    }
  }
  /** A Huffman code, most significant bit first. */
  code(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bits((value >>> i) & 1, 1);
  }
  private flush(): void {
    this.bytes.push(this.cur);
    this.cur = 0;
    this.n = 0;
  }
  finish(): Uint8Array {
    if (this.n > 0) this.flush();
    return Uint8Array.from(this.bytes);
  }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function literalLength(w: BitWriter, sym: number): void {
  if (sym < 144) w.code(0x30 + sym, 8);
  else if (sym < 256) w.code(0x190 + sym - 144, 9);
  else if (sym < 280) w.code(sym - 256, 7);
  else w.code(0xc0 + sym - 280, 8);
}

function lastIndexAtMost(table: readonly number[], v: number): number {
  let i = table.length - 1;
  while ((table[i] as number) > v) i--;
  return i;
}

/** One fixed-Huffman deflate block; matches are tried only at the given distances, longest first-found wins. */
export function deflateFixed(data: Uint8Array, distances: readonly number[]): Uint8Array {
  const w = new BitWriter();
  w.bits(1, 1);
  w.bits(1, 2);
  let i = 0;
  while (i < data.length) {
    let bestLen = 0;
    let bestDist = 0;
    for (const d of distances) {
      if (d > i || d > 32768) continue;
      const max = Math.min(258, data.length - i);
      let len = 0;
      while (len < max && data[i + len] === data[i + len - d]) len++;
      if (len > bestLen) {
        bestLen = len;
        bestDist = d;
      }
    }
    if (bestLen >= 3) {
      const li = lastIndexAtMost(LENGTH_BASE, bestLen);
      literalLength(w, 257 + li);
      w.bits(bestLen - (LENGTH_BASE[li] as number), LENGTH_EXTRA[li] as number);
      const di = lastIndexAtMost(DIST_BASE, bestDist);
      w.code(di, 5);
      w.bits(bestDist - (DIST_BASE[di] as number), DIST_EXTRA[di] as number);
      i += bestLen;
    } else {
      literalLength(w, data[i] as number);
      i++;
    }
  }
  literalLength(w, 256);
  return w.finish();
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: readonly Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (const b of p) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const v of data) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (v: number): Uint8Array => Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);

function chunk(type: string, body: Uint8Array): Uint8Array[] {
  const t = Uint8Array.from(type, (ch) => ch.charCodeAt(0));
  return [u32(body.length), t, body, u32(crc32([t, body]))];
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** An 8-bit RGB PNG with filter 0 on every row. */
export function encodeRgbPng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (rgb.length !== width * height * 3) throw new Error('pixel buffer size does not match');
  const stride = 1 + width * 3;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * stride + 1);
  // Distances: previous pixel, the pixel up-right (the diagonal gradient), the pixel above.
  const zlib = concat([Uint8Array.of(0x78, 0x01), deflateFixed(raw, [stride - 3, stride, 3]), u32(adler32(raw))]);
  const ihdr = concat([u32(width), u32(height), Uint8Array.of(8, 2, 0, 0, 0)]);
  return concat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), ...chunk('IHDR', ihdr), ...chunk('IDAT', zlib), ...chunk('IEND', new Uint8Array(0))]);
}

export function coverPng(videoId: string): Uint8Array {
  return encodeRgbPng(COVER_WIDTH, COVER_HEIGHT, coverPixels(videoId));
}
