// TXT-FX on the host: text-shadow-blur's text shadows against the committed Chrome PNGs at every device DPR. The model is what the
// device shows (dragon emit/paint/text-shadow.ts): the translated paint-shadow.ts textShadowLayerOver of each shadowed line, over
// the backdrop its container and the container's ancestors paint (as the device gathers it, dragonShadowBackdrop), composited over
// the host paint model's page the way the platforms composite a premultiplied layer (round to nearest, as pnt1-shadow measures).
// At every clean pixel of every shadowed line (paint-samples/text-shadow.ts shadowedLines: the blur reads no glyph edge Core Text
// dilates, and no glyph, box edge, other box or other line's shadow is near) the largest per-channel difference must be 0, the
// text-shadow rule's channel delta (GATE_CHANNEL_DELTA). Every line needs clean pixels and sample points at every DPR. The planted
// fault sigmaHalfBlur (sigma from the css blur, not the device blur) and the text-shadow-offset-1 raster plant (device-run.ts
// PLANT_CASES: every shadow view one device px right) must each change a clean pixel at every DPR.
import { describe, expect, it } from 'vitest';
import { NO_SHADOW_FAULTS, textShadowLayerOver } from '@dragon/layout';
import type { BackdropFill, ShadowLayer } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { GATE_CHANNEL_DELTA } from '../src/compare.ts';
import { PLANT_CASES } from '../src/device-run.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { CHANNEL_DELTA_BY_KIND } from '../src/native-compare.ts';
import { nativeCompile } from '../src/native-host.ts';
import { shadowedLines } from '../src/paint-samples/text-shadow.ts';
import { caseBoxes, casePoints, committedPixels } from '../src/pixel-reference.ts';
import type { Box, Rgba } from './paint-model.ts';
import { boxes, modelAt } from './paint-model.ts';

const CASE = 'text-shadow-blur';
const SPEC = FIXTURE_GROUPS.flatMap((g) => g.fixtures).find((f) => f.id === CASE);
/** The shadowed texts of the fixture, in tree order. */
const TEXTS = 7;

/** A platform's source-over of a premultiplied layer pixel over an opaque backdrop, rounded to nearest. */
function platformOver(l: ShadowLayer, x: number, y: number, under: Rgba): number[] {
  if (x < l.left || x >= l.right || y < l.top || y >= l.bottom) return [under[0], under[1], under[2]];
  const i = 4 * ((y - l.top) * (l.right - l.left) + (x - l.left));
  const a = l.rgba[i + 3] as number;
  return [0, 1, 2].map((k) => Math.round((l.rgba[i + k] as number) + ((under[k] as number) * (255 - a)) / 255));
}

/** The backdrop fills the device gathers for a text's shadows: each ancestor's background, outermost first, then its container's. */
function backdropOf(list: readonly Box[], container: string): BackdropFill[] {
  const chain: Box[] = [];
  for (let id: string | null = container; id !== null; ) {
    const a = list.find((x) => x.node.id === id);
    if (a === undefined) break;
    chain.unshift(a);
    id = a.node.parent;
  }
  return chain.flatMap((a) => {
    const bg = a.node.writes.find((w) => w.kind === 'background-color');
    if (bg === undefined || bg.kind !== 'background-color') return [];
    return [{ left: a.l, top: a.t, right: a.r, bottom: a.b, radii: a.radii === null ? [0, 0, 0, 0, 0, 0, 0, 0] : a.radii.slice(0, 8), r: bg.color.r, g: bg.color.g, b: bg.color.b, a: bg.color.alpha }];
  });
}

type Measure = { max: number; pixels: number; worst: string; fault: number; plant: number };

/** The difference of one case at one DPR over every clean pixel of every shadowed line, and how many the fault and the plant change. */
function measure(caseId: string, p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number, problems: string[]): Measure {
  const chrome = committedPixels(caseId, dpr);
  if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
  const list = boxes(p, viewport, dpr);
  const lines = shadowedLines(p, viewport, dpr, caseBoxes(p, viewport, dpr));
  if (lines.length !== TEXTS) problems.push(`${caseId}@${dpr}: ${lines.length} shadowed lines, not ${TEXTS}`);
  const m: Measure = { max: 0, pixels: 0, worst: '', fault: 0, plant: 0 };
  const points = casePoints(p, viewport, dpr).filter((q) => q.rule.startsWith('text-shadow:'));
  for (const l of lines) {
    if (l.clean.length === 0) problems.push(`${caseId}@${dpr}: ${l.id} has no clean shadow pixel`);
    if (!points.some((q) => q.rule.startsWith(`text-shadow:${l.id}:`))) problems.push(`${caseId}@${dpr}: ${l.id} has no text-shadow point`);
    const backdrop = backdropOf(list, l.container);
    const over = textShadowLayerOver(l.cps, l.xs, l.size, l.baseline, l.shadows, dpr, NO_SHADOW_FAULTS, backdrop);
    const half = textShadowLayerOver(l.cps, l.xs, l.size, l.baseline, l.shadows, dpr, { ...NO_SHADOW_FAULTS, sigmaHalfBlur: true }, backdrop);
    for (const [x, y] of l.clean) {
      const i = (y * chrome.width + x) * 4;
      const got = [0, 1, 2].map((k) => chrome.data[i + k] as number);
      const under = modelAt(list, x, y);
      const want = platformOver(over, x, y, under);
      const d = Math.max(...want.map((v, k) => Math.abs(v - (got[k] as number))));
      m.pixels++;
      if (d > m.max) {
        m.max = d;
        m.worst = `${l.id} ${x},${y} Chrome ${JSON.stringify(got)} reference ${JSON.stringify(want)}`;
      }
      if (platformOver(half, x, y, under).some((v, k) => v !== got[k])) m.fault++;
      // text-shadow-offset-1: the layer drawn one device px right, so pixel x shows the layer's x - 1.
      if (platformOver(over, x - 1, y, under).some((v, k) => v !== got[k])) m.plant++;
    }
  }
  return m;
}

describe('TXT-FX text-shadow: the TS reference against Chrome at every clean text-shadow pixel', () => {
  it('the fixture is registered in both directions, the plant runs on it and the rule is compared strictly', () => {
    expect(SPEC?.kind === 'layout' ? SPEC.environments : null).toEqual(['ltr', 'rtl']);
    expect(PLANT_CASES['text-shadow-offset-1']).toEqual([CASE]);
    expect(CHANNEL_DELTA_BY_KIND['text-shadow']).toBe(GATE_CHANNEL_DELTA);
    expect(GATE_CHANNEL_DELTA).toBe(0);
  });
  if (SPEC === undefined) throw new Error(`no fixture ${CASE}`);
  for (const c of casesOf(SPEC, fixtureInput(SPEC))) {
    it(`${c.id} at ${DPRS.join(', ')}: every clean pixel equals Chrome, and the fault and the plant change one`, () => {
      const programs = nativePrograms(nativeCompile(SPEC, c.environment.direction), c.assignment);
      if (programs.kind !== 'ready') throw new Error(programs.reason);
      const problems: string[] = [];
      for (const dpr of DPRS) {
        const m = measure(c.id, programs.programs.uikit, c.environment.viewport, dpr, problems);
        console.log(`text-shadow ${c.id}@${dpr}: ${m.pixels} clean pixels, max channel difference ${m.max}${m.max > 0 ? ` (${m.worst})` : ''}; sigmaHalfBlur changes ${m.fault}, offset-1 ${m.plant}`);
        if (m.max > GATE_CHANNEL_DELTA) problems.push(`${c.id}@${dpr}: ${m.max} > ${GATE_CHANNEL_DELTA} at ${m.worst}`);
        if (m.fault === 0) problems.push(`${c.id}@${dpr}: sigmaHalfBlur changes no clean pixel`);
        if (m.plant === 0) problems.push(`${c.id}@${dpr}: text-shadow-offset-1 changes no clean pixel`);
      }
      expect(problems).toEqual([]);
    }, 600_000);
  }
});
