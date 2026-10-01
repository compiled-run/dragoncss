// REPL-a: replaced-element sizing and the object-fit destination rect against Chrome 145.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LayoutStyle } from '../src/index.ts';
import { fromCssPx, NO_ENGINE_FAULTS } from '../src/index.ts';
import type { NaturalSizing, ObjectFit, ObjectPosition, ReplacedSize } from '../src/replaced.ts';
import { blockFlowSpace, drawnObjectRect, objectFitRect, pixelSnappedRect, replacedSize } from '../src/replaced.ts';
import type { LU } from '../src/units.ts';
import { divStyle, pct, px } from './helpers.ts';

const lu = (cssPx: number): LU => fromCssPx(cssPx);
const image = (w: number, h: number, zoom = 1): NaturalSizing => ({ width: lu(w * zoom), height: lu(h * zoom), ratio: { width: lu(w * zoom), height: lu(h * zoom) } });
const NO_NATURAL: NaturalSizing = { width: null, height: null, ratio: null };
const DEFAULT_OBJECT: ReplacedSize = { inline: lu(300), block: lu(150) };
const ratio = (w: number, h: number, kind: 'ratio' | 'auto-ratio' = 'ratio'): LayoutStyle['aspectRatio'] => ({ kind, width: w * 64, height: h * 64 });
const edges = (v: number): Partial<LayoutStyle> => ({ paddingTop: px(v), paddingRight: px(v), paddingBottom: px(v), paddingLeft: px(v) });
const border = (v: number): Partial<LayoutStyle> => ({ borderTopWidth: px(v), borderRightWidth: px(v), borderBottomWidth: px(v), borderLeftWidth: px(v) });

// The probe's styles, in its order: each img or iframe is display:block in a 200px-wide container whose height is auto or 120px.
const STYLES: readonly [string, Partial<LayoutStyle>][] = [
  ['', {}],
  ['width:100px', { width: px(100) }],
  ['height:40px', { height: px(40) }],
  ['width:100px;height:30px', { width: px(100), height: px(30) }],
  ['width:50%', { width: pct(50) }],
  ['height:50%', { height: pct(50) }],
  ['max-width:100px', { maxWidth: px(100) }],
  ['min-width:300px', { minWidth: px(300) }],
  ['max-height:50px', { maxHeight: px(50) }],
  ['min-height:120px', { minHeight: px(120) }],
  ['aspect-ratio:1/1', { aspectRatio: ratio(1, 1) }],
  ['aspect-ratio:auto 1/1', { aspectRatio: ratio(1, 1, 'auto-ratio') }],
  ['aspect-ratio:2/1;width:100px', { aspectRatio: ratio(2, 1), width: px(100) }],
  ['aspect-ratio:1/2', { aspectRatio: ratio(1, 2) }],
  ['padding:5px;border:3px solid;box-sizing:border-box;width:100px', { ...edges(5), ...border(3), boxSizing: 'border-box', width: px(100) }],
  ['padding:5px;border:3px solid', { ...edges(5), ...border(3) }],
  ['max-width:100px;max-height:20px', { maxWidth: px(100), maxHeight: px(20) }],
  ['width:300px', { width: px(300) }],
  ['max-width:50%', { maxWidth: pct(50) }],
  ['width:100px;margin:0 auto', { width: px(100), marginLeft: { kind: 'auto' }, marginRight: { kind: 'auto' } }],
  ['margin-left:auto', { marginLeft: { kind: 'auto' } }],
  ['min-height:120px;max-width:100px', { minHeight: px(120), maxWidth: px(100) }],
  ['height:200px;max-width:100px', { height: px(200), maxWidth: px(100) }],
  ['min-width:250px;max-height:60px', { minWidth: px(250), maxHeight: px(60) }],
  ['width:auto;height:auto;min-width:10px;min-height:10px', { minWidth: px(10), minHeight: px(10) }],
  ['aspect-ratio:3/1;height:20px', { aspectRatio: ratio(3, 1), height: px(20) }],
  ['box-sizing:border-box;padding:10px;height:40px', { boxSizing: 'border-box', ...edges(10), height: px(40) }],
  ['max-height:50%', { maxHeight: pct(50) }],
  ['min-height:50%', { minHeight: pct(50) }],
  ['width:calc(50% + 10px)', { width: { kind: 'calc', expr: { kind: 'pixels-and-percent', pixels: 10, percent: 50, explicitPixels: true, explicitPercent: true }, range: 'non-negative' } }],
  ['aspect-ratio:auto 1/1;height:30px', { aspectRatio: ratio(1, 1, 'auto-ratio'), height: px(30) }],
  ['aspect-ratio:2/1;padding:4px', { aspectRatio: ratio(2, 1), ...edges(4) }],
  ['aspect-ratio:2/1;padding:4px;box-sizing:border-box', { aspectRatio: ratio(2, 1), ...edges(4), boxSizing: 'border-box' }],
];

// Chrome 145 getBoundingClientRect width and height of each STYLES entry (probe at DPR 1; images are 160x80, 40x80 and 64x64
// PNG data: URLs; the iframe has border:0 before the case's own style).
const CHROME: { readonly [key: string]: readonly (readonly [number, number])[] } = {
  'auto wide': [[160,80],[100,50],[80,40],[100,30],[100,50],[160,80],[100,50],[300,150],[100,50],[240,120],[160,160],[160,80],[100,50],[160,320],[100,58],[176,96],[40,20],[300,150],[100,50],[100,50],[160,80],[100,120],[100,200],[250,60],[160,80],[60,20],[60,40],[160,80],[160,80],[110,55],[60,30],[168,88],[168,84]],
  'auto tall': [[40,80],[100,200],[20,40],[100,30],[100,200],[40,80],[40,80],[300,600],[25,50],[60,120],[40,40],[40,80],[100,50],[40,80],[100,184],[56,96],[10,20],[300,600],[40,80],[100,200],[40,80],[60,120],[100,200],[250,60],[40,80],[60,20],[30,40],[40,80],[40,80],[110,220],[15,30],[48,28],[48,24]],
  'auto square': [[64,64],[100,100],[40,40],[100,30],[100,100],[64,64],[64,64],[300,300],[50,50],[120,120],[64,64],[64,64],[100,50],[64,128],[100,100],[80,80],[20,20],[300,300],[64,64],[100,100],[64,64],[100,120],[100,200],[250,60],[64,64],[60,20],[40,40],[64,64],[64,64],[110,110],[30,30],[72,40],[72,36]],
  'auto iframe': [[300,150],[100,150],[300,40],[100,30],[100,150],[300,150],[100,150],[300,150],[300,50],[300,150],[200,200],[200,200],[100,50],[200,400],[100,166],[316,166],[100,20],[300,150],[100,150],[100,150],[300,150],[100,150],[100,200],[300,60],[300,150],[60,20],[320,40],[300,150],[300,150],[110,150],[30,30],[200,104],[200,100]],
  '120px wide': [[160,80],[100,50],[80,40],[100,30],[100,50],[120,60],[100,50],[300,150],[100,50],[240,120],[160,160],[160,80],[100,50],[160,320],[100,58],[176,96],[40,20],[300,150],[100,50],[100,50],[160,80],[100,120],[100,200],[250,60],[160,80],[60,20],[60,40],[120,60],[160,80],[110,55],[60,30],[168,88],[168,84]],
  '120px tall': [[40,80],[100,200],[20,40],[100,30],[100,200],[30,60],[40,80],[300,600],[25,50],[60,120],[40,40],[40,80],[100,50],[40,80],[100,184],[56,96],[10,20],[300,600],[40,80],[100,200],[40,80],[60,120],[100,200],[250,60],[40,80],[60,20],[30,40],[30,60],[40,80],[110,220],[15,30],[48,28],[48,24]],
  '120px square': [[64,64],[100,100],[40,40],[100,30],[100,100],[60,60],[64,64],[300,300],[50,50],[120,120],[64,64],[64,64],[100,50],[64,128],[100,100],[80,80],[20,20],[300,300],[64,64],[100,100],[64,64],[100,120],[100,200],[250,60],[64,64],[60,20],[40,40],[60,60],[64,64],[110,110],[30,30],[72,40],[72,36]],
  '120px iframe': [[300,150],[100,150],[300,40],[100,30],[100,150],[300,60],[100,150],[300,150],[300,50],[300,150],[200,200],[200,200],[100,50],[200,400],[100,166],[316,166],[100,20],[300,150],[100,150],[100,150],[300,150],[100,150],[100,200],[300,60],[300,150],[60,20],[320,40],[300,60],[300,150],[110,150],[30,30],[200,104],[200,100]],
};

const NATURAL: { readonly [kind: string]: NaturalSizing } = { wide: image(160, 80), tall: image(40, 80), square: image(64, 64), iframe: NO_NATURAL };

/** The probed cases whose size differs from Chrome, for a space built from the container's width and height. */
function sizeMisses(spaceFor: (cbBlock: LU | null) => ReturnType<typeof blockFlowSpace>): { readonly off: string[]; readonly compared: number } {
  const off: string[] = [];
  let compared = 0;
  for (const [key, sizes] of Object.entries(CHROME)) {
    const [height, kind] = key.split(' ') as [string, string];
    STYLES.forEach(([css, over], i) => {
      const s: LayoutStyle = { ...divStyle, ...over };
      const pad = (v: LayoutStyle['paddingTop']): number => (v.kind === 'px' ? v.value : 0);
      const bor = (v: LayoutStyle['borderTopWidth']): number => (v.kind === 'px' ? v.value : 0);
      const bp = { inline: lu(pad(s.paddingLeft) + pad(s.paddingRight) + bor(s.borderLeftWidth) + bor(s.borderRightWidth)), block: lu(pad(s.paddingTop) + pad(s.paddingBottom) + bor(s.borderTopWidth) + bor(s.borderBottomWidth)) };
      const space = spaceFor(height === 'auto' ? null : lu(120));
      const r = replacedSize(s, NATURAL[kind] as NaturalSizing, DEFAULT_OBJECT, bp, space, 'normal', NO_ENGINE_FAULTS);
      const want = sizes[i] as readonly [number, number];
      compared++;
      if (r.inline !== lu(want[0]) || r.block !== lu(want[1])) off.push(`${key} ${css || '(none)'}: ${r.inline / 64}x${r.block / 64}, Chrome ${want[0]}x${want[1]}`);
    });
  }
  return { off, compared };
}

describe('replaced sizing (Blink ComputeReplacedSize) against Chrome 145 block-level boxes', () => {
  it('equals Chrome on every probed style, natural size and container height', () => {
    const r = sizeMisses((cbBlock) => blockFlowSpace(lu(200), cbBlock, lu(0)));
    expect(r.off).toEqual([]);
    expect(r.compared).toBe(8 * STYLES.length);
  });

  it('the comparison catches a planted error: an auto width that stretches like a non-replaced block', () => {
    const r = sizeMisses((cbBlock) => ({ ...blockFlowSpace(lu(200), cbBlock, lu(0)), inlineAuto: 'stretch-implicit' }));
    expect(r.off.length).toBeGreaterThan(0);
  });
});

type Offset = ['left' | 'right' | 'top' | 'bottom', number, number];
type ProbeCase = { dpr: number; ratio: string; natural: [number, number]; fit: ObjectFit; position: { css: string; x: Offset; y: Offset }; rect: [number, number, number, number]; anchors: [string, string] };
type Probe = { box: { left: number; top: number; width: number; height: number }; cases: ProbeCase[] };
const probe = JSON.parse(readFileSync(new URL('../../dragon/test/images/chrome-145/probe.json', import.meta.url), 'utf8')) as Probe;

/** One object-position axis in zoomed px: an edge offset of fraction x free space plus px; right and bottom count from the far edge. */
function axis([edge, fraction, offset]: Offset, zoom: number): ObjectPosition['x'] {
  const far = edge === 'right' || edge === 'bottom';
  const percent = far ? 100 - fraction * 100 : fraction * 100;
  const pixels = (far ? -offset : offset) * zoom;
  if (pixels === 0) return pct(percent);
  if (percent === 0) return px(pixels);
  return { kind: 'calc', expr: { kind: 'pixels-and-percent', pixels, percent, explicitPixels: true, explicitPercent: true }, range: 'all' };
}

type Variant = { readonly fit: (f: ObjectFit) => ObjectFit; readonly position: (p: ObjectPosition) => ObjectPosition; readonly naturalZoom: (z: number) => number };
const ENGINE: Variant = { fit: (f) => f, position: (p) => p, naturalZoom: (z) => z };

/** The probe cases whose snapped rect (relative to the box) is more than 1 device px from Chrome's on any value, and the worst value. */
function probeMisses(v: Variant): { readonly misses: string[]; readonly worst: number } {
  const { left, top, width, height } = probe.box;
  const misses: string[] = [];
  let worst = 0;
  for (const c of probe.cases) {
    const z = c.dpr;
    const content = { x: lu(left * z), y: lu(top * z), width: lu(width * z), height: lu(height * z) };
    const position = v.position({ x: axis(c.position.x, z), y: axis(c.position.y, z) });
    const p = pixelSnappedRect(objectFitRect(content, image(c.natural[0], c.natural[1], v.naturalZoom(z)), v.fit(c.fit), position, NO_ENGINE_FAULTS));
    const got = [p.x - left * z, p.y - top * z, p.width, p.height];
    const d = Math.max(...got.map((g, i) => Math.abs(g - (c.rect[i] as number))));
    worst = Math.max(worst, d);
    if (d > 1) misses.push(`${z} ${c.ratio} ${c.fit} ${c.position.css}: ${got.join(',')} vs ${c.rect.join(',')}`);
  }
  return { misses, worst };
}

describe('the object-fit destination rect against the REPL-0 Chrome probe (R7)', () => {
  it('the snapped engine rect is within 1 device px (GATE_DEVICE_PX) of the probe at DPR 2, 3 and 2.625 on every case', () => {
    expect(probe.cases.length).toBe(405);
    expect([...new Set(probe.cases.map((c) => c.dpr))]).toEqual([2, 3, 2.625]);
    const r = probeMisses(ENGINE);
    expect(r.misses).toEqual([]);
    // Measured: 0 at DPR 2 and 3 on every edge-anchored start and size; at most 0.514 device px at 2.625 (the probe's read).
    expect(r.worst).toBeLessThanOrEqual(1);
  });

  it('the gate catches planted errors: contain and cover swapped, object-position ignored, the natural size left unzoomed', () => {
    const swap = probeMisses({ ...ENGINE, fit: (f) => (f === 'contain' ? 'cover' : f === 'cover' ? 'contain' : f) });
    const ignored = probeMisses({ ...ENGINE, position: () => ({ x: px(0), y: px(0) }) });
    const unzoomed = probeMisses({ ...ENGINE, naturalZoom: () => 1 });
    expect(swap.misses.length).toBeGreaterThan(0);
    expect(ignored.misses.length).toBeGreaterThan(0);
    expect(unzoomed.misses.length).toBeGreaterThan(0);
  });

  it('an iframe (no natural size or ratio) draws into its content box', () => {
    const content = { x: lu(3), y: lu(4), width: lu(30), height: lu(20) };
    expect(objectFitRect(content, NO_NATURAL, 'contain', { x: pct(50), y: pct(50) }, NO_ENGINE_FAULTS)).toEqual(content);
  });

  it('the drawn part of an overflowing rect is the snapped content box (Blink ImagePainter)', () => {
    const content = { x: lu(10), y: lu(10), width: lu(100), height: lu(50) };
    const dest = objectFitRect(content, image(160, 40), 'cover', { x: pct(50), y: pct(50) }, NO_ENGINE_FAULTS);
    expect(pixelSnappedRect(dest)).toEqual({ x: -40, y: 10, width: 200, height: 50 });
    expect(drawnObjectRect(dest, content)).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    const inside = objectFitRect(content, image(160, 80), 'contain', { x: pct(50), y: pct(50) }, NO_ENGINE_FAULTS);
    expect(drawnObjectRect(inside, content)).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    expect(drawnObjectRect(objectFitRect(content, image(10, 10), 'none', { x: px(200), y: px(0) }, NO_ENGINE_FAULTS), content)).toBeNull();
  });
});
