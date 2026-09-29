// PNG chunk parse (PNG 3rd edition) and an RGBA8 decode for bit depths up to 8. The core uses no Node built-ins, so the
// build-time caller passes the zlib inflate (node:zlib inflateSync).

export type Inflate = (data: Uint8Array) => Uint8Array;

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export type PngColourType = 0 | 2 | 3 | 4 | 6;

export type PngFacts = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: PngColourType;
  readonly interlaced: boolean;
  /** Chunk types in file order, IDAT counted once per chunk. */
  readonly chunks: readonly string[];
  readonly hasTrns: boolean;
  /** The sRGB rendering intent, or null without an sRGB chunk. */
  readonly srgbIntent: number | null;
  readonly hasIccp: boolean;
  /** gAMA as stored (gamma x 100000), or null. */
  readonly gama: number | null;
  readonly hasChrm: boolean;
  readonly hasCicp: boolean;
  /** acTL present: an animated PNG. */
  readonly animated: boolean;
  /** pHYs as stored: pixels per unit on x and y, and the unit (1 = metre). */
  readonly phys: { readonly x: number; readonly y: number; readonly unit: number } | null;
};

export type PngParse =
  | { readonly ok: true; readonly facts: PngFacts; readonly palette: Uint8Array | null; readonly trns: Uint8Array | null; readonly idat: Uint8Array }
  | { readonly ok: false; readonly reason: string };

const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (b: Uint8Array, at: number): number => (((b[at] as number) << 24) | ((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number)) >>> 0;

const VALID_DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CHANNELS: Readonly<Record<PngColourType, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Parses the chunk stream: signature, CRCs, IHDR, the colour chunks, tRNS, acTL and the IDAT data. */
export function parsePng(bytes: Uint8Array): PngParse {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return { ok: false, reason: 'no PNG signature' };
  let at = 8;
  const chunks: string[] = [];
  let ihdr: Uint8Array | null = null;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let srgbIntent: number | null = null;
  let gama: number | null = null;
  let hasIccp = false;
  let hasChrm = false;
  let hasCicp = false;
  let animated = false;
  let phys: PngFacts['phys'] = null;
  let ended = false;
  while (!ended) {
    if (at + 12 > bytes.length) return { ok: false, reason: 'truncated chunk stream' };
    const length = u32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (at + 12 + length > bytes.length) return { ok: false, reason: `truncated ${type} chunk` };
    if (crc32(bytes, at + 4, at + 8 + length) !== u32(bytes, at + 8 + length)) return { ok: false, reason: `${type} CRC mismatch` };
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (chunks.length === 0 && type !== 'IHDR') return { ok: false, reason: 'first chunk is not IHDR' };
    chunks.push(type);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'sRGB') srgbIntent = data[0] ?? null;
    else if (type === 'gAMA') gama = u32(data, 0);
    else if (type === 'iCCP') hasIccp = true;
    else if (type === 'cHRM') hasChrm = true;
    else if (type === 'cICP') hasCicp = true;
    else if (type === 'acTL') animated = true;
    else if (type === 'pHYs') phys = { x: u32(data, 0), y: u32(data, 4), unit: data[8] ?? 0 };
    else if (type === 'IEND') ended = true;
    at += 12 + length;
  }
  if (ihdr === null || ihdr.length !== 13) return { ok: false, reason: 'bad IHDR' };
  const width = u32(ihdr, 0);
  const height = u32(ihdr, 4);
  const bitDepth = ihdr[8] as number;
  const colourType = ihdr[9] as number;
  if (width === 0 || height === 0) return { ok: false, reason: 'zero image size' };
  if (!(colourType in VALID_DEPTHS) || !(VALID_DEPTHS[colourType] as readonly number[]).includes(bitDepth)) return { ok: false, reason: `invalid colour type ${colourType} at bit depth ${bitDepth}` };
  if (ihdr[10] !== 0 || ihdr[11] !== 0 || (ihdr[12] !== 0 && ihdr[12] !== 1)) return { ok: false, reason: 'unknown compression, filter or interlace method' };
  if (colourType === 3 && palette === null) return { ok: false, reason: 'palette image without PLTE' };
  if (idat.length === 0) return { ok: false, reason: 'no IDAT' };
  const total = idat.reduce((n, d) => n + d.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const d of idat) {
    joined.set(d, o);
    o += d.length;
  }
  const facts: PngFacts = {
    width, height, bitDepth, colourType: colourType as PngColourType, interlaced: ihdr[12] === 1, chunks,
    hasTrns: trns !== null, srgbIntent, hasIccp, gama, hasChrm, hasCicp, animated, phys,
  };
  return { ok: true, facts, palette, trns, idat: joined };
}

/** Why Chrome's decode of this PNG is not the plain 8-bit sRGB decode (R3), with the package that owns it; null when it is. */
export function pngColourRefusal(f: PngFacts): { readonly package: 'REPL-c' | 'REPL-an'; readonly reason: string } | null {
  if (f.animated) return { package: 'REPL-an', reason: 'an animated PNG (acTL)' };
  if (f.bitDepth === 16) return { package: 'REPL-c', reason: 'a 16-bit PNG' };
  if (f.hasCicp) return { package: 'REPL-c', reason: 'a cICP colour space' };
  if (f.hasIccp) return { package: 'REPL-c', reason: 'an embedded ICC profile (iCCP)' };
  if (f.srgbIntent === null && (f.gama !== null || f.hasChrm)) return { package: 'REPL-c', reason: 'gAMA or cHRM without sRGB' };
  return null;
}

const ADAM7: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
];

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = p > a ? p - a : a - p;
  const pb = p > b ? p - b : b - p;
  const pc = p > c ? p - c : c - p;
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Reverses the scanline filters of one (sub)image in place; returns the offset after it. */
function unfilter(data: Uint8Array, at: number, rows: number, rowBytes: number, bpp: number): number {
  let prev = -1;
  for (let y = 0; y < rows; y++) {
    const filter = data[at];
    const row = at + 1;
    if (filter === undefined || row + rowBytes > data.length) throw new Error('PNG image data is truncated');
    for (let i = 0; i < rowBytes; i++) {
      const x = data[row + i] as number;
      const a = i >= bpp ? (data[row + i - bpp] as number) : 0;
      const b = prev >= 0 ? (data[prev + i] as number) : 0;
      const c = prev >= 0 && i >= bpp ? (data[prev + i - bpp] as number) : 0;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >>> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      else throw new Error(`unknown PNG filter ${filter}`);
      data[row + i] = v & 0xff;
    }
    prev = row;
    at = row + rowBytes;
  }
  return at;
}

export type Rgba8 = { readonly width: number; readonly height: number; readonly data: Uint8Array };

/**
 * Decodes to unpremultiplied RGBA8 with no colour conversion, the way libpng hands Chrome an 8-bit sRGB image: samples below
 * 8 bits are scaled by 255 / (2^depth - 1), and tRNS applies as stored. 16-bit images are refused (R3).
 */
export function decodePng(bytes: Uint8Array, inflate: Inflate): Rgba8 {
  const p = parsePng(bytes);
  if (!p.ok) throw new Error(p.reason);
  const { width, height, bitDepth, colourType, interlaced } = p.facts;
  if (bitDepth > 8) throw new Error('a 16-bit PNG is not decoded (REPL-c)');
  const channels = CHANNELS[colourType];
  const bitsPerPixel = channels * bitDepth;
  const bpp = bitsPerPixel >= 8 ? bitsPerPixel >>> 3 : 1;
  const raw = inflate(p.idat);
  const out = new Uint8Array(width * height * 4);
  const scale = bitDepth === 8 ? 1 : 255 / ((1 << bitDepth) - 1);
  const palette = p.palette;
  const trns = p.trns;
  const trnsGrey = colourType === 0 && trns !== null && trns.length >= 2 ? ((trns[0] as number) << 8) | (trns[1] as number) : -1;
  const trnsRgb = colourType === 2 && trns !== null && trns.length >= 6
    ? [((trns[0] as number) << 8) | (trns[1] as number), ((trns[2] as number) << 8) | (trns[3] as number), ((trns[4] as number) << 8) | (trns[5] as number)]
    : null;
  const sample = (row: number, index: number): number => {
    if (bitDepth === 8) return raw[row + index] as number;
    const bit = index * bitDepth;
    const byte = raw[row + (bit >>> 3)] as number;
    return (byte >>> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
  };
  const put = (x: number, y: number, row: number, i: number): void => {
    const o = (y * width + x) * 4;
    const s = i * channels;
    if (colourType === 0) {
      const g = sample(row, s);
      const v = g * scale;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = g === trnsGrey ? 0 : 255;
    } else if (colourType === 2) {
      const r = sample(row, s);
      const g = sample(row, s + 1);
      const b = sample(row, s + 2);
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = trnsRgb !== null && r === trnsRgb[0] && g === trnsRgb[1] && b === trnsRgb[2] ? 0 : 255;
    } else if (colourType === 3) {
      const k = sample(row, s);
      if (palette === null || k * 3 + 2 >= palette.length) throw new Error(`palette index ${k} is outside PLTE`);
      out[o] = palette[k * 3] as number;
      out[o + 1] = palette[k * 3 + 1] as number;
      out[o + 2] = palette[k * 3 + 2] as number;
      out[o + 3] = trns !== null && k < trns.length ? (trns[k] as number) : 255;
    } else if (colourType === 4) {
      const g = sample(row, s);
      out[o] = g;
      out[o + 1] = g;
      out[o + 2] = g;
      out[o + 3] = sample(row, s + 1);
    } else {
      out[o] = sample(row, s);
      out[o + 1] = sample(row, s + 1);
      out[o + 2] = sample(row, s + 2);
      out[o + 3] = sample(row, s + 3);
    }
  };
  const rowBytesOf = (w: number): number => ((w * bitsPerPixel + 7) >>> 3);
  let at = 0;
  const passes = interlaced ? ADAM7 : ([[0, 0, 1, 1]] as const);
  for (const [x0, y0, dx, dy] of passes) {
    const pw = width > x0 ? ((width - x0 + dx - 1) / dx) | 0 : 0;
    const ph = height > y0 ? ((height - y0 + dy - 1) / dy) | 0 : 0;
    if (pw === 0 || ph === 0) continue;
    const rowBytes = rowBytesOf(pw);
    const start = at;
    at = unfilter(raw, at, ph, rowBytes, bpp);
    for (let py = 0; py < ph; py++) {
      const row = start + py * (rowBytes + 1) + 1;
      for (let px = 0; px < pw; px++) put(x0 + px * dx, y0 + py * dy, row, px);
    }
  }
  return { width, height, data: out };
}
