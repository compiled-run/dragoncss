// PNT1 radius on the host (T046 §2): the radius fixtures' points against the committed Chrome PNGs at every device DPR. A small
// paint model (boxes in tree order, each filling its rounded border box, borders between the rounded border-box and padding-edge
// shapes, rounded overflow clips of ancestors, Skia's 8-bit source-over) predicts each sample's colour from the program and the TS
// paint-radius.ts geometry; every radius, clip and kept base colour point must equal Chrome exactly. This proves the geometry the
// device draws with (percentages, the §5.5 clamp, the padding-edge radii) before any device runs, and that the points are clear.
import { describe, expect, it } from 'vitest';
import { hasRoundedCorner, NO_RADIUS_FAULTS, roundedShape, snapEdges } from '@dragon/layout';
import type { NativeProgram, ProgramNode } from 'dragon';
import { borderDevicePx, nativePrograms, programInput } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { expectedEngine, nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';

type Rgba = readonly [number, number, number, number];
type Box = { readonly node: ProgramNode; readonly l: number; readonly t: number; readonly r: number; readonly b: number; readonly border: readonly number[]; readonly radii: readonly number[] | null };

/** SkMulDiv255Round. */
const mul255 = (a: number, b: number): number => {
  const p = a * b + 128;
  return (p + (p >> 8)) >> 8;
};

/** Skia's 8-bit source-over of an unpremultiplied colour onto an opaque destination. */
function over(dst: Rgba, src: Rgba): Rgba {
  const a = src[3];
  if (a === 255) return src;
  if (a === 0) return dst;
  const k = 255 - a;
  return [mul255(src[0], a) + mul255(dst[0], k), mul255(src[1], a) + mul255(dst[1], k), mul255(src[2], a) + mul255(dst[2], k), 255];
}

/** Whether (x, y) is inside a rect with eight corner radii (a corner with a zero component is square). */
function insideRounded(x: number, y: number, l: number, t: number, r: number, b: number, radii: readonly number[] | null): boolean {
  if (x < l || x > r || y < t || y > b) return false;
  if (radii === null) return true;
  const corners: readonly [number, number, number, number][] = [[l, t, -1, -1], [r, t, 1, -1], [r, b, 1, 1], [l, b, -1, 1]];
  for (let k = 0; k < 4; k++) {
    const rx = radii[k] as number;
    const ry = radii[k + 4] as number;
    if (!(rx > 0 && ry > 0)) continue;
    const [px, py, sx, sy] = corners[k] as [number, number, number, number];
    const cx = px - sx * rx;
    const cy = py - sy * ry;
    if ((x - cx) * sx > 0 && (y - cy) * sy > 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) return false;
  }
  return true;
}

const channels = (c: { r: number; g: number; b: number; alpha: number }): Rgba => [c.r, c.g, c.b, c.alpha];

/** The boxes of a program at a DPR with their snapped edges, device-px borders and rounded shapes (16 radii) or null. */
function boxes(p: NativeProgram, viewport: { width: number; height: number }, dpr: number): Box[] {
  const engine = expectedEngine();
  const input = programInput(p, viewport, dpr);
  const out = engine.layout(input, engine.measurer);
  if (out.kind !== 'ok') throw new Error('the engine refused the case');
  const snapped = snapEdges(out.boxes);
  const borders = borderDevicePx(engine, input);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const list: Box[] = [];
  out.boxes.forEach((r, i) => {
    const n = byId.get(r.id);
    if (n === undefined || n.kind === 'text') return;
    const s = snapped[i] as { left: number; top: number; right: number; bottom: number };
    const border = borders.get(r.id) ?? [0, 0, 0, 0];
    const facts = n.facts['radius'] as { lengths: { percent: boolean; value: number }[] } | undefined;
    const shape = facts === undefined ? null : roundedShape(s.left, s.top, s.right, s.bottom, border, facts.lengths, dpr, NO_RADIUS_FAULTS);
    list.push({ node: n, l: s.left, t: s.top, r: s.right, b: s.bottom, border, radii: shape !== null && hasRoundedCorner(shape.slice(0, 8)) ? shape : null });
  });
  return list;
}

/** The model's colour at the centre of pixel (x, y): white canvas, then every box in tree order, clipped by clipping ancestors. */
function modelAt(list: readonly Box[], x: number, y: number): Rgba {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const byId = new Map(list.map((b) => [b.node.id, b]));
  const padding = (b: Box): [number, number, number, number] => [b.l + (b.border[3] as number), b.t + (b.border[0] as number), b.r - (b.border[1] as number), b.b - (b.border[2] as number)];
  let colour: Rgba = [255, 255, 255, 255];
  for (const b of list) {
    let clipped = false;
    for (let a = b.node.parent === null ? undefined : byId.get(b.node.parent); a !== undefined; a = a.node.parent === null ? undefined : byId.get(a.node.parent)) {
      if (!a.node.clips) continue;
      const [pl, pt, pr, pb] = padding(a);
      if (!insideRounded(cx, cy, pl, pt, pr, pb, a.radii === null ? null : a.radii.slice(8, 16))) clipped = true;
    }
    if (clipped || !insideRounded(cx, cy, b.l, b.t, b.r, b.b, b.radii === null ? null : b.radii.slice(0, 8))) continue;
    const bg = b.node.writes.find((w) => w.kind === 'background-color');
    if (bg !== undefined && bg.kind === 'background-color') colour = over(colour, channels(bg.color));
    const [pl, pt, pr, pb] = padding(b);
    if (insideRounded(cx, cy, pl, pt, pr, pb, b.radii === null ? null : b.radii.slice(8, 16))) continue;
    const styles = b.node.writes.find((w) => w.kind === 'border-styles');
    const colours = b.node.writes.find((w) => w.kind === 'border-colors');
    if (styles === undefined || styles.kind !== 'border-styles' || colours === undefined || colours.kind !== 'border-colors') continue;
    // The side whose trapezoid (outer corner to inner corner diagonals) holds the point.
    const side = sideOf(cx, cy, b, [pl, pt, pr, pb]);
    const style = styles.styles[side];
    if (style === 'none' || style === 'hidden' || (b.border[side] as number) === 0) continue;
    colour = over(colour, channels(colours.colors[side] as { r: number; g: number; b: number; alpha: number }));
  }
  return colour;
}

/** The border side a point of the border band paints: the band it lies in, or across a corner the side of the outer-to-inner diagonal. */
function sideOf(x: number, y: number, b: Box, inner: readonly [number, number, number, number]): number {
  const [il, it, ir, ib] = inner;
  const bands = [y < it, x >= ir, y >= ib, x < il];
  const inBands = [0, 1, 2, 3].filter((k) => bands[k]);
  if (inBands.length === 1) return inBands[0] as number;
  // A corner: the side of the diagonal from the outer corner to the inner corner (across a rounded corner, the nearer corner).
  const right = inBands.length === 0 ? x >= (il + ir) / 2 : bands[1] === true;
  const bottom = inBands.length === 0 ? y >= (it + ib) / 2 : bands[2] === true;
  const ox = right ? b.r : b.l;
  const oy = bottom ? b.b : b.t;
  const ix = right ? ir : il;
  const iy = bottom ? ib : it;
  const vertical = right ? 1 : 3;
  const horizontal = bottom ? 2 : 0;
  // Along the diagonal, the horizontal side owns the points nearer its edge than the diagonal is.
  const t = Math.abs(ix - ox) === 0 ? Infinity : Math.abs(x - ox) / Math.abs(ix - ox);
  const u = Math.abs(iy - oy) === 0 ? Infinity : Math.abs(y - oy) / Math.abs(iy - oy);
  return u < t ? horizontal : vertical;
}

const RADIUS_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'radius')?.fixtures ?? []).filter((f) => f.kind === 'layout');

describe('PNT1 radius: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the five radius fixtures in both directions', () => {
    expect(RADIUS_FIXTURES.map((f) => f.id)).toEqual(['radius-basic', 'radius-borders', 'radius-clip', 'radius-clamp', 'radius-cascade']);
  });
  for (const spec of RADIUS_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        const p = programs.programs.uikit;
        let radiusPoints = 0;
        const problems: string[] = [];
        for (const dpr of DPRS) {
          const chrome = committedPixels(c.id, dpr);
          if (chrome === null) throw new Error(`${c.id}@${dpr}: no committed Chrome PNG`);
          const list = boxes(p, c.environment.viewport, dpr);
          for (const pt of casePoints(p, c.environment.viewport, dpr)) {
            const kind = ruleKind(pt.rule);
            if (kind === 'edge' || kind === 'glyph') continue;
            if (kind === 'radius' || (kind === 'clip' && pt.rule.split(':').length === 3 && /-(left|right)$/.test(pt.rule))) radiusPoints++;
            const i = (pt.y * chrome.width + pt.x) * 4;
            const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
            const want = modelAt(list, pt.x, pt.y);
            if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
          }
        }
        expect(problems).toEqual([]);
        expect(radiusPoints, 'radius and rounded clip points').toBeGreaterThan(0);
      });
    }
  }
});
