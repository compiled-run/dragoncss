// PNT1 box-shadow on the host (T046 §2, the two-stage paint proof): the TS paint-shadow.ts layers the device shows (the *Over
// layers: each shadow blitted onto the backdrop its ancestors paint as Chrome blits it, encoded over that backdrop) of every shadow
// fixture and of the calibration set, composited over the host paint model's backdrop the way the platforms composite a
// premultiplied layer (round to nearest, which matches every device shadow point of the 14f3afd3 lanes run), against the
// committed Chrome PNGs at every device DPR, at every shadow pixel clear of an antialiased edge (2 device px outside the border
// box or inside the padding box, each shadow's own coverage smooth over the 5 x 5 neighbourhood, and the backdrop model one colour
// over the pixel grown by 2 device px) that no later box covers. The largest per-channel difference must be 0: the shadow
// allowance (allowances/shadow.ts) is GATE_CHANNEL_DELTA (decisions.md, box-shadow device pixels: no allowance). The plain layers
// (composited onto transparent, one platform composite) measured 2 here, one floor per shadow short of Chrome's. A box with its own
// scale and translate (shadow-transform) is modelled where it paints, and its outer layers are drawn under that transform; two
// planted faults, the shadow drawn untransformed and its blur left unscaled by the transform, must each move a clear pixel. A
// transformed box paints after the flow content of its stacking context (shadow-transform-order); the shadow left at its tree place,
// and drawn over its ancestors' fills alone, must each move a clear pixel.
import { describe, expect, it } from 'vitest';
import { IDENTITY_SHADOW_TRANSFORM, insetShadowLayer, insetShadowLayerOver, NO_SHADOW_FAULTS, outerShadowLayerMapped, outerShadowLayerOverMapped } from '@dragon/layout';
import type { BackdropFill, ShadowInput, ShadowLayer, ShadowTransform } from '@dragon/layout';
import { nativePrograms } from 'dragon';
import { SHADOW_CHANNEL_DELTA } from '../src/allowances/shadow.ts';
import { GATE_CHANNEL_DELTA } from '../src/compare.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels } from '../src/pixel-reference.ts';
import { ownShadowTransform, shadowInputs } from '../src/paint-samples/shadow.ts';
import { SAMPLE_INSET_DEVICE_PX } from '../src/samples.ts';
import type { Box, Rgba } from './paint-model.ts';
import { boxes, modelAt } from './paint-model.ts';

const I = SAMPLE_INSET_DEVICE_PX;
/** The measured maximum per-channel difference over the shadow fixtures and the calibration set at DPR 2, 3 and 2.625. */
const SHADOW_MEASURED_MAX = 0;
/** The same measure of the plain layers, composited onto transparent and then once over the backdrop (the 32ab282a device). */
const PLAIN_MEASURED_MAX = 2;
const SHADOW_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'shadow')?.fixtures ?? []).filter((f) => f.kind === 'layout');

function alphaAt(l: ShadowLayer, x: number, y: number): number {
  if (x < l.left || x >= l.right || y < l.top || y >= l.bottom) return 0;
  return l.rgba[4 * ((y - l.top) * (l.right - l.left) + (x - l.left)) + 3] as number;
}

/** Whether every coverage layer spans at most 64 levels over the 5 x 5 neighbourhood of (x, y): no antialiased shadow edge is near. */
function smooth(coverage: readonly ShadowLayer[], x: number, y: number): boolean {
  for (const l of coverage) {
    let lo = 255;
    let hi = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const a = alphaAt(l, x + dx, y + dy);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    if (hi - lo > 64) return false;
  }
  return true;
}

/** Whether the backdrop model is one colour over pixel (x, y) grown by I, sampled every half device px (no antialiased box edge near). */
function flatBackdrop(list: readonly Box[], x: number, y: number, stop: { index: number; background: boolean }, centre: Rgba): boolean {
  for (let v = -I - 0.5; v <= I + 0.5; v += 0.5) for (let u = -I - 0.5; u <= I + 0.5; u += 0.5) {
    if (modelAt(list, x + u, y + v, stop).some((c, k) => c !== centre[k])) return false;
  }
  return true;
}

/** A platform's source-over of a premultiplied layer pixel over an opaque backdrop, rounded to nearest. */
function platformOver(l: ShadowLayer, x: number, y: number, under: Rgba): number[] {
  const i = 4 * ((y - l.top) * (l.right - l.left) + (x - l.left));
  const a = l.rgba[i + 3] as number;
  return [0, 1, 2].map((k) => Math.round((l.rgba[i + k] as number) + ((under[k] as number) * (255 - a)) / 255));
}

/** The backdrop fills the device gathers for a box's shadows: each ancestor's background, outermost first, then its own for inset. */
/** The host a layer item's paint-order write places it under, or null for a flow box. */
function layerHost(b: Box): string | null {
  const w = b.node.writes.find((x) => x.kind === 'paint-order');
  return w !== undefined && w.kind === 'paint-order' && w.bucket !== 0 ? w.host : null;
}

/**
 * The backdrop of a box's shadows, list in paint order: its ancestors' fills, outermost first, then its own for the inset ones; a
 * layer item's outer shadows also have every box its host painted before it beneath, but what a clipping box below the host holds.
 */
function backdropOf(list: readonly Box[], b: Box, own: boolean, ancestorsOnly = false): BackdropFill[] {
  const chain: Box[] = own ? [b] : [];
  for (let p = b.node.parent; p !== null; ) {
    const a = list.find((x) => x.node.id === p);
    if (a === undefined) break;
    chain.unshift(a);
    p = a.node.parent;
  }
  const host = own || ancestorsOnly ? null : layerHost(b);
  if (host !== null) {
    const at = list.indexOf(b);
    const byId = new Map(list.map((x) => [x.node.id, x]));
    for (const x of list.slice(0, at)) {
      if (chain.includes(x)) continue;
      let ok = false;
      for (let h = x.node.host; h !== null; ) {
        if (h === host) {
          ok = true;
          break;
        }
        const up = byId.get(h);
        if (up === undefined || up.node.clips) break;
        h = up.node.host;
      }
      if (ok) chain.push(x);
    }
  }
  return chain.flatMap((a) => {
    const bg = a.node.writes.find((w) => w.kind === 'background-color');
    if (bg === undefined || bg.kind !== 'background-color') return [];
    return [{ left: a.l, top: a.t, right: a.r, bottom: a.b, radii: a.radii === null ? [0, 0, 0, 0, 0, 0, 0, 0] : a.radii.slice(0, 8), r: bg.color.r, g: bg.color.g, b: bg.color.b, a: bg.color.alpha }];
  });
}

const inside = (b: Box, x: number, y: number): boolean => x + 1 > b.l && x < b.r && y + 1 > b.t && y < b.b;

type Measure = { max: number; pixels: number; worst: string };

/** A box's own scale and translate, and the box where it paints under it (edges, borders and both radius sets mapped). */
function placed(p: import('dragon').NativeProgram, b: Box, dpr: number): { map: ShadowTransform; at: Box } {
  const map = ownShadowTransform(p, b.node.id, b.l, b.t, b.r, b.b, dpr);
  if (map === IDENTITY_SHADOW_TRANSFORM) return { map, at: b };
  const radii = b.radii === null ? null : b.radii.map((v, i) => v * (i % 8 < 4 ? map.sx : map.sy));
  const border = b.border.map((v, i) => v * (i % 2 === 0 ? map.sy : map.sx));
  return { map, at: { ...b, l: map.sx * b.l + map.tx, t: map.sy * b.t + map.ty, r: map.sx * b.r + map.tx, b: map.sy * b.b + map.ty, border, radii } };
}

/** A planted fault of the transformed shadows: drawn untransformed, or under the transform with the blur left at its local sigma. */
type Plant = 'none' | 'untransformed' | 'blur-unscaled' | 'tree-order' | 'backdrop-ancestors';

/** The measured difference of one case at one DPR over every clear shadow pixel. */
function measure(caseId: string, given: readonly Box[], p: import('dragon').NativeProgram, dpr: number, plant: Plant = 'none'): { over: Measure; plain: Measure } {
  const chrome = committedPixels(caseId, dpr);
  if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
  const m: Measure = { max: 0, pixels: 0, worst: '' };
  const mp: Measure = { max: 0, pixels: 0, worst: '' };
  // Chrome's paint order: a layer item (a transformed box) paints after the flow content of its stacking context.
  const order = (b: Box): number => (b.node.facts['stacking'] as { readonly paintOrder?: number } | undefined)?.paintOrder ?? -1;
  if (given.some((b) => order(b) < 0)) throw new Error(`${caseId}: a box has no paint order`);
  const boxList = [...given].sort((a, b) => order(a) - order(b));
  const list = boxList.map((b) => placed(p, b, dpr).at);
  const layers = boxList.map((b) => {
    const own = shadowInputs(p, b.node.id);
    if (own === null) return null;
    const placedMap = placed(p, b, dpr).map;
    const map = plant === 'untransformed' ? IDENTITY_SHADOW_TRANSFORM : placedMap;
    const shadows = plant === 'blur-unscaled' ? own.map((s) => ({ ...s, blur: s.blur / Math.sqrt(placedMap.sx * placedMap.sy) })) : own;
    const bg = b.node.writes.find((w) => w.kind === 'background-color');
    const opaque = bg !== undefined && bg.kind === 'background-color' && bg.color.alpha === 255;
    const zero = [0, 0, 0, 0, 0, 0, 0, 0];
    const layerOf = (list: readonly ShadowInput[]): [ShadowLayer, ShadowLayer] => [
      outerShadowLayerMapped(b.l, b.t, b.r, b.b, b.radii === null ? zero : b.radii.slice(0, 8), opaque, list, dpr, NO_SHADOW_FAULTS, map),
      insetShadowLayer(b.l, b.t, b.r, b.b, b.border, b.radii === null ? zero : b.radii.slice(8, 16), list, dpr, NO_SHADOW_FAULTS),
    ];
    const outer = outerShadowLayerOverMapped(b.l, b.t, b.r, b.b, b.radii === null ? zero : b.radii.slice(0, 8), opaque, shadows, dpr, NO_SHADOW_FAULTS, backdropOf(list, b, false, plant === 'backdrop-ancestors'), map);
    const inset = insetShadowLayerOver(b.l, b.t, b.r, b.b, b.border, b.radii === null ? zero : b.radii.slice(8, 16), shadows, dpr, NO_SHADOW_FAULTS, backdropOf(list, b, true));
    const [plainOuter, plainInset] = layerOf(shadows);
    return { outer, inset, plainOuter, plainInset, coverage: shadows.flatMap((s) => layerOf([{ ...s, r: 0, g: 0, b: 0, a: 255 }])) };
  });
  const painted = (x: number, y: number): number => layers.filter((l) => l !== null && (alphaAt(l.plainOuter, x, y) > 0 || alphaAt(l.plainInset, x, y) > 0)).length;
  const treeList = given.map((b) => placed(p, b, dpr).at);
  const treeIndex = new Map(given.map((b, k) => [b.node.id, k]));
  const paintIndex = new Map(boxList.map((b, k) => [b.node.id, k]));
  let owner = '';
  /** The tree-order plant: a box after the shadow's own in tree order but before it in paint order covers the shadow there. */
  const coveredInTreeOrder = (x: number, y: number): boolean => treeList.some((d) => (treeIndex.get(d.node.id) as number) > (treeIndex.get(owner) as number) && (paintIndex.get(d.node.id) as number) < (paintIndex.get(owner) as number) && inside(d, x, y));
  const record = (into: Measure, l: ShadowLayer, x: number, y: number, under: Rgba): void => {
    const i = (y * chrome.width + x) * 4;
    const want = plant === 'tree-order' && coveredInTreeOrder(x, y) ? modelAt(treeList, x, y) : platformOver(l, x, y, under);
    const d = Math.max(...want.map((v, k) => Math.abs(v - (chrome.data[i + k] as number))));
    into.pixels++;
    if (d > into.max) {
      into.max = d;
      into.worst = `${x},${y} Chrome ${JSON.stringify([...chrome.data.slice(i, i + 3)])} reference ${JSON.stringify(want)}`;
    }
  };
  const check = (l: ShadowLayer, plain: ShadowLayer, x: number, y: number, under: Rgba): void => {
    record(m, l, x, y, under);
    record(mp, plain, x, y, under);
  };
  list.forEach((b, index) => {
    const l = layers[index];
    if (l === null || l === undefined) return;
    owner = b.node.id;
    const later = list.slice(index + 1);
    const descendants = later.filter((d) => { for (let a = d.node.parent; a !== null; a = list.find((x) => x.node.id === a)?.node.parent ?? null) if (a === b.node.id) return true; return false; });
    for (let y = l.plainOuter.top; y < l.plainOuter.bottom; y++) for (let x = l.plainOuter.left; x < l.plainOuter.right; x++) {
      if (alphaAt(l.plainOuter, x, y) === 0 || x < 0 || y < 0 || x >= chrome.width || y >= chrome.height) continue;
      if (inside({ ...b, l: b.l - I, t: b.t - I, r: b.r + I, b: b.b + I }, x, y) || !smooth(l.coverage, x, y) || painted(x, y) !== 1 || later.some((d) => inside({ ...d, l: d.l - I, t: d.t - I, r: d.r + I, b: d.b + I }, x, y))) continue;
      const stop = { index, background: false };
      const under = modelAt(list, x, y, stop);
      if (!flatBackdrop(list, x, y, stop, under)) continue;
      check(l.outer, l.plainOuter, x, y, under);
    }
    const pl = b.l + (b.border[3] as number) + I;
    const pt = b.t + (b.border[0] as number) + I;
    const pr = b.r - (b.border[1] as number) - I;
    const pb = b.b - (b.border[2] as number) - I;
    for (let y = l.plainInset.top; y < l.plainInset.bottom; y++) for (let x = l.plainInset.left; x < l.plainInset.right; x++) {
      if (alphaAt(l.plainInset, x, y) === 0 || x < pl || x + 1 > pr || y < pt || y + 1 > pb) continue;
      if (!smooth(l.coverage, x, y) || painted(x, y) !== 1 || descendants.some((d) => inside({ ...d, l: d.l - I, t: d.t - I, r: d.r + I, b: d.b + I }, x, y))) continue;
      const stop = { index, background: true };
      const under = modelAt(list, x, y, stop);
      if (!flatBackdrop(list, x, y, stop, under)) continue;
      check(l.inset, l.plainInset, x, y, under);
    }
  });
  return { over: m, plain: mp };
}

describe('PNT1 shadow: the TS reference against Chrome at every clear shadow pixel (the measured allowance)', () => {
  it('covers the shadow fixtures and the calibration set in both directions', () => {
    expect(SHADOW_FIXTURES.map((f) => f.id)).toEqual(['shadow-basic', 'shadow-rounded', 'shadow-inset', 'shadow-cascade', 'shadow-webkit-alias', 'shadow-transform', 'shadow-transform-order', 'calib-shadow-blur', 'calib-shadow-colors']);
  });
  const all: Measure = { max: 0, pixels: 0, worst: '' };
  const plainAll: Measure = { max: 0, pixels: 0, worst: '' };
  for (const spec of SHADOW_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}: within the shadow allowance, and every shadow sample point on a clear pixel`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        const p = programs.programs.uikit;
        const problems: string[] = [];
        for (const dpr of DPRS) {
          const list = boxes(p, c.environment.viewport, dpr);
          const { over: m, plain } = measure(c.id, list, p, dpr);
          console.log(`pnt1-shadow ${c.id}@${dpr}: ${m.pixels} shadow pixels, max channel difference ${m.max}${m.max > 0 ? ` (${m.worst})` : ''}; plain layers ${plain.max}`);
          if (m.pixels === 0) problems.push(`${c.id}@${dpr}: no clear shadow pixel`);
          if (m.max > SHADOW_MEASURED_MAX) problems.push(`${c.id}@${dpr}: ${m.max} > ${SHADOW_MEASURED_MAX} at ${m.worst}`);
          all.max = Math.max(all.max, m.max);
          plainAll.max = Math.max(plainAll.max, plain.max);
          all.pixels += m.pixels;
          const points = casePoints(p, c.environment.viewport, dpr).filter((q) => q.rule.startsWith('shadow:'));
          if (points.length === 0) problems.push(`${c.id}@${dpr}: no shadow sample point`);
        }
        expect(problems).toEqual([]);
      }, 600_000);
    }
  }
  const transformed = SHADOW_FIXTURES.find((f) => f.id === 'shadow-transform');
  if (transformed === undefined) throw new Error('no shadow-transform fixture');
  for (const c of casesOf(transformed, fixtureInput(transformed))) {
    it(`${c.id}: the shadow drawn untransformed, and drawn with its blur left unscaled, each differ from Chrome at a clear pixel at every DPR`, () => {
      const programs = nativePrograms(nativeCompile(transformed, c.environment.direction), c.assignment);
      if (programs.kind !== 'ready') throw new Error(programs.reason);
      const p = programs.programs.uikit;
      const missed: string[] = [];
      for (const dpr of DPRS) {
        const list = boxes(p, c.environment.viewport, dpr);
        for (const plant of ['untransformed', 'blur-unscaled'] as const) {
          const { over: m } = measure(c.id, list, p, dpr, plant);
          console.log(`pnt1-shadow ${c.id}@${dpr} plant ${plant}: ${m.pixels} pixels, max channel difference ${m.max}`);
          if (!(m.max > SHADOW_MEASURED_MAX)) missed.push(`${plant}@${dpr}`);
        }
      }
      expect(missed).toEqual([]);
    }, 600_000);
  }
  const ordered = SHADOW_FIXTURES.find((f) => f.id === 'shadow-transform-order');
  if (ordered === undefined) throw new Error('no shadow-transform-order fixture');
  for (const c of casesOf(ordered, fixtureInput(ordered))) {
    it(`${c.id}: the shadow left at its box's tree place, and drawn over its ancestors' fills alone, each differ from Chrome at a clear pixel at every DPR`, () => {
      const programs = nativePrograms(nativeCompile(ordered, c.environment.direction), c.assignment);
      if (programs.kind !== 'ready') throw new Error(programs.reason);
      const p = programs.programs.uikit;
      const missed: string[] = [];
      for (const dpr of DPRS) {
        const list = boxes(p, c.environment.viewport, dpr);
        for (const plant of ['tree-order', 'backdrop-ancestors'] as const) {
          const { over: m } = measure(c.id, list, p, dpr, plant);
          console.log(`pnt1-shadow ${c.id}@${dpr} plant ${plant}: ${m.pixels} pixels, max channel difference ${m.max}`);
          if (!(m.max > SHADOW_MEASURED_MAX)) missed.push(`${plant}@${dpr}`);
        }
      }
      expect(missed).toEqual([]);
    }, 600_000);
  }
  it('the device layers measure 0 (the plain layers, one platform composite, measure 2); the allowance is GATE_CHANNEL_DELTA (decisions.md)', () => {
    console.log(`pnt1-shadow: ${all.pixels} shadow pixels over the shadow fixtures and the calibration set, max channel difference ${all.max}; plain layers ${plainAll.max}`);
    expect(all.pixels).toBeGreaterThan(0);
    expect(all.max).toBe(SHADOW_MEASURED_MAX);
    expect(SHADOW_MEASURED_MAX).toBe(0);
    expect(plainAll.max).toBe(PLAIN_MEASURED_MAX);
    expect(SHADOW_CHANNEL_DELTA).toBe(GATE_CHANNEL_DELTA);
  });
});
