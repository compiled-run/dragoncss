// PNT1 box-shadow on the host (T046 §2, the two-stage paint proof): the TS paint-shadow.ts layers of every shadow fixture and of
// the calibration set, composited over the host paint model's backdrop the way the platforms composite a premultiplied layer
// (round to nearest), against the committed Chrome PNGs at every device DPR, at every shadow pixel clear of an antialiased edge
// (2 device px outside the border box or inside the padding box, a smooth 5 x 5 neighbourhood) that no later box covers. The
// largest per-channel difference is the measured shadow allowance: allowances/shadow.ts must equal it and be at most 2. The
// sample points of the shadow rule are proven clear the same way.
import { describe, expect, it } from 'vitest';
import { insetShadowLayer, NO_SHADOW_FAULTS, outerShadowLayer } from '@dragon/layout';
import type { ShadowLayer } from '@dragon/layout';
import { nativePrograms } from 'dragon';
import { SHADOW_CHANNEL_DELTA } from '../src/allowances/shadow.ts';
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
const SHADOW_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'shadow')?.fixtures ?? []).filter((f) => f.kind === 'layout');

function alphaAt(l: ShadowLayer, x: number, y: number): number {
  if (x < l.left || x >= l.right || y < l.top || y >= l.bottom) return 0;
  return l.rgba[4 * ((y - l.top) * (l.right - l.left) + (x - l.left)) + 3] as number;
}

function smooth(l: ShadowLayer, x: number, y: number): boolean {
  let lo = 255;
  let hi = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const a = alphaAt(l, x + dx, y + dy);
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  return hi - lo <= 64;
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
    return {
      outer: outerShadowLayer(b.l, b.t, b.r, b.b, b.radii === null ? zero : b.radii.slice(0, 8), opaque, shadows, dpr, NO_SHADOW_FAULTS),
      inset: insetShadowLayer(b.l, b.t, b.r, b.b, b.border, b.radii === null ? zero : b.radii.slice(8, 16), shadows, dpr, NO_SHADOW_FAULTS),
    };
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
      if (inside({ ...b, l: b.l - I, t: b.t - I, r: b.r + I, b: b.b + I }, x, y) || !smooth(l.outer, x, y) || painted(x, y) !== 1 || later.some((d) => inside(d, x, y))) continue;
      check(l.outer, x, y, modelAt(list, x, y, { index, background: false }));
    }
    const pl = b.l + (b.border[3] as number) + I;
    const pt = b.t + (b.border[0] as number) + I;
    const pr = b.r - (b.border[1] as number) - I;
    const pb = b.b - (b.border[2] as number) - I;
    for (let y = l.inset.top; y < l.inset.bottom; y++) for (let x = l.inset.left; x < l.inset.right; x++) {
      if (alphaAt(l.inset, x, y) === 0 || x < pl || x + 1 > pr || y < pt || y + 1 > pb) continue;
      if (!smooth(l.inset, x, y) || painted(x, y) !== 1 || descendants.some((d) => inside(d, x, y))) continue;
      check(l.inset, x, y, modelAt(list, x, y, { index, background: true }));
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
        for (const dpr of DPRS) {
          const list = boxes(p, c.environment.viewport, dpr);
          const m = measure(c.id, list, p, dpr);
          console.log(`pnt1-shadow ${c.id}@${dpr}: ${m.pixels} shadow pixels, max channel difference ${m.max}${m.max > 0 ? ` (${m.worst})` : ''}`);
          expect(m.pixels, `${c.id}@${dpr}`).toBeGreaterThan(0);
          expect(m.max, `${c.id}@${dpr}: ${m.worst}`).toBeLessThanOrEqual(SHADOW_CHANNEL_DELTA);
          all.max = Math.max(all.max, m.max);
          all.pixels += m.pixels;
          const points = casePoints(p, c.environment.viewport, dpr).filter((q) => q.rule.startsWith('shadow:'));
          expect(points.length, `${c.id}@${dpr} shadow points`).toBeGreaterThan(0);
        }
      }, 600_000);
    }
  }
  it('the allowance is the measured maximum, a whole channel level of at most 2 (decisions.md Paint, T046 §2)', () => {
    console.log(`pnt1-shadow: ${all.pixels} shadow pixels over the shadow fixtures and the calibration set, max channel difference ${all.max}`);
    expect(SHADOW_CHANNEL_DELTA).toBeLessThanOrEqual(2);
    if (all.pixels > 0) expect(SHADOW_CHANNEL_DELTA).toBe(all.max);
  });
});
