// T109 SKIA-0: the box-shadow blur reference (src/paint-blur.ts) against Chrome 145's CPU raster, captured by
// scripts/capture-skia-oracle.ts into docs/research/skia-oracle. Every exact oracle pixel must equal the reference at channel
// delta 0; each planted fault must make some pixel differ.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { BlurFaults, BoxShadowSpec, IRect, ShadowPath } from '../src/paint-blur.ts';
import { boxShadowOverWhite, computeBlurProfile, finalScale, gaussFactors, gaussianIntegral, ieeeExp, NO_BLUR_FAULTS, planGauss, scanLine, shadowSigma } from '../src/paint-blur.ts';

type ShadowCase = { readonly id: string; readonly family: 'shadow'; readonly dpr: number; readonly device: BoxShadowSpec; readonly crop: IRect; readonly file: string };
type Manifest = { readonly chrome: string; readonly skia: string; readonly cases: readonly ({ readonly family: string } & Record<string, unknown>)[] };

const DIR = new URL('../../../docs/research/skia-oracle/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8')) as Manifest;
const shadows = manifest.cases.filter((c) => c.family === 'shadow') as unknown as ShadowCase[];

/** Gray pixels of an 8-bit non-interlaced grayscale PNG. */
function grayPng(buf: Buffer): Uint8Array {
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
      if (d[8] !== 8 || d[9] !== 0 || d[12] !== 0) throw new Error('expected an 8-bit gray PNG');
    } else if (t === 'IDAT') idat.push(d);
    p += 12 + n;
  }
  const r = inflateSync(Buffer.concat(idat));
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = r[y * (w + 1)] as number;
    for (let x = 0; x < w; x++) {
      const a = x > 0 ? (o[y * w + x - 1] as number) : 0;
      const b = y > 0 ? (o[(y - 1) * w + x] as number) : 0;
      const c = x > 0 && y > 0 ? (o[(y - 1) * w + x - 1] as number) : 0;
      const pp = a + b - c;
      const pa = Math.abs(pp - a);
      const pb = Math.abs(pp - b);
      const pc = Math.abs(pp - c);
      const q = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      o[y * w + x] = ((r[y * (w + 1) + 1 + x] as number) + q) & 255;
    }
  }
  return o;
}

const pixels = new Map<string, Uint8Array>();
for (const c of shadows) pixels.set(c.file, grayPng(readFileSync(new URL(c.file, DIR))));

type Tally = { exact: number; equal: number; first: string | null; path: ShadowPath };

function compare(c: ShadowCase, faults: BlurFaults): Tally {
  const ref = boxShadowOverWhite(c.device, c.crop, faults);
  const px = pixels.get(c.file) as Uint8Array;
  const w = c.crop.right - c.crop.left;
  const t: Tally = { exact: 0, equal: 0, first: null, path: ref.path };
  for (let i = 0; i < px.length; i++) {
    if (!(ref.exact[i] as boolean)) continue;
    t.exact++;
    if (px[i] === ref.values[i]) t.equal++;
    else if (t.first === null) t.first = `${c.file} (${c.crop.left + (i % w)},${c.crop.top + Math.floor(i / w)}): chrome ${px[i]}, reference ${ref.values[i]}`;
  }
  return t;
}

describe('SKIA-0 box-shadow blur: Chrome 145 oracle', () => {
  it('was captured from Chrome 145.0.7632.6 at Skia 2ab8add5 with every oracle DPR', () => {
    expect(manifest.chrome).toBe('145.0.7632.6');
    expect(manifest.skia).toBe('2ab8add5be2c46eb6238f4c217f6d6dbc9bccd23');
    expect([...new Set(shadows.map((c) => c.dpr))].sort()).toEqual([2, 2.625, 3]);
  });

  it('every exact oracle pixel equals the reference at channel delta 0, on every path at every DPR', () => {
    const byPath = new Map<string, number>();
    for (const c of shadows) {
      const t = compare(c, NO_BLUR_FAULTS);
      expect(t.first, t.first ?? '').toBeNull();
      expect(t.equal).toBe(t.exact);
      byPath.set(`${c.dpr} ${t.path}`, (byPath.get(`${c.dpr} ${t.path}`) ?? 0) + t.exact);
    }
    for (const dpr of [2, 3, 2.625]) {
      for (const path of ['nine-patch-rect', 'nine-patch-rrect', 'triple-box', 'small-blur']) expect(byPath.get(`${dpr} ${path}`) ?? 0, `${path} at DPR ${dpr}`).toBeGreaterThan(1000);
    }
  }, 300_000);

  it('plain-rect cases compare every captured pixel; rounded cases leave out only arc-dependent pixels', () => {
    for (const c of shadows) {
      const ref = boxShadowOverWhite(c.device, c.crop, NO_BLUR_FAULTS);
      const n = ref.exact.filter(Boolean).length;
      const fractional = [c.device.box.left - c.device.spread + c.device.offsetX, c.device.box.top - c.device.spread + c.device.offsetY].some((v) => v !== Math.floor(v));
      if (c.device.radius === 0 && !(fractional && (ref.path === 'triple-box' || ref.path === 'small-blur'))) expect(n, c.file).toBe(ref.values.length);
      else expect(n, c.file).toBeGreaterThan(ref.values.length / 4);
    }
  }, 300_000);

  const plants: readonly (keyof BlurFaults)[] = ['blurSigmaFormula', 'ninePatchAlways', 'tripleBoxRoundingOff'];
  for (const plant of plants) {
    it(`planted ${plant} is caught by the oracle`, () => {
      const faults: BlurFaults = { ...NO_BLUR_FAULTS, [plant]: true };
      let differing = 0;
      for (const c of shadows) {
        const t = compare(c, faults);
        differing += t.exact - t.equal;
      }
      expect(differing).toBeGreaterThan(0);
    }, 300_000);
  }
});

describe('SKIA-0 blur arithmetic', () => {
  it('uses sqrt(2 pi) exactly, and an exp within one ulp of the platform exp', () => {
    expect(2.5066282746310002).toBe(Math.sqrt(2 * Math.PI));
    let s = 0x2545f491;
    for (let i = 0; i < 20000; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const x = (s / 4294967296) * 8;
      expect(Math.abs(ieeeExp(x) - Math.exp(x)) / Math.exp(x), `exp(${x})`).toBeLessThanOrEqual(2 ** -52);
    }
  });

  it('small_blur factors cannot move under a two-ulp change of exp (Skia calls the platform exp)', () => {
    // SkGaussFilter with an injected exp, as in src/core/SkGaussFilter.cpp.
    const factors = (sigma: number, exp: (x: number) => number): number[] => {
      const v = sigma * sigma;
      const i0 = (t: number): number => {
        const q = (t * t) / 4;
        let sum = 1;
        let f = 1;
        for (let k = 1; f > 1 / 1000000; k++) {
          f *= q / (k * k);
          sum += f;
        }
        return sum;
      };
      const i1 = (t: number): number => {
        const q = (t * t) / 4;
        let sum = t / 2;
        let f = sum;
        for (let k = 1; f > 1 / 1000000; k++) {
          f *= q / (k * (k + 1));
          sum += f;
        }
        return sum;
      };
      const d = exp(v);
      const b = [i0(v), i1(v)];
      const g = [(b[0] as number) / d, (b[1] as number) / d];
      let n = 1;
      while ((g[n] as number) > 1 / 100) {
        b.push(-((2 * n) / v) * (b[n] as number) + (b[n - 1] as number));
        g.push((b[n + 1] as number) / d);
        n++;
      }
      let sum = 0;
      for (let i = n - 1; i >= 1; i--) sum += 2 * (g[i] as number);
      sum += g[0] as number;
      const q = g.slice(0, n).map((x) => x / sum);
      let rest = 0;
      for (let i = n - 1; i >= 1; i--) rest += 2 * (q[i] as number);
      q[0] = 1 - rest;
      return q.map((x) => Math.round(x * 65536) % 65536);
    };
    for (let k = 0; k <= 20000; k++) {
      const sigma = Math.fround(1 / 3 + ((2 - 1 / 3) * k) / 20001);
      const want = gaussFactors(sigma);
      for (const e of [-2, -1, 0, 1, 2]) expect(factors(sigma, (x) => Math.exp(x) * (1 + e * 2 ** -52)), `sigma ${sigma}`).toEqual(want);
    }
  }, 60_000);

  it('finalScale is the 64-bit (weight * sum + 2^31) >> 32', () => {
    let s = 0x1234567;
    for (let i = 0; i < 20000; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const weight = s;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const sum = s;
      const want = Number((BigInt(weight) * BigInt(sum) + (1n << 31n)) >> 32n);
      expect(finalScale(weight, sum, NO_BLUR_FAULTS)).toBe(want);
    }
  });

  it('Scan equals the direct convolution of its three boxes', () => {
    for (const sigma of [2, 2.5, 5.25, 16, 60]) {
      const plan = planGauss(sigma);
      const src = [0, 255, 255, 128, 0, 0, 7, 255, 255, 255, 255, 3, 90, 0, 0, 0, 0, 0, 40, 255, 255, 255];
      const window = plan.pass0Size + 1;
      const box = (w: number): number[] => Array.from({ length: w }, () => 1);
      const conv = (a: number[], b: number[]): number[] => {
        const out = Array.from({ length: a.length + b.length - 1 }, () => 0);
        a.forEach((x, i) => b.forEach((y, j) => (out[i + j] = (out[i + j] as number) + x * y)));
        return out;
      };
      const kernel = conv(conv(box(window), box(window)), box(plan.pass2Size + 1));
      const want = conv(src, kernel).map((v) => Number((BigInt(plan.weight) * BigInt(v) + (1n << 31n)) >> 32n));
      const got = scanLine(plan, src, NO_BLUR_FAULTS);
      expect(got.length).toBe(src.length + 2 * plan.border);
      // The full convolution has kernel.length - 1 = 2 * border extra samples.
      expect(got).toEqual(want);
    }
  });

  it('keeps the profile, integral and small_blur factors in their Skia shapes', () => {
    expect(gaussianIntegral(-2)).toBe(1);
    expect(gaussianIntegral(2)).toBe(0);
    expect(gaussianIntegral(0)).toBe(0.5);
    const profile = computeBlurProfile(Math.ceil(Math.fround(6 * 4)), 4);
    expect(profile.length).toBe(24);
    expect(profile[0]).toBe(255);
    for (let i = 1; i < profile.length; i++) expect(profile[i] as number).toBeLessThanOrEqual(profile[i - 1] as number);
    for (const sigma of [0.5, 1, 1.3125, 1.5, 1.875]) {
      const f = gaussFactors(sigma);
      expect(f.length).toBeGreaterThanOrEqual(2);
      expect(f.length).toBeLessThanOrEqual(5);
      const sum = (f[0] as number) + 2 * f.slice(1).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 65536)).toBeLessThanOrEqual(f.length);
    }
    expect(shadowSigma(21, NO_BLUR_FAULTS)).toBe(10.5);
    expect(shadowSigma(400, NO_BLUR_FAULTS)).toBe(128);
  });
});
