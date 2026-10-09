// PNT1 outline on the host (T046 §2): the outline fixtures' points against the committed Chrome PNGs at every device DPR. The paint
// model of pnt1-radius (boxes in tree order, rounded borders and clips, Skia's 8-bit source-over) paints every solid or double
// outline last, each box's descendants' outlines before its own (Blink's BoxFragmentPainter paints kDescendantOutlinesOnly, then
// kSelfOutlineOnly), as the rings of the TS paint-radius.ts outlineRings: what the device draws in the root view. Every
// outline, kept base and radius colour point must equal Chrome exactly. This proves the ring geometry (Blink's snapped width and
// truncated offset, the half-size clamp of a negative offset, the outset radii, double bands of round(width / 3)) and the paint
// order (an outline over a later flow sibling, a parent's outline over its child's) before any device runs; every fixture but
// outline-values must have outline points. In the plant's cases (device-run.ts PLANT_CASES), a model with the rings one device px to
// the right (the outline-offset-1 raster plant) must fail.
import { describe, expect, it } from 'vitest';
import { outlineOffsetPx, outlineRings, outlineWidthPx } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { PLANT_CASES } from '../src/device-run.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { outlineWrite } from '../src/paint-samples/outline.ts';
import { casePoints, committedPixels } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import type { Box, Rgba } from './paint-model.ts';
import { boxes, insideRounded, modelAt, over } from './paint-model.ts';

const OUTLINE_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'outline')?.fixtures ?? []).filter((f) => f.kind === 'layout');

type Rings = { readonly box: Box; readonly rings: readonly number[]; readonly color: Rgba };

/** The boxes in Blink's outline-phase order: each box after its descendants, siblings in tree order. */
function outlineOrder(list: readonly Box[]): Box[] {
  const ids = new Set(list.map((b) => b.node.id));
  const children = new Map<string, Box[]>();
  for (const b of list) if (b.node.parent !== null && ids.has(b.node.parent)) children.set(b.node.parent, [...(children.get(b.node.parent) ?? []), b]);
  const out: Box[] = [];
  const visit = (b: Box): void => {
    for (const c of children.get(b.node.id) ?? []) visit(c);
    out.push(b);
  };
  for (const b of list) if (b.node.parent === null || !ids.has(b.node.parent)) visit(b);
  if (out.length !== list.length) throw new Error(`outline order holds ${out.length} of ${list.length} boxes`);
  return out;
}

/** Every outline of a program at a DPR in outline-phase order, its rings shifted right by shift device px. */
function outlines(p: NativeProgram, list: readonly Box[], dpr: number, shift: number): Rings[] {
  const out: Rings[] = [];
  for (const b of outlineOrder(list)) {
    const w = outlineWrite({ program: p } as never, b.node.id);
    if (w === null) continue;
    const full = b.node.writes.find((x) => x.kind === 'outline');
    if (full === undefined || full.kind !== 'outline') throw new Error(`${b.node.id}: no outline write`);
    const radii = b.radii === null ? [0, 0, 0, 0, 0, 0, 0, 0] : b.radii.slice(0, 8);
    const rings = outlineRings(b.l + shift, b.t, b.r + shift, b.b, radii, outlineWidthPx(w.width, dpr), outlineOffsetPx(w.offset, dpr), w.style === 'double');
    out.push({ box: b, rings, color: [full.color.r, full.color.g, full.color.b, full.color.alpha] });
  }
  return out;
}

/** The model's colour at pixel (x, y): the boxes (modelAt), then every outline ring holding the pixel centre, in outline-phase order. */
function outlineModelAt(list: readonly Box[], rings: readonly Rings[], x: number, y: number): Rgba {
  let colour = modelAt(list, x, y);
  const cx = x + 0.5;
  const cy = y + 0.5;
  for (const o of rings) {
    const r = o.rings;
    for (let k = 0; k + 24 <= r.length; k += 24) {
      const v = (j: number): number => r[k + j] as number;
      if (insideRounded(cx, cy, v(0), v(1), v(2), v(3), r.slice(k + 8, k + 16)) && !insideRounded(cx, cy, v(4), v(5), v(6), v(7), r.slice(k + 16, k + 24))) colour = over(colour, o.color);
    }
  }
  return colour;
}

describe('PNT1 outline: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the four outline fixtures in both directions', () => {
    expect(OUTLINE_FIXTURES.map((f) => f.id)).toEqual(['outline-values', 'outline-solid', 'outline-double', 'outline-rounded']);
    expect(PLANT_CASES['outline-offset-1']).toEqual(['outline-solid']);
  });
  it('orders a parent outline after its descendants, and siblings in tree order', () => {
    const box = (id: string, parent: string | null): Box => ({ node: { id, parent } as Box['node'], l: 0, t: 0, r: 0, b: 0, border: [], radii: null });
    expect(outlineOrder([box('a', null), box('b', 'a'), box('c', 'b'), box('d', 'a'), box('e', null)]).map((b) => b.node.id)).toEqual(['c', 'b', 'd', 'a', 'e']);
  });
  for (const spec of OUTLINE_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        const p = programs.programs.uikit;
        let outlinePoints = 0;
        let caught = 0;
        const problems: string[] = [];
        for (const dpr of DPRS) {
          const chrome = committedPixels(c.id, dpr);
          if (chrome === null) throw new Error(`${c.id}@${dpr}: no committed Chrome PNG`);
          const list = boxes(p, c.environment.viewport, dpr);
          const rings = outlines(p, list, dpr, 0);
          const shifted = outlines(p, list, dpr, 1);
          for (const pt of casePoints(p, c.environment.viewport, dpr)) {
            const kind = ruleKind(pt.rule);
            const outline = pt.rule.includes(':outline-');
            const i = (pt.y * chrome.width + pt.x) * 4;
            const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
            const differs = (m: Rgba): boolean => got.some((v, k) => v !== m[k]);
            const want = outlineModelAt(list, rings, pt.x, pt.y);
            const planted = outlineModelAt(list, shifted, pt.x, pt.y);
            if (kind === 'edge' || kind === 'glyph') {
              // An edge scanline across a ring's outer edge is where the device plant shows (PLANT_RULES takes edge rules). The
              // model is not judged there (an antialiased edge), but a point it gets right that the shifted rings get wrong
              // catches the shift.
              if (kind === 'edge' && outline && !differs(want) && differs(planted)) caught++;
              continue;
            }
            if (outline) outlinePoints++;
            if (differs(want)) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
            if (differs(planted)) caught++;
          }
        }
        expect(problems).toEqual([]);
        if (spec.id === 'outline-values') {
          // Every outline here paints nothing, so the case has no outline write and no outline point.
          expect(p.nodes.some((n) => n.writes.some((w) => w.kind === 'outline'))).toBe(false);
          expect(outlinePoints).toBe(0);
        } else {
          expect(outlinePoints, 'outline points').toBeGreaterThan(0);
          // The plant runs on its cases only; elsewhere a mid-ring sample point need not move under a 1 device px shift.
          if (PLANT_CASES['outline-offset-1'].includes(spec.id)) expect(caught, 'the outline-offset-1 model fault').toBeGreaterThan(0);
        }
      });
    }
  }
});
