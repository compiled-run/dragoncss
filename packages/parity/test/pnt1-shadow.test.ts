// PNT1 box-shadow on the host (T046 §2, the two-stage paint proof): the TS paint-shadow.ts layers of every shadow fixture and of
// the calibration set, composited over the host paint model's backdrop the way the platforms composite a premultiplied layer
// (round to nearest), against the committed Chrome PNGs at every device DPR, at every shadow pixel clear of an antialiased edge
// (2 device px outside the border box or inside the padding box, each shadow's own coverage smooth over the 5 x 5 neighbourhood,
// and the backdrop model one colour over the pixel grown by 2 device px) that no later box covers. The largest per-channel
// difference is pinned (SHADOW_MEASURED_MAX): it is the composite's rounding (a premultiplied layer over the backdrop rounds to
// nearest, Skia's blit floors (backdrop * (256 - alpha)) >> 8 once per shadow), and above 2 is a stop (T046 §2). The shadow
// allowance (allowances/shadow.ts) stays GATE_CHANNEL_DELTA until the PM records the ruling; it may then only be this value.
import { describe, expect, it } from 'vitest';
import { insetShadowLayer, NO_SHADOW_FAULTS, outerShadowLayer } from '@dragon/layout';
import type { ShadowInput, ShadowLayer } from '@dragon/layout';
import { nativePrograms } from 'dragon';
import { SHADOW_CHANNEL_DELTA } from '../src/allowances/shadow.ts';
import { GATE_CHANNEL_DELTA } from '../src/compare.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels } from '../src/pixel-reference.ts';
import { shadowInputs } from '../src/paint-samples/shadow.ts';
import { SAMPLE_INSET_DEVICE_PX } from '../src/samples.ts';
import type { Box, Rgba } from './paint-model.ts';
import { boxes, modelAt } from './paint-model.ts';

const I = SAMPLE_INSET_DEVICE_PX;
/** The measured maximum per-channel difference over the shadow fixtures and the calibration set at DPR 2, 3 and 2.625. */
const SHADOW_MEASURED_MAX = 2;
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

const inside = (b: Box, x: number, y: number): boolean => x + 1 > b.l && x < b.r && y + 1 > b.t && y < b.b;

type Measure = { max: number; pixels: number; worst: string };

/** The measured difference of one case at one DPR over every clear shadow pixel. */
function measure(caseId: string, list: readonly Box[], p: import('dragon').NativeProgram, dpr: number): Measure {
  const chrome = committedPixels(caseId, dpr);
  if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
  const m: Measure = { max: 0, pixels: 0, worst: '' };
  const layers = list.map((b) => {
    const shadows = shadowInputs(p, b.node.id);
    if (shadows === null) return null;
    const bg = b.node.writes.find((w) => w.kind === 'background-color');
    const opaque = bg !== undefined && bg.kind === 'background-color' && bg.color.alpha === 255;
    const zero = [0, 0, 0, 0, 0, 0, 0, 0];
    const layerOf = (list: readonly ShadowInput[]): [ShadowLayer, ShadowLayer] => [
      outerShadowLayer(b.l, b.t, b.r, b.b, b.radii === null ? zero : b.radii.slice(0, 8), opaque, list, dpr, NO_SHADOW_FAULTS),
      insetShadowLayer(b.l, b.t, b.r, b.b, b.border, b.radii === null ? zero : b.radii.slice(8, 16), list, dpr, NO_SHADOW_FAULTS),
    ];
    const [outer, inset] = layerOf(shadows);
    return { outer, inset, coverage: shadows.flatMap((s) => layerOf([{ ...s, r: 0, g: 0, b: 0, a: 255 }])) };
  });
  const painted = (x: number, y: number): number => layers.filter((l) => l !== null && (alphaAt(l.outer, x, y) > 0 || alphaAt(l.inset, x, y) > 0)).length;
  const check = (l: ShadowLayer, x: number, y: number, under: Rgba): void => {
    const i = (y * chrome.width + x) * 4;
    const want = platformOver(l, x, y, under);
    const d = Math.max(...want.map((v, k) => Math.abs(v - (chrome.data[i + k] as number))));
    m.pixels++;
    if (d > m.max) {
      m.max = d;
      m.worst = `${x},${y} Chrome ${JSON.stringify([...chrome.data.slice(i, i + 3)])} reference ${JSON.stringify(want)}`;
    }
  };
  list.forEach((b, index) => {
    const l = layers[index];
    if (l === null || l === undefined) return;
    const later = list.slice(index + 1);
    const descendants = later.filter((d) => { for (let a = d.node.parent; a !== null; a = list.find((x) => x.node.id === a)?.node.parent ?? null) if (a === b.node.id) return true; return false; });
    for (let y = l.outer.top; y < l.outer.bottom; y++) for (let x = l.outer.left; x < l.outer.right; x++) {
      if (alphaAt(l.outer, x, y) === 0 || x < 0 || y < 0 || x >= chrome.width || y >= chrome.height) continue;
      if (inside({ ...b, l: b.l - I, t: b.t - I, r: b.r + I, b: b.b + I }, x, y) || !smooth(l.coverage, x, y) || painted(x, y) !== 1 || later.some((d) => inside({ ...d, l: d.l - I, t: d.t - I, r: d.r + I, b: d.b + I }, x, y))) continue;
      const stop = { index, background: false };
      const under = modelAt(list, x, y, stop);
      if (!flatBackdrop(list, x, y, stop, under)) continue;
      check(l.outer, x, y, under);
    }
    const pl = b.l + (b.border[3] as number) + I;
    const pt = b.t + (b.border[0] as number) + I;
    const pr = b.r - (b.border[1] as number) - I;
    const pb = b.b - (b.border[2] as number) - I;
    for (let y = l.inset.top; y < l.inset.bottom; y++) for (let x = l.inset.left; x < l.inset.right; x++) {
      if (alphaAt(l.inset, x, y) === 0 || x < pl || x + 1 > pr || y < pt || y + 1 > pb) continue;
      if (!smooth(l.coverage, x, y) || painted(x, y) !== 1 || descendants.some((d) => inside({ ...d, l: d.l - I, t: d.t - I, r: d.r + I, b: d.b + I }, x, y))) continue;
      const stop = { index, background: true };
      const under = modelAt(list, x, y, stop);
      if (!flatBackdrop(list, x, y, stop, under)) continue;
      check(l.inset, x, y, under);
    }
  });
  return m;
}

describe('PNT1 shadow: the TS reference against Chrome at every clear shadow pixel (the measured allowance)', () => {
  it('covers the shadow fixtures and the calibration set in both directions', () => {
    expect(SHADOW_FIXTURES.map((f) => f.id)).toEqual(['shadow-basic', 'shadow-rounded', 'shadow-inset', 'shadow-cascade', 'calib-shadow-blur', 'calib-shadow-colors']);
  });
  const all: Measure = { max: 0, pixels: 0, worst: '' };
  for (const spec of SHADOW_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}: within the shadow allowance, and every shadow sample point on a clear pixel`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        const p = programs.programs.uikit;
        const problems: string[] = [];
        for (const dpr of DPRS) {
          const list = boxes(p, c.environment.viewport, dpr);
          const m = measure(c.id, list, p, dpr);
          console.log(`pnt1-shadow ${c.id}@${dpr}: ${m.pixels} shadow pixels, max channel difference ${m.max}${m.max > 0 ? ` (${m.worst})` : ''}`);
          if (m.pixels === 0) problems.push(`${c.id}@${dpr}: no clear shadow pixel`);
          if (m.max > SHADOW_MEASURED_MAX) problems.push(`${c.id}@${dpr}: ${m.max} > ${SHADOW_MEASURED_MAX} at ${m.worst}`);
          all.max = Math.max(all.max, m.max);
          all.pixels += m.pixels;
          const points = casePoints(p, c.environment.viewport, dpr).filter((q) => q.rule.startsWith('shadow:'));
          if (points.length === 0) problems.push(`${c.id}@${dpr}: no shadow sample point`);
        }
        expect(problems).toEqual([]);
      }, 600_000);
    }
  }
  it('the measured maximum is pinned and at most 2; the allowance is GATE_CHANNEL_DELTA until ruled, then only the measurement (T046 §2)', () => {
    console.log(`pnt1-shadow: ${all.pixels} shadow pixels over the shadow fixtures and the calibration set, max channel difference ${all.max}`);
    expect(all.pixels).toBeGreaterThan(0);
    expect(all.max).toBe(SHADOW_MEASURED_MAX);
    expect(SHADOW_MEASURED_MAX).toBeLessThanOrEqual(2);
    expect([GATE_CHANNEL_DELTA, SHADOW_MEASURED_MAX]).toContain(SHADOW_CHANNEL_DELTA);
  });
});
