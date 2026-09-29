// T109 SKIA-0: the linear-gradient and dither reference (src/paint-dither.ts) against Chrome 145's CPU raster, captured by
// scripts/capture-skia-oracle.ts into docs/research/skia-oracle. Every oracle pixel must equal the reference at channel
// delta 0; each planted fault must make some pixel differ.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { DitherFaults, LinearGradientSpec, Rgba8 } from '../src/paint-dither.ts';
import { ccTileIndex, ccTileSize, ccTileStart, ditherIndex, fma32, gradientPixel, linearGradientShader, NO_DITHER_FAULTS, roundHalfEven } from '../src/paint-dither.ts';

type Crop = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
type GradientCase = { readonly id: string; readonly family: 'gradient'; readonly dpr: number; readonly device: LinearGradientSpec; readonly crop: Crop; readonly file: string };
type Manifest = { readonly cases: readonly ({ readonly family: string } & Record<string, unknown>)[] };

const DIR = new URL('../../../docs/research/skia-oracle/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8')) as Manifest;
const gradients = manifest.cases.filter((c) => c.family === 'gradient') as unknown as GradientCase[];
const WHITE: Rgba8 = { r: 255, g: 255, b: 255, a: 255 };

/** RGB pixels of an 8-bit non-interlaced truecolor PNG. */
function rgbPng(buf: Buffer): Uint8Array {
  let p = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const n = buf.readUInt32BE(p);
    const t = buf.toString('ascii', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + n);
    if (t === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      if (d[8] !== 8 || d[9] !== 2 || d[12] !== 0) throw new Error('expected an 8-bit RGB PNG');
    } else if (t === 'IDAT') idat.push(d);
    p += 12 + n;
  }
  const s = w * 3;
  const r = inflateSync(Buffer.concat(idat));
  const o = new Uint8Array(h * s);
  for (let y = 0; y < h; y++) {
    const f = r[y * (s + 1)] as number;
    for (let x = 0; x < s; x++) {
      const a = x >= 3 ? (o[y * s + x - 3] as number) : 0;
      const b = y > 0 ? (o[(y - 1) * s + x] as number) : 0;
      const c = x >= 3 && y > 0 ? (o[(y - 1) * s + x - 3] as number) : 0;
      const pp = a + b - c;
      const pa = Math.abs(pp - a);
      const pb = Math.abs(pp - b);
      const pc = Math.abs(pp - c);
      const q = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      o[y * s + x] = ((r[y * (s + 1) + 1 + x] as number) + q) & 255;
    }
  }
  return o;
}

const pixels = new Map<string, Uint8Array>();
for (const c of gradients) pixels.set(c.file, rgbPng(readFileSync(new URL(c.file, DIR))));

function differing(c: GradientCase, faults: DitherFaults): { readonly pixels: number; readonly differ: number; readonly first: string | null } {
  const shader = linearGradientShader(c.device, faults);
  const px = pixels.get(c.file) as Uint8Array;
  const w = c.crop.right - c.crop.left;
  let differ = 0;
  let first: string | null = null;
  for (let i = 0; i < px.length / 3; i++) {
    const x = c.crop.left + (i % w);
    const y = c.crop.top + Math.floor(i / w);
    const p = gradientPixel(shader, x, y, WHITE, faults);
    if (px[3 * i] !== p.r || px[3 * i + 1] !== p.g || px[3 * i + 2] !== p.b) {
      differ++;
      if (first === null) first = `${c.file} (${x},${y}): chrome ${px[3 * i]},${px[3 * i + 1]},${px[3 * i + 2]}, reference ${p.r},${p.g},${p.b}`;
    }
  }
  return { pixels: px.length / 3, differ, first };
}

describe('SKIA-0 gradient dither: Chrome 145 oracle', () => {
  it('every oracle pixel equals the reference at channel delta 0 at every DPR', () => {
    const byDpr = new Map<number, number>();
    for (const c of gradients) {
      const d = differing(c, NO_DITHER_FAULTS);
      expect(d.first, d.first ?? '').toBeNull();
      byDpr.set(c.dpr, (byDpr.get(c.dpr) ?? 0) + d.pixels);
    }
    for (const dpr of [2, 3, 2.625]) expect(byDpr.get(dpr) ?? 0, `DPR ${dpr}`).toBeGreaterThan(100000);
  }, 300_000);

  it('covers the two-stop, evenly spaced and arbitrary-position stages, opaque and translucent, across tile edges', () => {
    const kinds = new Set<string>();
    for (const c of gradients) {
      const s = linearGradientShader(c.device, NO_DITHER_FAULTS);
      kinds.add(`${s.kind} ${s.opaque ? 'opaque' : 'translucent'}`);
      if (s.kind === 'stops' || s.kind === 'two') {
        const span = c.device.axis === 'x' ? [c.crop.left, c.crop.right - 1] : [c.crop.top, c.crop.bottom - 1];
        if (c.id.startsWith('dark') || c.id === 'uneven') expect(ccTileIndex(span[1] as number, c.device.tileSize), c.file).toBeGreaterThan(ccTileIndex(span[0] as number, c.device.tileSize));
      }
    }
    expect([...kinds].sort()).toEqual(['even opaque', 'stops opaque', 'two opaque', 'two translucent']);
  });

  const plants: readonly (keyof DitherFaults)[] = ['ditherDisabled', 'ditherPhaseShift', 'gradientUnpremultiplied'];
  for (const plant of plants) {
    it(`planted ${plant} is caught by the oracle`, () => {
      const faults: DitherFaults = { ...NO_DITHER_FAULTS, [plant]: true };
      let differ = 0;
      for (const c of gradients) differ += differing(c, faults).differ;
      expect(differ).toBeGreaterThan(0);
    }, 300_000);
  }
});

describe('SKIA-0 raster pipeline arithmetic', () => {
  it('the dither matrix is Skia 1/64 x [0 48 12 60 3 51 15 63 ...] and repeats every 8 px', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((x) => ditherIndex(x, 0))).toEqual([0, 48, 12, 60, 3, 51, 15, 63]);
    const seen = new Set<number>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      seen.add(ditherIndex(x, y));
      expect(ditherIndex(x + 8, y + 16)).toBe(ditherIndex(x, y));
    }
    expect(seen.size).toBe(64);
  });

  it('cc tiles: 512 px on Mac at DPR >= 2, one border texel, so tile 1 starts at 510', () => {
    expect(ccTileSize(true, 2)).toBe(512);
    expect(ccTileSize(true, 1)).toBe(256);
    expect(ccTileSize(false, 3)).toBe(256);
    expect([0, 510, 511, 1020, 1021].map((v) => ccTileIndex(v, 512))).toEqual([0, 0, 1, 1, 2]);
    expect([0, 1, 2].map((i) => ccTileStart(i, 512))).toEqual([0, 510, 1020]);
  });

  it('fma32 rounds a * b + c once to float32', () => {
    const f32 = Math.fround;
    const exact = (a: number, b: number, c: number): number => {
      // Scale to integers: every float32 here is a multiple of 2^-160.
      const S = 160n;
      const big = (v: number): bigint => {
        const buf = new DataView(new ArrayBuffer(8));
        buf.setFloat64(0, v);
        const hi = buf.getUint32(0);
        const lo = buf.getUint32(4);
        const e = (hi >>> 20) & 0x7ff;
        let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
        if (e !== 0) m |= 1n << 52n;
        const shift = BigInt(Math.max(e, 1) - 1075) + S;
        const mag = shift >= 0n ? m << shift : m >> -shift;
        return v < 0 ? -mag : mag;
      };
      const sum = big(a) * big(b) + (big(c) << S);
      // Round the exact value (scaled by 2^(2S)) to the nearest float32, ties to even.
      const neg = sum < 0n;
      let mag = neg ? -sum : sum;
      if (mag === 0n) return 0;
      let bits = mag.toString(2).length;
      const exp = bits - 1 - 2 * Number(S);
      const keep = Math.max(24 - (Math.max(exp, -126) - exp), 1);
      const drop = bits - keep;
      if (drop > 0) {
        const q = mag >> BigInt(drop);
        const rem = mag - (q << BigInt(drop));
        const half = 1n << BigInt(drop - 1);
        mag = rem > half || (rem === half && (q & 1n) === 1n) ? q + 1n : q;
        bits = drop;
      } else bits = 0;
      const v = Number(mag) * 2 ** (bits - 2 * Number(S));
      return neg ? -v : v;
    };
    let s = 99;
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 20000; i++) {
      const a = f32((rnd() - 0.3) * 2 ** Math.floor(rnd() * 16 - 8));
      const b = f32((rnd() - 0.3) * 2 ** Math.floor(rnd() * 16 - 8));
      const c = f32((rnd() - 0.5) * 2 ** Math.floor(rnd() * 16 - 8));
      expect(fma32(a, b, c), `${a} * ${b} + ${c}`).toBe(exact(a, b, c));
    }
    // A double sum on a float32 midpoint, broken by the product's low bits.
    const a = f32(1 + 2 ** -12);
    const b = f32(1 + 2 ** -12);
    const c = f32(-(2 ** -11));
    expect(fma32(a, b, c)).toBe(exact(a, b, c));
  });

  it('stores round half to even (vcvtnq_u32_f32)', () => {
    expect([0.5, 1.5, 2.5, 254.5, 3.49, 3.51].map(roundHalfEven)).toEqual([0, 2, 2, 254, 3, 4]);
  });
});
