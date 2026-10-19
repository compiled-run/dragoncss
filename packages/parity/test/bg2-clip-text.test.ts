// BG2 background-clip: text on the host: the bg-clip-text fixture's points against the committed Chrome PNGs at every device DPR.
// The paint model of pnt1-radius (paint-model.ts: boxes in tree order, Skia's source-over) over the program's writes, where a box that
// clips a colour to transparent text writes no colour of its own and its glyphs carry the colour (background-clip-text.ts); an Ahem
// glyph's points show its text colour over what is under it. Every fixture edge is a whole device px at every DPR, so no edge is
// antialiased, and every colour and glyph point must equal Chrome exactly. Two model faults must each disagree with Chrome somewhere
// in every case: the glyphs left in their own transparent colour (the clip ignored on the text), and the colour also filling the
// fill boxes' border box (the clip ignored on the box).
import { describe, expect, it } from 'vitest';
import type { NativeProgram } from 'dragon';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels, glyphLines } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import type { Rgba } from './paint-model.ts';
import { boxes, modelAt, over } from './paint-model.ts';

const FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'bg-clip-text')?.fixtures ?? []).filter((f) => f.kind === 'layout');
const FILL_BOXES = ['fill-a', 'fill-b', 'fill-c', 'fill-d', 'fill-e', 'fill-f', 'fill-g'];

type Fault = 'none' | 'unfilled' | 'boxed';

const colourOf = (p: NativeProgram, id: string, kind: 'background-color' | 'text-color'): Rgba => {
  const w = p.nodes.find((n) => n.id === id)?.writes.find((x) => x.kind === kind);
  if (w === undefined || (w.kind !== 'background-color' && w.kind !== 'text-color')) throw new Error(`${id}: no ${kind} write`);
  return [w.color.r, w.color.g, w.color.b, w.color.alpha];
};

/** The program as a fault paints it: the fill boxes' glyphs transparent, or their colour on the box as well. */
function faulted(p: NativeProgram, fault: Fault): NativeProgram {
  if (fault === 'none') return p;
  const fills = new Map(FILL_BOXES.map((id) => [id, colourOf(p, `${id}:text0`, 'text-color')]));
  return {
    ...p,
    nodes: p.nodes.map((n) => {
      const box = fills.get(n.id);
      const owner = n.kind === 'text' ? fills.get(n.id.slice(0, n.id.lastIndexOf(':'))) : undefined;
      if (fault === 'unfilled' && owner !== undefined) return { ...n, writes: n.writes.map((w) => (w.kind === 'text-color' ? { ...w, color: { r: 0, g: 0, b: 0, alpha: 0 } } : w)) };
      if (fault === 'boxed' && box !== undefined) return { ...n, writes: n.writes.map((w) => (w.kind === 'background-color' ? { ...w, color: { r: box[0], g: box[1], b: box[2], alpha: box[3] } } : w)) };
      return n;
    }),
  };
}

type Verdict = { readonly problems: string[]; readonly fillGlyphPoints: number; readonly fillBoxPoints: number };

/** The model's verdict on one case at every DPR against the committed Chrome PNGs. */
function judge(caseId: string, program: NativeProgram, viewport: { width: number; height: number }, fault: Fault): Verdict {
  const p = faulted(program, fault);
  const problems: string[] = [];
  let fillGlyphPoints = 0;
  let fillBoxPoints = 0;
  for (const dpr of DPRS) {
    const chrome = committedPixels(caseId, dpr);
    if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
    const all = boxes(p, viewport, dpr);
    const fillRects = all.filter((b) => FILL_BOXES.includes(b.node.id));
    const inks = glyphLines(p, viewport, dpr).flatMap((l) => l.glyphs.map((g) => ({ g, text: l.id.slice(0, l.id.lastIndexOf(':line')) })));
    for (const pt of casePoints(program, viewport, dpr)) {
      if (ruleKind(pt.rule) === 'edge') continue;
      const backdrop = modelAt(all, pt.x, pt.y);
      const ink = inks.find(({ g }) => pt.x >= g.left && pt.x + 1 <= g.right && pt.y >= g.top && pt.y + 1 <= g.bottom);
      const want: Rgba = ink !== undefined ? over(backdrop, colourOf(p, ink.text, 'text-color')) : backdrop;
      const inFill = fillRects.some((b) => pt.x >= b.l && pt.x + 1 <= b.r && pt.y >= b.t && pt.y + 1 <= b.b);
      if (inFill && ink !== undefined) fillGlyphPoints++;
      if (inFill && ink === undefined) fillBoxPoints++;
      const i = (pt.y * chrome.width + pt.x) * 4;
      const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
      if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
    }
  }
  return { problems, fillGlyphPoints, fillBoxPoints };
}

describe('BG2 background-clip: text: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the bg-clip-text fixture in both directions', () => {
    expect(FIXTURES.map((f) => f.id)).toEqual(['bg-clip-text']);
  });
  for (const spec of FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}; the unfilled and boxed faults are caught`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        for (const p of [programs.programs.uikit, programs.programs['android-views']]) {
          for (const id of FILL_BOXES) expect(colourOf(p, id, 'background-color'), id).toEqual([0, 0, 0, 0]);
          const v = judge(c.id, p, c.environment.viewport, 'none');
          expect(v.problems).toEqual([]);
          expect(v.fillGlyphPoints, 'glyph points of the fill boxes').toBeGreaterThan(0);
          expect(v.fillBoxPoints, 'points of the fill boxes off their glyphs').toBeGreaterThan(0);
          for (const fault of ['unfilled', 'boxed'] as const) expect(judge(c.id, p, c.environment.viewport, fault).problems.length, fault).toBeGreaterThan(0);
        }
      });
    }
  }
});
