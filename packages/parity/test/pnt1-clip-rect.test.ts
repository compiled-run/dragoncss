// MASK-CLIP clip on the host: the clip-rect fixtures' points against the committed Chrome PNGs at every device DPR. The paint model
// of pnt1-radius (paint-model.ts: boxes in tree order, overflow clips of ancestors, Skia's source-over) leaves out a box with an
// empty clip rect write or a clip label write and every box inside it, as the device hides the box view (or draws nothing of it)
// and every view inside it; an Ahem glyph's points show the text colour when its text view sits outside every hidden box. Text sits
// inside one only in clip-rect-sr-only, whose boxes carry it as their accessibility label: there Chrome must paint none of its
// glyph points. Every colour and glyph point must equal Chrome exactly. Two model faults must each disagree with Chrome somewhere in every case: the clip ignored
// (the device plant clip-rect-ignored) and only the box's own paint hidden, its descendants still painting.
import { describe, expect, it } from 'vitest';
import type { NativeProgram, ProgramNode } from 'dragon';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels, glyphLines } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import type { Rgba } from './paint-model.ts';
import { boxes, modelAt, over } from './paint-model.ts';

const CLIP_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'clip-rect')?.fixtures ?? []).filter((f) => f.kind === 'layout');

type Fault = 'none' | 'ignored' | 'own';

/** The ids of the nodes a fault paints nothing of: none ignores the clip; own leaves out only the clipped boxes themselves. */
function hiddenNodes(p: NativeProgram, fault: Fault): Set<string> {
  const cut = new Set(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'clip-rect-empty' || w.kind === 'clip-rect-label')).map((n) => n.id));
  if (fault === 'ignored') return new Set();
  if (fault === 'own') return cut;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const inside = (n: ProgramNode): boolean => {
    for (let a: ProgramNode | undefined = n; a !== undefined; a = a.parent === null ? undefined : byId.get(a.parent)) if (cut.has(a.id)) return true;
    return false;
  };
  return new Set(p.nodes.filter(inside).map((n) => n.id));
}

/** The text colour of a text node's runs. */
function textColour(p: NativeProgram, textId: string): Rgba {
  const w = p.nodes.find((n) => n.id === textId)?.writes.find((x) => x.kind === 'text-color');
  if (w === undefined || w.kind !== 'text-color') throw new Error(`${textId}: no text colour`);
  return [w.color.r, w.color.g, w.color.b, w.color.alpha];
}

/** The text node of a glyph rule glyph:<text id>:line<j>:<k>. */
const glyphText = (rule: string): string => {
  const line = rule.slice('glyph:'.length, rule.lastIndexOf(':'));
  const at = line.lastIndexOf(':line');
  if (at < 0) throw new Error(`${rule}: no line id`);
  return line.slice(0, at);
};

type Verdict = { readonly problems: string[]; readonly cutPoints: number; readonly hiddenGlyphPoints: number; readonly glyphPoints: number };

/** The model's verdict on one case at every DPR against the committed Chrome PNGs. */
function judge(caseId: string, p: NativeProgram, viewport: { width: number; height: number }, fault: Fault): Verdict {
  const hidden = hiddenNodes(p, fault);
  const truth = hiddenNodes(p, 'none');
  const problems: string[] = [];
  let cutPoints = 0;
  let hiddenGlyphPoints = 0;
  let glyphPoints = 0;
  for (const dpr of DPRS) {
    const chrome = committedPixels(caseId, dpr);
    if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
    const list = boxes(p, viewport, dpr).filter((b) => !hidden.has(b.node.id));
    // Each glyph's ink box with its text node: an Ahem glyph's ink fills its box, so a point clear inside one is the text colour.
    const inks = glyphLines(p, viewport, dpr).flatMap((l) => l.glyphs.map((g) => ({ g, text: l.id.slice(0, l.id.lastIndexOf(':line')) })));
    for (const pt of casePoints(p, viewport, dpr)) {
      const kind = ruleKind(pt.rule);
      if (kind === 'edge') continue;
      const backdrop = modelAt(list, pt.x, pt.y);
      // A glyph point is its own glyph's ink unless that text is hidden; then (as at any other point) whatever painted glyph covers
      // it, such as the next line's text under an absolutely positioned box at its static position.
      const own = kind === 'glyph' ? { text: glyphText(pt.rule) } : undefined;
      const ink = own !== undefined && !hidden.has(own.text) ? own : inks.find(({ g, text }) => !hidden.has(text) && pt.x >= g.left && pt.x + 1 <= g.right && pt.y >= g.top && pt.y + 1 <= g.bottom);
      const paints = ink !== undefined && !hidden.has(ink.text);
      const want: Rgba = ink !== undefined && paints ? over(backdrop, textColour(p, ink.text)) : backdrop;
      if (kind === 'glyph') {
        glyphPoints++;
        if (truth.has(glyphText(pt.rule))) hiddenGlyphPoints++;
      } else if (truth.has(pt.rule.split(':')[1] ?? '')) cutPoints++;
      const i = (pt.y * chrome.width + pt.x) * 4;
      const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
      if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
    }
  }
  return { problems, cutPoints, hiddenGlyphPoints, glyphPoints };
}

describe('MASK-CLIP clip: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the three clip-rect fixtures in both directions', () => {
    expect(CLIP_FIXTURES.map((f) => f.id)).toEqual(['clip-rect-basic', 'clip-rect-nested', 'clip-rect-sr-only']);
  });
  for (const spec of CLIP_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}; the ignored and own-only faults are caught`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        for (const p of [programs.programs.uikit, programs.programs['android-views']]) {
          const v = judge(c.id, p, c.environment.viewport, 'none');
          expect(v.problems).toEqual([]);
          expect(v.cutPoints, 'points on clipped boxes and their descendants').toBeGreaterThan(0);
          // Text in a hidden box is lowered only as a clip label, which the sr-only fixture holds; elsewhere none sits in one.
          if (spec.id === 'clip-rect-sr-only') expect(v.hiddenGlyphPoints, 'glyph points of clipped text Chrome must not paint').toBeGreaterThan(0);
          else expect(v.hiddenGlyphPoints, 'glyph points of clipped text').toBe(0);
          if (spec.id !== 'clip-rect-nested') expect(v.glyphPoints - v.hiddenGlyphPoints, 'glyph points of text beside a clipped box').toBeGreaterThan(0);
          for (const fault of ['ignored', 'own'] as const) expect(judge(c.id, p, c.environment.viewport, fault).problems.length, fault).toBeGreaterThan(0);
        }
      });
    }
  }
});
