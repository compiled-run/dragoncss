// T086 SKIA-AA: the analytic anti-aliasing reference (src/paint-aa.ts) against Chrome 145's CPU raster, captured by
// scripts/capture-skia-aa-oracle.ts into docs/research/skia-aa-oracle. Every pixel of every crop, and so every arc pixel,
// must equal the reference at channel delta 0; each planted fault must make some pixel differ.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { AaFaults, BorderWidths, IRect, RoundedBoxSpec } from '../src/paint-aa.ts';
import { backgroundRoute, borderRoundedRect, borderRoute, devicePixels, fixedMul, NO_AA_FAULTS, paintRoundedBackground, paintRoundedBorder, sqrt32, sqrt64, toSkRRect, whiteDevice } from '../src/paint-aa.ts';

type AaCase = { readonly id: string; readonly family: 'fill' | 'border'; readonly dpr: number; readonly device: RoundedBoxSpec; readonly widths: BorderWidths | null; readonly crop: IRect; readonly file: string };
type Manifest = { readonly chrome: string; readonly skia: string; readonly featureStatus: Record<string, Record<string, string>>; readonly cases: readonly AaCase[] };

const DIR = new URL('../../../docs/research/skia-aa-oracle/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8')) as Manifest;

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
for (const c of manifest.cases) pixels.set(c.file, grayPng(readFileSync(new URL(c.file, DIR))));

function reference(c: AaCase, faults: AaFaults): number[] {
  const dev = whiteDevice(c.crop);
  if (c.widths === null) paintRoundedBackground(dev, c.device, faults);
  else paintRoundedBorder(dev, c.device, c.widths, faults);
  return devicePixels(dev);
}

/** Pixels within one device px of a rounded corner's radius box (the constrained SkRRect's radii). */
function arcPixels(c: AaCase): boolean[] {
  const rr = toSkRRect(borderRoundedRect(c.device, NO_AA_FAULTS), NO_AA_FAULTS);
  const b = c.device.box;
  const corners = [
    { x0: b.left, y0: b.top, sx: 1, sy: 1 },
    { x0: b.right, y0: b.top, sx: -1, sy: 1 },
    { x0: b.right, y0: b.bottom, sx: -1, sy: -1 },
    { x0: b.left, y0: b.bottom, sx: 1, sy: -1 },
  ];
  const out: boolean[] = [];
  for (let y = c.crop.top; y < c.crop.bottom; y++) {
    for (let x = c.crop.left; x < c.crop.right; x++) {
      let arc = false;
      corners.forEach((k, i) => {
        const rad = rr.radii[i] as { x: number; y: number };
        const dx = (x + 0.5 - k.x0) * k.sx;
        const dy = (y + 0.5 - k.y0) * k.sy;
        if (rad.x > 0 && rad.y > 0 && dx > -1 && dy > -1 && dx < rad.x + 1 && dy < rad.y + 1) arc = true;
      });
      out.push(arc);
    }
  }
  return out;
}

type Tally = { pixels: number; equal: number; arc: number; arcEqual: number; partial: number; first: string | null };

function compare(c: AaCase, faults: AaFaults): Tally {
  const px = pixels.get(c.file) as Uint8Array;
  const ref = reference(c, faults);
  const arcs = arcPixels(c);
  const w = c.crop.right - c.crop.left;
  const t: Tally = { pixels: 0, equal: 0, arc: 0, arcEqual: 0, partial: 0, first: null };
  for (let i = 0; i < px.length; i++) {
    const v = px[i] as number;
    const same = v === ref[i];
    t.pixels++;
    if (same) t.equal++;
    if (v !== 0 && v !== 255) t.partial++;
    if (arcs[i] === true) {
      t.arc++;
      if (same) t.arcEqual++;
    }
    if (!same && t.first === null) t.first = `${c.file} (${c.crop.left + (i % w)},${c.crop.top + Math.floor(i / w)}): chrome ${v}, reference ${ref[i]}`;
  }
  return t;
}

function differing(faults: AaFaults): number {
  let n = 0;
  for (const c of manifest.cases) {
    try {
      const t = compare(c, faults);
      n += t.pixels - t.equal;
    } catch {
      n += (pixels.get(c.file) as Uint8Array).length;
    }
  }
  return n;
}

describe('SKIA-AA analytic anti-aliasing: Chrome 145 oracle', () => {
  it('was captured from Chrome 145.0.7632.6 on the CPU raster path at Skia 2ab8add5 at every oracle DPR', () => {
    expect(manifest.chrome).toBe('145.0.7632.6');
    expect(manifest.skia).toBe('2ab8add5be2c46eb6238f4c217f6d6dbc9bccd23');
    for (const fs of Object.values(manifest.featureStatus)) expect(fs).toEqual({ rasterization: 'disabled_software', gpu_compositing: 'disabled_software', skia_graphite: 'disabled_off' });
    for (const family of ['fill', 'border']) expect([...new Set(manifest.cases.filter((c) => c.family === family).map((c) => c.dpr))].sort()).toEqual([2, 2.625, 3]);
  });

  it('every pixel, and so every arc pixel, equals the reference at channel delta 0 in every family at every DPR', () => {
    const byGroup = new Map<string, Tally>();
    for (const c of manifest.cases) {
      const t = compare(c, NO_AA_FAULTS);
      expect(t.first).toBeNull();
      const k = `${c.family} dpr ${c.dpr}`;
      const g = byGroup.get(k) ?? { pixels: 0, equal: 0, arc: 0, arcEqual: 0, partial: 0, first: null };
      g.pixels += t.pixels;
      g.equal += t.equal;
      g.arc += t.arc;
      g.arcEqual += t.arcEqual;
      g.partial += t.partial;
      byGroup.set(k, g);
    }
    expect(byGroup.size).toBe(6);
    for (const g of byGroup.values()) {
      expect(g.equal).toBe(g.pixels);
      expect(g.arcEqual).toBe(g.arc);
      expect(g.arc).toBeGreaterThan(1000);
      expect(g.partial).toBeGreaterThan(500);
    }
  });

  it('exercises the mask and RLE blitters with both edge walks, the rect fill, and SkStroke rings through both blitters', () => {
    const routes = new Set<string>();
    for (const c of manifest.cases) routes.add(c.widths === null ? backgroundRoute(c.device) : borderRoute(c.device, c.widths));
    expect([...routes].sort()).toEqual(['mask-convex', 'mask-edges', 'rect', 'rle-convex', 'safe-rle-edges', 'stroke-mask-edges', 'stroke-safe-rle-edges']);
  });

  it('catches every planted fault', () => {
    const plants: (keyof AaFaults)[] = ['supersampleInsteadOfAAA', 'conicNotQuadded', 'edgeFixedPointRounding', 'rrectRadiiUnclamped', 'coverageNotAccumulated'];
    for (const p of plants) expect(differing({ ...NO_AA_FAULTS, [p]: true }), p).toBeGreaterThan(0);
  });
});

describe('SKIA-AA arithmetic', () => {
  it('sqrt32 is the correctly rounded float32 square root', () => {
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 20000; i++) {
      const x = Math.fround(next() * 10 ** Math.floor(next() * 12 - 6));
      expect(sqrt32(x)).toBe(Math.fround(Math.sqrt(x)));
    }
    // subdivide_w_value of the quarter-circle weight: sqrtf(0.5f + w * 0.5f).
    const w = Math.fround(0.5 + Math.fround(0.7071067690849304 * 0.5));
    expect(sqrt32(w)).toBe(Math.fround(Math.sqrt(w)));
  });

  it('fixedMul equals the 64-bit (a * b) >> 16 truncated to int32', () => {
    const vals = [0, 1, -1, 65535, 65536, -65536, 2147483647, -2147483647, 123456789, -987654321, 40000, -3];
    for (const a of vals) {
      for (const b of vals) {
        const want = Number(BigInt.asIntN(32, (BigInt(a) * BigInt(b)) >> 16n));
        expect(fixedMul(a, b)).toBe(want);
      }
    }
  });

  it('sqrt64 is the correctly rounded double square root', () => {
    let seed = 777;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 20000; i++) {
      const x = (next() + next() / 2147483648) * 10 ** Math.floor(next() * 16 - 8);
      expect(sqrt64(x)).toBe(Math.sqrt(x));
    }
    for (const x of [1, 2, 3, 4, 0.25, 4 - 2 ** -51, 1 + 2 ** -52, 2 ** 60, 2 ** -60, 1e-300 * 1e10]) expect(sqrt64(x)).toBe(Math.sqrt(x));
  });

  it('refuses a stroke of at most 1 device px, which Skia draws as a hairline', () => {
    const spec: RoundedBoxSpec = { box: { left: 10, top: 10, right: 90, bottom: 70 }, radii: { topLeft: { x: 16, y: 16 }, topRight: { x: 16, y: 16 }, bottomRight: { x: 16, y: 16 }, bottomLeft: { x: 16, y: 16 } }, tileSize: 512 };
    const widths: BorderWidths = { top: 1, right: 1, bottom: 1, left: 1 };
    expect(() => paintRoundedBorder(whiteDevice({ left: 0, top: 0, right: 100, bottom: 80 }), spec, widths, NO_AA_FAULTS)).toThrow(/hairline/);
  });
});
