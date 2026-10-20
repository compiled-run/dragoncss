// MASK-CLIP clip-path on the host: the clip-path fixtures' points against the committed Chrome PNGs at every device DPR. The paint
// model of pnt1-radius (paint-model.ts: boxes, overflow clips of ancestors, Skia's source-over), with the boxes in the program's
// Appendix E order (a clip-path makes a stacking context, so a clipped flow box paints after its later in-flow siblings), leaves
// out of a box's paint every point outside the clip rect of the box or of any ancestor with a clip-path write (dragon clipPathRect,
// the rect the device computes); an Ahem glyph's points show the text colour where its text is inside every such rect. Every
// inset() fixture edge is a whole device px at every DPR, so no inset edge is antialiased; a circle(), ellipse() or polygon() clip
// keeps a pixel whose centre is inside its shape (the polygon's fill rule decides), and the samples keep clear of its antialiased
// outline (paint-samples/clip.ts). Every colour and glyph point must equal Chrome exactly. Two model faults must each disagree with Chrome somewhere in every case: the clip ignored (the device plant
// clip-path-ignored) and the clip applied to the box's own paint only, its descendants unclipped.
import { describe, expect, it } from 'vitest';
import type { NativeProgram, ProgramNode } from 'dragon';
import { clipPathInsets, clipPathRect, clipShapeGeometry, clipShapeKind, clipShapeValues, nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels, glyphLines } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import type { Box, Rgba } from './paint-model.ts';
import { boxes, modelAt, over } from './paint-model.ts';

const CLIP_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'clip-path')?.fixtures ?? []).filter((f) => f.kind === 'layout');

type Fault = 'none' | 'ignored' | 'own';
/** A clip in page device px: whether a point is inside it. */
type Clip = (x: number, y: number) => boolean;

/** Whether (x, y) is inside a closed polygon under its fill rule. */
function inPolygon(points: readonly (readonly [number, number])[], evenodd: boolean, x: number, y: number): boolean {
  let winding = 0;
  let crossings = 0;
  points.forEach(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length] as readonly [number, number];
    if ((ay <= y) === (by <= y)) return;
    const at = ax + ((y - ay) / (by - ay)) * (bx - ax);
    if (at > x) {
      crossings++;
      winding += by > ay ? 1 : -1;
    }
  });
  return evenodd ? crossings % 2 === 1 : winding !== 0;
}

/** The device-px clip of every node with a clip-path write, in page coordinates. */
function clipRects(list: readonly Box[], dpr: number): Map<string, Clip> {
  const out = new Map<string, Clip>();
  for (const b of list) {
    const w = b.node.writes.find((x) => x.kind === 'clip-path-inset' || x.kind === 'clip-path-shape');
    if (w === undefined || (w.kind !== 'clip-path-inset' && w.kind !== 'clip-path-shape')) continue;
    if (b.size === undefined) throw new Error(`${b.node.id}: no layout size`);
    if (w.kind === 'clip-path-inset') {
      const [l, t, r, bt] = clipPathRect(clipPathInsets(w.edges), { left: b.l, top: b.t, right: b.r, bottom: b.b }, b.size, dpr);
      out.set(b.node.id, (x, y) => x >= b.l + l && x < b.l + r && y >= b.t + t && y < b.t + bt);
      continue;
    }
    const kind = clipShapeKind(w.shape);
    const g = clipShapeGeometry(kind, clipShapeValues(w.shape), b.size, dpr);
    if (kind === 2) {
      const points: [number, number][] = [];
      for (let i = 1; i + 1 < g.length; i += 2) points.push([b.l + (g[i] as number), b.t + (g[i + 1] as number)]);
      out.set(b.node.id, (x, y) => inPolygon(points, g[0] === 1, x, y));
      continue;
    }
    const [cx, cy, rx] = [b.l + (g[0] as number), b.t + (g[1] as number), g[2] as number];
    const ry = (kind === 0 ? g[2] : g[3]) as number;
    out.set(b.node.id, (x, y) => rx > 0 && ry > 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);
  }
  return out;
}

/** Whether the centre of pixel (x, y) is inside the clip rect of a node and of every ancestor with one (the fault decides which). */
function insideClips(p: NativeProgram, rects: ReadonlyMap<string, Clip>, id: string, x: number, y: number, fault: Fault): boolean {
  if (fault === 'ignored') return true;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const cx = x + 0.5;
  const cy = y + 0.5;
  for (let n: ProgramNode | undefined = byId.get(id); n !== undefined; n = n.parent === null ? undefined : byId.get(n.parent)) {
    if (fault === 'own' && n.id !== id) continue;
    const r = rects.get(n.id);
    if (r !== undefined && !r(cx, cy)) return false;
  }
  return true;
}

/** The text colour of a text node's runs. */
function textColour(p: NativeProgram, textId: string): Rgba {
  const w = p.nodes.find((n) => n.id === textId)?.writes.find((x) => x.kind === 'text-color');
  if (w === undefined || w.kind !== 'text-color') throw new Error(`${textId}: no text colour`);
  return [w.color.r, w.color.g, w.color.b, w.color.alpha];
}

const paintOrder = (n: ProgramNode): number => {
  const f = n.facts['stacking'] as { readonly paintOrder: number } | undefined;
  if (f === undefined) throw new Error(`${n.id}: no stacking facts`);
  return f.paintOrder;
};

type Verdict = { readonly problems: string[]; readonly clipPoints: number; readonly glyphPoints: number };

/** The model's verdict on one case at every DPR against the committed Chrome PNGs. */
function judge(caseId: string, p: NativeProgram, viewport: { width: number; height: number }, fault: Fault): Verdict {
  const problems: string[] = [];
  let clipPoints = 0;
  let glyphPoints = 0;
  for (const dpr of DPRS) {
    const chrome = committedPixels(caseId, dpr);
    if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
    const all = boxes(p, viewport, dpr).sort((a, b) => paintOrder(a.node) - paintOrder(b.node));
    const rects = clipRects(all, dpr);
    const inks = glyphLines(p, viewport, dpr).flatMap((l) => l.glyphs.map((g) => ({ g, text: l.id.slice(0, l.id.lastIndexOf(':line')) })));
    for (const pt of casePoints(p, viewport, dpr)) {
      const kind = ruleKind(pt.rule);
      if (kind === 'edge') continue;
      const list = all.filter((b) => insideClips(p, rects, b.node.id, pt.x, pt.y, fault));
      const backdrop = modelAt(list, pt.x, pt.y);
      // The painted glyph that covers the point, if any: the last in paint order, inside its text's clips.
      const ink = inks.find(({ g, text }) => pt.x >= g.left && pt.x + 1 <= g.right && pt.y >= g.top && pt.y + 1 <= g.bottom && insideClips(p, rects, text, pt.x, pt.y, fault));
      const want: Rgba = ink !== undefined ? over(backdrop, textColour(p, ink.text)) : backdrop;
      if (kind === 'glyph') glyphPoints++;
      if (kind === 'clip' && (pt.rule.includes(':path-') || pt.rule.includes(':shape-'))) clipPoints++;
      const i = (pt.y * chrome.width + pt.x) * 4;
      const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
      if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
    }
  }
  return { problems, clipPoints, glyphPoints };
}

describe('MASK-CLIP clip-path: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the four clip-path fixtures in both directions', () => {
    expect(CLIP_FIXTURES.map((f) => f.id)).toEqual(['clip-path-basic', 'clip-path-nested', 'clip-path-circle', 'clip-path-polygon']);
  });
  for (const spec of CLIP_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}; the ignored and own-only faults are caught`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        for (const p of [programs.programs.uikit, programs.programs['android-views']]) {
          const v = judge(c.id, p, c.environment.viewport, 'none');
          expect(v.problems).toEqual([]);
          expect(v.clipPoints, 'points across the clip edges').toBeGreaterThan(0);
          if (spec.id === 'clip-path-basic' || spec.id === 'clip-path-polygon') expect(v.glyphPoints, 'glyph points of text beside the clipped boxes').toBeGreaterThan(0);
          for (const fault of ['ignored', 'own'] as const) expect(judge(c.id, p, c.environment.viewport, fault).problems.length, fault).toBeGreaterThan(0);
        }
      });
    }
  }
});
