// MASK-CLIP mask-image on the host: the mask-gradient fixture's points against the committed Chrome PNGs at every device DPR. The
// paint model of pnt1-radius (paint-model.ts: boxes, overflow clips of ancestors, Skia's source-over), with the boxes in the
// program's Appendix E order (a mask makes a stacking context), and the mask plan the device builds (paint-samples/mask.ts
// maskPlans, the translated paint-gradient.ts): where every mask over a point has alpha 255 the point is the unmasked model, and
// where one has alpha 0 the boxes and glyphs of that mask's subtree are left out of it. A point under a partly transparent mask is
// never sampled (paint-samples/mask.ts keep), and none is judged here. Every colour, glyph and mask point must equal Chrome exactly.
// The mask-gradient-flip fault (the raster read bottom to top, as the device plant draws it) must disagree with Chrome somewhere in
// every case.
import { describe, expect, it } from 'vitest';
import type { NativeProgram, ProgramNode } from 'dragon';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import type { MaskPlan } from '../src/paint-samples/mask.ts';
import { maskAlpha, maskPlans } from '../src/paint-samples/mask.ts';
import { casePoints, committedPixels, glyphLines } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import type { Box, Rgba } from './paint-model.ts';
import { boxes, modelAt, over } from './paint-model.ts';

const MASK_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'mask')?.fixtures ?? []).filter((f) => f.kind === 'layout' && f.id === 'mask-gradient');
const MASKED = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];

type Plans = readonly (MaskPlan & { readonly rows: Map<number, readonly number[]> })[];

const paintOrder = (n: ProgramNode): number => {
  const f = n.facts['stacking'] as { readonly paintOrder: number } | undefined;
  if (f === undefined) throw new Error(`${n.id}: no stacking facts`);
  return f.paintOrder;
};

function textColour(p: NativeProgram, textId: string): Rgba {
  const w = p.nodes.find((n) => n.id === textId)?.writes.find((x) => x.kind === 'text-color');
  if (w === undefined || w.kind !== 'text-color') throw new Error(`${textId}: no text colour`);
  return [w.color.r, w.color.g, w.color.b, w.color.alpha];
}

function plansAt(p: NativeProgram, viewport: { width: number; height: number }, dpr: number, all: readonly Box[]): Plans {
  return maskPlans(p, viewport, dpr, new Map(all.map((b) => [b.node.id, b.border as [number, number, number, number]]))).map((m) => ({ ...m, rows: new Map() }));
}

/** The nodes the masks hide at pixel (x, y), or null when a mask over it is partly transparent there. */
function hiddenAt(plans: Plans, x: number, y: number, flip: boolean): Set<string> | null {
  const hidden = new Set<string>();
  for (const mp of plans) {
    const a = maskAlpha(mp.plan, x, y, mp.rows, flip);
    if (a !== 0 && a !== 255) return null;
    if (a === 0) for (const id of mp.subtree) hidden.add(id);
  }
  return hidden;
}

type Verdict = { readonly problems: string[]; readonly maskPoints: ReadonlyMap<string, number>; readonly edgePoints: number; readonly judged: number };

/** The model's verdict on one case at every DPR against the committed Chrome PNGs. */
function judge(caseId: string, p: NativeProgram, viewport: { width: number; height: number }, flip: boolean): Verdict {
  const problems: string[] = [];
  const maskPoints = new Map<string, number>();
  let edgePoints = 0;
  let judged = 0;
  for (const dpr of DPRS) {
    const chrome = committedPixels(caseId, dpr);
    if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
    const all = boxes(p, viewport, dpr).sort((a, b) => paintOrder(a.node) - paintOrder(b.node));
    const plans = plansAt(p, viewport, dpr, all);
    if (plans.length !== MASKED.length) throw new Error(`${caseId}@${dpr}: ${plans.length} mask plans, want ${MASKED.length}`);
    const inks = glyphLines(p, viewport, dpr).flatMap((l) => l.glyphs.map((g) => ({ g, text: l.id.slice(0, l.id.lastIndexOf(':line')) })));
    for (const pt of casePoints(p, viewport, dpr)) {
      const kind = ruleKind(pt.rule);
      if (kind === 'edge' && !pt.rule.includes(':mask-')) continue;
      if (kind === 'mask') maskPoints.set(pt.rule, (maskPoints.get(pt.rule) ?? 0) + 1);
      if (kind === 'edge') edgePoints++;
      const hidden = hiddenAt(plans, pt.x, pt.y, flip);
      // The scanline's middle pixel crosses the stop; flipped, a point may fall under the gradient's ramp, which the fault cannot say.
      if (hidden === null) {
        if (!flip && kind !== 'edge') problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: sampled under a partly transparent mask`);
        continue;
      }
      judged++;
      const backdrop = modelAt(all.filter((b) => !hidden.has(b.node.id)), pt.x, pt.y);
      const ink = inks.find(({ g, text }) => pt.x >= g.left && pt.x + 1 <= g.right && pt.y >= g.top && pt.y + 1 <= g.bottom && !hidden.has(text));
      const want: Rgba = ink !== undefined ? over(backdrop, textColour(p, ink.text)) : backdrop;
      const i = (pt.y * chrome.width + pt.x) * 4;
      const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
      if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
    }
  }
  return { problems, maskPoints, edgePoints, judged };
}

describe('MASK-CLIP mask-image: the sample points of the gradient masks', () => {
  it('covers the mask-gradient fixture in both directions', () => {
    expect(MASK_FIXTURES.map((f) => f.id)).toEqual(['mask-gradient']);
  });
  for (const spec of MASK_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id}: every masked box but the smooth one has flat mask points at every DPR, the hard stops have scanlines, and the flip moves the raster`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        for (const p of [programs.programs.uikit, programs.programs['android-views']]) {
          expect(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'mask-image')).map((n) => n.id)).toEqual(MASKED);
          for (const dpr of DPRS) {
            const points = casePoints(p, c.environment.viewport, dpr);
            const sampled = new Set(points.filter((q) => ruleKind(q.rule) === 'mask').map((q) => q.rule.slice('mask:'.length)));
            // m7's mask ramps from its top edge to its bottom edge, so no neighbourhood inside it is flat.
            expect([...sampled].sort(), `${c.id}@${dpr}`).toEqual(MASKED.filter((id) => id !== 'm7'));
            expect(points.some((q) => q.rule.startsWith('edge:m2:mask-x')), `${c.id}@${dpr}`).toBe(true);
            expect(points.some((q) => q.rule.startsWith('edge:m4:mask-y')), `${c.id}@${dpr}`).toBe(true);
            const plans = plansAt(p, c.environment.viewport, dpr, boxes(p, c.environment.viewport, dpr));
            const v = plans.find((m) => m.id === 'm1');
            if (v === undefined) throw new Error('no plan for m1');
            const x = Math.floor((v.plan.left + v.plan.right) / 2);
            expect(maskAlpha(v.plan, x, v.plan.top, v.rows), `${c.id}@${dpr}`).toBe(255);
            expect(maskAlpha(v.plan, x, v.plan.top, v.rows, true), `${c.id}@${dpr}`).toBe(0);
            expect(maskAlpha(v.plan, x, v.plan.bottom, v.rows), 'outside the border box').toBe(0);
          }
        }
      }, 600_000);
    }
  }
});

describe('MASK-CLIP mask-image: the paint model at every sample point equals the committed Chrome pixels', () => {
  for (const spec of MASK_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}; the flip fault is caught`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        for (const p of [programs.programs.uikit, programs.programs['android-views']]) {
          const v = judge(c.id, p, c.environment.viewport, false);
          expect(v.problems).toEqual([]);
          expect(v.maskPoints.size, 'mask points').toBe(MASKED.length - 1);
          expect(v.edgePoints, 'mask scanline points').toBeGreaterThan(0);
          const flipped = judge(c.id, p, c.environment.viewport, true);
          expect(flipped.judged, 'points the flip fault is judged at').toBeGreaterThan(0);
          expect(flipped.problems.length, 'flip').toBeGreaterThan(0);
        }
      }, 600_000);
    }
  }
});
