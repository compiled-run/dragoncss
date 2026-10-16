// MASK-CLIP clip-path on the host: the clip-path fixtures' points against the committed Chrome PNGs at every device DPR. The paint
// model of pnt1-radius (paint-model.ts: boxes, overflow clips of ancestors, Skia's source-over), with the boxes in the program's
// Appendix E order (a clip-path makes a stacking context, so a clipped flow box paints after its later in-flow siblings), leaves
// out of a box's paint every point outside the clip rect of the box or of any ancestor with a clip-path write (dragon clipPathRect,
// the rect the device computes); an Ahem glyph's points show the text colour where its text is inside every such rect. Every
// fixture edge is a whole device px at every DPR, so no clip edge is antialiased. Every colour and glyph point must equal Chrome
// exactly. Two model faults must each disagree with Chrome somewhere in every case: the clip ignored (the device plant
// clip-path-ignored) and the clip applied to the box's own paint only, its descendants unclipped.
import { describe, expect, it } from 'vitest';
import type { NativeProgram, ProgramNode } from 'dragon';
import { clipPathInsets, clipPathRect, nativePrograms } from 'dragon';
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
type Rect = readonly [number, number, number, number];

/** The device-px clip rect of every node with a clip-path write, in page coordinates. */
function clipRects(list: readonly Box[], dpr: number): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const b of list) {
    const w = b.node.writes.find((x) => x.kind === 'clip-path-inset');
    if (w === undefined || w.kind !== 'clip-path-inset') continue;
    if (b.size === undefined) throw new Error(`${b.node.id}: no layout size`);
    const [l, t, r, bt] = clipPathRect(clipPathInsets(w.edges), { left: b.l, top: b.t, right: b.r, bottom: b.b }, b.size, dpr);
    out.set(b.node.id, [b.l + l, b.t + t, b.l + r, b.t + bt]);
  }
  return out;
}

/** Whether the centre of pixel (x, y) is inside the clip rect of a node and of every ancestor with one (the fault decides which). */
function insideClips(p: NativeProgram, rects: ReadonlyMap<string, Rect>, id: string, x: number, y: number, fault: Fault): boolean {
  if (fault === 'ignored') return true;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const cx = x + 0.5;
  const cy = y + 0.5;
  for (let n: ProgramNode | undefined = byId.get(id); n !== undefined; n = n.parent === null ? undefined : byId.get(n.parent)) {
    if (fault === 'own' && n.id !== id) continue;
    const r = rects.get(n.id);
    if (r !== undefined && !(cx >= r[0] && cx < r[2] && cy >= r[1] && cy < r[3])) return false;
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
      if (kind === 'clip' && pt.rule.includes(':path-')) clipPoints++;
      const i = (pt.y * chrome.width + pt.x) * 4;
      const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
      if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
    }
  }
  return { problems, clipPoints, glyphPoints };
}

describe('MASK-CLIP clip-path: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the two clip-path fixtures in both directions', () => {
    expect(CLIP_FIXTURES.map((f) => f.id)).toEqual(['clip-path-basic', 'clip-path-nested']);
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
          if (spec.id === 'clip-path-basic') expect(v.glyphPoints, 'glyph points of text beside the clipped boxes').toBeGreaterThan(0);
          for (const fault of ['ignored', 'own'] as const) expect(judge(c.id, p, c.environment.viewport, fault).problems.length, fault).toBeGreaterThan(0);
        }
      });
    }
  }
});
