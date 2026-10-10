// T150a visibility on the host: the visibility fixtures' points against the committed Chrome PNGs at every device DPR. The paint
// model of pnt1-radius (paint-model.ts: boxes in tree order, rounded shapes, overflow clips of ancestors, Skia's source-over) skips the
// background and border of a box with a visibility write, as the device's paint gate does, while its clips stay; an Ahem glyph's
// interior point shows the text colour when the text view's element is visible and the backdrop when it is not, as the device's
// text views follow their element (DragonTree.textNode). Every colour and glyph point must equal Chrome exactly. Two model faults
// must each disagree with Chrome somewhere in every case: visibility ignored (the device plant visibility-ignored) and a hidden box's
// whole subtree hidden (visibility-subtree), so the points can see both.
import { describe, expect, it } from 'vitest';
import type { NativeProgram, ProgramNode } from 'dragon';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import type { Rgba } from './paint-model.ts';
import { boxes, modelAt, over } from './paint-model.ts';

const VISIBILITY_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'visibility')?.fixtures ?? []).filter((f) => f.kind === 'layout');

type Fault = 'none' | 'ignored' | 'subtree';

/** The program as a fault paints it: ignored drops every visibility write; subtree gives every descendant of a hidden box one. */
function faulted(p: NativeProgram, fault: Fault): NativeProgram {
  if (fault === 'none') return p;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const own = (n: ProgramNode) => n.writes.find((w) => w.kind === 'visibility');
  const hiddenAbove = (n: ProgramNode): ProgramWriteOf | undefined => {
    for (let a = n.parent === null ? undefined : byId.get(n.parent); a !== undefined; a = a.parent === null ? undefined : byId.get(a.parent)) {
      const w = own(a);
      if (w !== undefined) return w as ProgramWriteOf;
    }
    return undefined;
  };
  const nodes = p.nodes.map((n): ProgramNode => {
    if (fault === 'ignored') return { ...n, writes: n.writes.filter((w) => w.kind !== 'visibility') };
    if (n.kind === 'text' || own(n) !== undefined) return n;
    const above = hiddenAbove(n);
    return above === undefined ? n : { ...n, writes: [...n.writes, { ...above, canvas: false }] };
  });
  return { ...p, nodes };
}
type ProgramWriteOf = ProgramNode['writes'][number] & { readonly kind: 'visibility' };

/** Whether a text node's runs paint: its element (through an anonymous box) has no visibility write. */
function textPaints(p: NativeProgram, textId: string): boolean {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const t = byId.get(textId);
  if (t === undefined || t.kind !== 'text' || t.parent === null) throw new Error(`${textId}: no text node with a parent`);
  let owner = byId.get(t.parent);
  if (owner !== undefined && owner.kind === 'anonymous') owner = owner.parent === null ? undefined : byId.get(owner.parent);
  if (owner === undefined) throw new Error(`${textId}: no element owns the text view`);
  return !owner.writes.some((w) => w.kind === 'visibility');
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

type Verdict = { readonly problems: string[]; readonly hiddenBoxPoints: number; readonly hiddenGlyphPoints: number; readonly visibleGlyphPoints: number };

/** The model's verdict on one case at every DPR against the committed Chrome PNGs. */
function judge(caseId: string, p: NativeProgram, viewport: { width: number; height: number }, fault: Fault): Verdict {
  const model = faulted(p, fault);
  const hiddenIds = new Set(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'visibility')).map((n) => n.id));
  const problems: string[] = [];
  let hiddenBoxPoints = 0;
  let hiddenGlyphPoints = 0;
  let visibleGlyphPoints = 0;
  for (const dpr of DPRS) {
    const chrome = committedPixels(caseId, dpr);
    if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
    const list = boxes(model, viewport, dpr);
    for (const pt of casePoints(p, viewport, dpr)) {
      const kind = ruleKind(pt.rule);
      if (kind === 'edge') continue;
      let want: Rgba;
      if (kind === 'glyph') {
        const text = glyphText(pt.rule);
        const backdrop = modelAt(list, pt.x, pt.y);
        if (textPaints(model, text)) {
          want = over(backdrop, textColour(model, text));
          visibleGlyphPoints++;
        } else {
          want = backdrop;
          hiddenGlyphPoints++;
        }
      } else {
        want = modelAt(list, pt.x, pt.y);
        const id = pt.rule.split(':')[1] ?? '';
        if (hiddenIds.has(id)) hiddenBoxPoints++;
      }
      const i = (pt.y * chrome.width + pt.x) * 4;
      const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
      if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
    }
  }
  return { problems, hiddenBoxPoints, hiddenGlyphPoints, visibleGlyphPoints };
}

describe('T150a visibility: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the five visibility fixtures in both directions', () => {
    expect(VISIBILITY_FIXTURES.map((f) => f.id)).toEqual(['visibility-basic', 'visibility-paint', 'visibility-flex', 'visibility-text', 'visibility-root']);
  });
  for (const spec of VISIBILITY_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}; the ignored and subtree faults are caught`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        for (const p of [programs.programs.uikit, programs.programs['android-views']]) {
          const v = judge(c.id, p, c.environment.viewport, 'none');
          expect(v.problems).toEqual([]);
          expect(v.hiddenBoxPoints, 'points on hidden boxes').toBeGreaterThan(0);
          if (spec.id === 'visibility-text' || spec.id === 'visibility-root') expect(v.hiddenGlyphPoints, 'glyph points of hidden text').toBeGreaterThan(0);
          if (spec.id === 'visibility-text' || spec.id === 'visibility-root' || spec.id === 'visibility-flex') expect(v.visibleGlyphPoints, 'glyph points of visible text inside hidden boxes').toBeGreaterThan(0);
          for (const fault of ['ignored', 'subtree'] as const) expect(judge(c.id, p, c.environment.viewport, fault).problems.length, fault).toBeGreaterThan(0);
        }
      });
    }
  }
});
