// The text-shadow module's sample points (TXT-FX): the 'text-shadow' kind. The layers are the ones the device shows (dragon
// emit/paint/text-shadow.ts dragonPlaceTextShadow): the translated paint-shadow.ts textShadowLayerOver over each shadowed Ahem line's
// code points, pens and baseline at the DPR. Chrome draws an Ahem glyph's mask with a fringe Core Text grows on its left, right and
// top edges (and on a partial row of its bottom), which the model leaves out, so a shadow pixel equals Chrome's only where the blur
// reads none of those edges: a pixel is clean when, for every shadow of the line, the blur window around it (boxBlurMargin of the
// shadow's sigma on each side) stays SAMPLE_INSET_DEVICE_PX clear of every such edge of every glyph the shadow draws. A clean pixel
// is also painted by the layer, SAMPLE_INSET_DEVICE_PX clear of every glyph box the text draws over its shadow and of every box edge,
// inside no box but the text's container and its ancestors (the backdrop the layer is encoded over), and painted by no other
// line's layer. Each line gets up to POINTS_PER_LINE of its clean pixels, spread evenly in scan order (rule
// text-shadow:<text>:line<j>:<n>); packages/parity/test/text-shadow-native.test.ts measures every clean pixel against Chrome. A
// base point a layer paints (or comes within SAMPLE_INSET_DEVICE_PX of) is suppressed, as is a base edge scanline that does.
import { boxBlurMargin, hasNoBlur, NO_BLUR_FAULTS, NO_SHADOW_FAULTS, shadowSigma, textDecoration as td, textShadowLayerOver } from '@dragon/layout';
import type { ShadowFaults, ShadowInput, ShadowLayer } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import type { TextShadowEntry } from '../../../dragon/src/lower/paint/text-shadow.ts';
import { ahemLineInputs } from '../ahem-lines.ts';
import type { GlyphBox, SampleBox, SamplePoint } from '../samples.ts';
import { ruleKind, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

const I = SAMPLE_INSET_DEVICE_PX;
/** How many clean pixels of each shadowed line become sample points. */
export const POINTS_PER_LINE = 12;

/** The text-shadow writes of a program: per shadowed text, its container box and its shadows as paint-shadow.ts takes them. */
export function textShadowEntries(p: NativeProgram): Map<string, { readonly container: string; readonly shadows: readonly ShadowInput[] }> {
  const out = new Map<string, { readonly container: string; readonly shadows: readonly ShadowInput[] }>();
  for (const n of p.nodes) {
    for (const w of n.writes) {
      if (w.kind !== 'text-shadow') continue;
      for (const e of (w as unknown as { readonly entries: readonly TextShadowEntry[] }).entries) {
        out.set(e.text, { container: n.id, shadows: e.shadows.map((s) => ({ inset: false, x: s.x, y: s.y, blur: s.blur, spread: 0, r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.alpha })) });
      }
    }
  }
  return out;
}

/** One shadowed line: its layer over no backdrop (the geometry and coverage; colours over a backdrop are the test's), its text's glyph boxes, and its clean pixels. */
export type ShadowedLine = {
  readonly id: string;
  readonly text: string;
  readonly container: string;
  readonly cps: readonly number[];
  readonly xs: readonly number[];
  readonly size: number;
  readonly baseline: number;
  readonly shadows: readonly ShadowInput[];
  readonly layer: ShadowLayer;
  readonly glyphs: readonly GlyphBox[];
  readonly clean: readonly (readonly [number, number])[];
};

/** A layer's alpha at page pixel (x, y), 0 outside it. */
export function textShadowAlpha(l: ShadowLayer, x: number, y: number): number {
  if (x < l.left || x >= l.right || y < l.top || y >= l.bottom) return 0;
  return l.rgba[4 * ((y - l.top) * (l.right - l.left) + (x - l.left)) + 3] as number;
}

type Band = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/**
 * The bands a shadow's glyph masks are not modelled in: around each glyph box the shadow draws (placed as textShadowLayerOver places
 * it: x at a quarter pixel after adding 1/8, the baseline at a whole pixel), its left, right and top edges, and its bottom edge
 * when that is not on a whole pixel, each grown by I.
 */
function fringeBands(glyphs: readonly td.GlyphInk[], baseline: number, sh: ShadowInput, dpr: number): Band[] {
  const dx = Math.fround(sh.x * dpr);
  const dy = Math.fround(sh.y * dpr);
  const y = Math.floor(Math.fround(Math.fround(baseline + dy) + 0.5));
  const out: Band[] = [];
  for (const g of glyphs) {
    const l = Math.floor(Math.fround(Math.fround(g.left + dx) + 0.125) * 4) / 4;
    const r = l + (g.right - g.left);
    const t = y - (baseline - g.top);
    const b = y + (g.bottom - baseline);
    out.push({ left: l - I, top: t - I, right: l + I, bottom: b + I });
    out.push({ left: r - I, top: t - I, right: r + I, bottom: b + I });
    out.push({ left: l - I, top: t - I, right: r + I, bottom: t + I });
    if (b !== Math.floor(b)) out.push({ left: l - I, top: b - I, right: r + I, bottom: b + I });
  }
  return out;
}

/** The blur margin of a shadow at a DPR in device px (0 when Skia does not blur). */
function marginOf(sh: ShadowInput, dpr: number, faults: ShadowFaults): number {
  const sigma = faults.sigmaHalfBlur ? shadowSigma(Math.fround(sh.blur), NO_BLUR_FAULTS) : shadowSigma(Math.fround(sh.blur * dpr), NO_BLUR_FAULTS);
  return sigma > 0 && !hasNoBlur(sigma) ? boxBlurMargin(sigma) : 0;
}

const meets = (a: Band, b: Band): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Whether a pixel comes within I of an edge of a box (inside it or outside it). */
function nearBoxEdge(b: SampleBox, x: number, y: number): boolean {
  const inBand = (v: number, lo: number, hi: number): boolean => v + 1 > lo - I && v < hi + I;
  const nearEdge = (v: number, e: number): boolean => v + 1 > e - I && v < e + I;
  return (inBand(y, b.top, b.bottom) && (nearEdge(x, b.left) || nearEdge(x, b.right))) || (inBand(x, b.left, b.right) && (nearEdge(y, b.top) || nearEdge(y, b.bottom)));
}

const insideBox = (b: SampleBox, x: number, y: number): boolean => x + 1 > b.left && x < b.right && y + 1 > b.top && y < b.bottom;

/**
 * Every shadowed Ahem line of a program at a DPR, with its layer and its clean pixels (see the header), in program order. faults
 * plant the layer and the margins (none on the device).
 */
export function shadowedLines(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number, boxes: readonly SampleBox[], faults: ShadowFaults = NO_SHADOW_FAULTS): ShadowedLine[] {
  const entries = textShadowEntries(p);
  if (entries.size === 0) return [];
  const parents = new Map(p.nodes.map((n) => [n.id, n.parent]));
  const lines = ahemLineInputs(p, viewport, dpr);
  const textGlyphs = lines.flatMap((l) => td.ahemLineInk(l.cps, l.xs, l.size, l.baseline));
  const width = Math.round(viewport.width * dpr);
  const height = Math.round(viewport.height * dpr);
  const base = lines.flatMap((l) => {
    const e = entries.get(l.text);
    if (e === undefined) return [];
    return [{ ...l, container: e.container, shadows: e.shadows, layer: textShadowLayerOver(l.cps, l.xs, l.size, l.baseline, e.shadows, dpr, faults, []) }];
  });
  return base.map((l) => {
    const ink = td.ahemLineInk(l.cps, l.xs, l.size, l.baseline);
    const chain = new Set<string>();
    for (let a: string | null = l.container; a !== null; a = parents.get(a) ?? null) chain.add(a);
    const fringes = l.shadows.filter((s) => s.a > 0).map((s) => ({ bands: fringeBands(ink, l.baseline, s, dpr), margin: marginOf(s, dpr, faults) }));
    const clean: [number, number][] = [];
    const L = l.layer;
    for (let y = Math.max(L.top, 0); y < Math.min(L.bottom, height); y++) {
      for (let x = Math.max(L.left, 0); x < Math.min(L.right, width); x++) {
        if (textShadowAlpha(L, x, y) === 0) continue;
        if (base.some((o) => o !== l && textShadowAlpha(o.layer, x, y) > 0)) continue;
        if (!textGlyphs.every((g) => x + 1 <= g.left - I || x >= g.right + I || y + 1 <= g.top - I || y >= g.bottom + I)) continue;
        if (boxes.some((b) => nearBoxEdge(b, x, y) || (insideBox(b, x, y) && !chain.has(b.id)))) continue;
        if (fringes.some((f) => f.bands.some((band) => meets(band, { left: x - f.margin, top: y - f.margin, right: x + 1 + f.margin, bottom: y + 1 + f.margin })))) continue;
        clean.push([x, y]);
      }
    }
    return { id: l.id, text: l.text, container: l.container, cps: l.cps, xs: l.xs, size: l.size, baseline: l.baseline, shadows: l.shadows, layer: L, glyphs: ink, clean };
  });
}

type Shadowed = { readonly lines: readonly ShadowedLine[]; readonly scanlines: ReadonlySet<string> };

const cache = new WeakMap<PaintSampleContext, Shadowed>();

/** Whether any shadow layer of the case paints a pixel within I of (x, y). */
function nearShadow(lines: readonly ShadowedLine[], x: number, y: number): boolean {
  for (const l of lines) {
    const L = l.layer;
    if (x + 1 <= L.left - I || x >= L.right + I || y + 1 <= L.top - I || y >= L.bottom + I) continue;
    for (let v = y - I; v <= y + I; v++) for (let u = x - I; u <= x + I; u++) if (textShadowAlpha(L, u, v) > 0) return true;
  }
  return false;
}

function shadowedOf(ctx: PaintSampleContext): Shadowed {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const lines = shadowedLines(ctx.program, ctx.viewport, ctx.dpr, ctx.boxes);
  // Edge rules are judged per scanline, so a scanline with any point near a layer goes whole.
  const scanlines = new Set<string>();
  if (lines.length > 0) for (const p of ctx.base) if (ruleKind(p.rule) === 'edge' && !scanlines.has(p.rule) && nearShadow(lines, p.x, p.y)) scanlines.add(p.rule);
  const out = { lines, scanlines };
  cache.set(ctx, out);
  return out;
}

export const TEXT_SHADOW_SAMPLES: PaintSamples = {
  name: 'text-shadow',
  keep: (p: SamplePoint, ctx: PaintSampleContext) => {
    const { lines, scanlines } = shadowedOf(ctx);
    if (lines.length === 0) return true;
    return ruleKind(p.rule) === 'edge' ? !scanlines.has(p.rule) : !nearShadow(lines, p.x, p.y);
  },
  points: (ctx: PaintSampleContext) => {
    const out: SamplePoint[] = [];
    for (const l of shadowedOf(ctx).lines) {
      const n = l.clean.length;
      const k = Math.min(POINTS_PER_LINE, n);
      for (let i = 0; i < k; i++) {
        const [x, y] = l.clean[Math.floor(((2 * i + 1) * n) / (2 * k))] as readonly [number, number];
        out.push({ x, y, rule: `text-shadow:${l.id}:${i}` });
      }
    }
    return out;
  },
};
