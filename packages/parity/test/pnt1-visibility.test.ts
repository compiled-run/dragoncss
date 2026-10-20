// T150a visibility on the host: the visibility fixtures' points against the committed Chrome PNGs at every device DPR. The paint
// model of pnt1-radius (paint-model.ts: boxes in tree order, rounded shapes, overflow clips of ancestors, Skia's source-over) skips the
// background and border of a box with a visibility write, as the device's paint gate does, while its clips stay; an Ahem glyph's
// interior point (and any other point inside an Ahem glyph's ink box) shows the text colour when the text view's element is visible and
// the backdrop when it is not, as the device's
// text views follow their element (DragonTree.textNode). Outlines paint last, as in pnt1-outline (outline-model.ts); a box that is
// not visible has no outline or box-shadow write, and its visible descendants keep theirs. Every colour and glyph point must equal
// Chrome exactly. Two model faults must each disagree with Chrome somewhere in every case: visibility ignored (the device plant
// visibility-ignored) and a hidden box's whole subtree hidden (visibility-subtree), so the points can see both. In visibility-outline,
// two more must: the hidden boxes' own outlines painted, and their own spread-only box-shadows painted, each from the values Chrome
// computes for them (the committed capture), so the points see the outline and the shadow Chrome leaves out.
import { describe, expect, it } from 'vitest';
import type { NativeProgram, ProgramNode } from 'dragon';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { committedAuthored } from '../src/committed.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels, glyphLines } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import type { Box, Rgba } from './paint-model.ts';
import { boxes, modelAt, over } from './paint-model.ts';
import type { Rings } from './outline-model.ts';
import { boxOutline, outlines, ringsOver } from './outline-model.ts';

const VISIBILITY_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'visibility')?.fixtures ?? []).filter((f) => f.kind === 'layout');

type Fault = 'none' | 'ignored' | 'subtree' | 'outline' | 'shadow';

type Own = { readonly outline: { readonly style: 'solid' | 'double'; readonly width: number; readonly offset: number; readonly color: Rgba } | null; readonly spread: { readonly px: number; readonly color: Rgba } | null };

const px = (v: string | undefined, what: string): number => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v ?? '');
  if (m === null) throw new Error(`${what}: ${JSON.stringify(v)} is not a px length`);
  return Number(m[1]);
};
const rgb = (v: string | undefined, what: string): Rgba => {
  const m = /^rgba?\((\d+), (\d+), (\d+)(?:, (0|1|0?\.\d+))?\)$/.exec(v ?? '');
  if (m === null) throw new Error(`${what}: ${JSON.stringify(v)} is not an rgb() colour`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 255 : Math.round(Number(m[4]) * 255)];
};

/** The outline and outer spread-only box-shadow Chrome computes for each element (the committed capture), which a hidden box would paint if visibility were ignored. */
async function chromeOwn(caseId: string, ids: ReadonlySet<string>): Promise<Map<string, Own>> {
  const capture = await committedAuthored({ id: caseId } as never);
  const out = new Map<string, Own>();
  for (const id of ids) {
    const c = capture.nodes.find((n) => n.id === id && n.kind === 'element')?.computed;
    if (c === null || c === undefined) throw new Error(`${caseId}: no computed values for ${id}`);
    const style = c['outline-style'];
    const outline: Own['outline'] = style === 'none' ? null : style === 'solid' || style === 'double' ? { style, width: px(c['outline-width'], `${id} outline-width`), offset: px(c['outline-offset'], `${id} outline-offset`), color: rgb(c['outline-color'], `${id} outline-color`) } : null;
    if (style !== 'none' && outline === null) throw new Error(`${caseId}: ${id} has outline-style ${style}, which the fault does not model`);
    const shadow = c['box-shadow'];
    let spread: Own['spread'] = null;
    if (shadow !== 'none') {
      const m = /^(rgba?\([^)]*\)) 0px 0px 0px (\d+(?:\.\d+)?)px$/.exec(shadow ?? '');
      if (m === null) throw new Error(`${caseId}: ${id} has box-shadow ${JSON.stringify(shadow)}; the fault models one outer spread-only shadow`);
      spread = { px: Number(m[2]), color: rgb(m[1], `${id} box-shadow colour`) };
    }
    out.set(id, { outline, spread });
  }
  return out;
}

/** The colour at (x, y) with the hidden boxes' own spread shadows painted, each at its box's place in tree order (outside its border box, under every later box). */
function shadowOver(colour: Rgba, list: readonly Box[], own: ReadonlyMap<string, Own>, dpr: number, x: number, y: number): Rgba {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const inside = (b: Box, d: number): boolean => cx >= b.l - d && cx < b.r + d && cy >= b.t - d && cy < b.b + d;
  let out = colour;
  list.forEach((b, i) => {
    const s = own.get(b.node.id)?.spread;
    if (s === undefined || s === null) return;
    if (b.radii !== null) throw new Error(`${b.node.id}: the shadow fault models square boxes only`);
    if (!inside(b, s.px * dpr) || inside(b, 0) || list.slice(i + 1).some((later) => inside(later, 0))) return;
    out = over(out, s.color);
  });
  return out;
}

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

type Verdict = { readonly problems: string[]; readonly hiddenBoxPoints: number; readonly hiddenGlyphPoints: number; readonly visibleGlyphPoints: number; readonly outlinePoints: number };

/** The model's verdict on one case at every DPR against the committed Chrome PNGs. */
function judge(caseId: string, p: NativeProgram, viewport: { width: number; height: number }, fault: Fault, own: ReadonlyMap<string, Own> = new Map()): Verdict {
  const model = faulted(p, fault);
  const hiddenIds = new Set(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'visibility')).map((n) => n.id));
  const problems: string[] = [];
  let hiddenBoxPoints = 0;
  let hiddenGlyphPoints = 0;
  let visibleGlyphPoints = 0;
  let outlinePoints = 0;
  for (const dpr of DPRS) {
    const chrome = committedPixels(caseId, dpr);
    if (chrome === null) throw new Error(`${caseId}@${dpr}: no committed Chrome PNG`);
    const list = boxes(model, viewport, dpr);
    const rings: Rings[] = outlines(model, list, dpr, 0);
    if (fault === 'outline') {
      for (const b of list) {
        const o = own.get(b.node.id)?.outline;
        if (o !== undefined && o !== null && hiddenIds.has(b.node.id)) rings.push(boxOutline(b, o.style, o.width, o.offset, o.color, dpr));
      }
    }
    // Each glyph's ink box with its text node: an Ahem glyph's ink fills its box, so a point clear inside one is the text colour.
    const inks = glyphLines(p, viewport, dpr).flatMap((l) => l.glyphs.map((g) => ({ g, text: l.id.slice(0, l.id.lastIndexOf(':line')) })));
    for (const pt of casePoints(p, viewport, dpr)) {
      const kind = ruleKind(pt.rule);
      if (kind === 'edge') continue;
      const boxesAt = modelAt(list, pt.x, pt.y);
      const backdrop = fault === 'shadow' ? shadowOver(boxesAt, list, own, dpr, pt.x, pt.y) : boxesAt;
      const ink = kind === 'glyph' ? { text: glyphText(pt.rule) } : inks.find(({ g }) => pt.x >= g.left && pt.x + 1 <= g.right && pt.y >= g.top && pt.y + 1 <= g.bottom);
      const paints = ink !== undefined && textPaints(model, ink.text);
      const want: Rgba = ringsOver(ink !== undefined && paints ? over(backdrop, textColour(model, ink.text)) : backdrop, rings, pt.x, pt.y);
      if (pt.rule.includes(':outline-')) outlinePoints++;
      if (kind === 'glyph') {
        if (paints) visibleGlyphPoints++;
        else hiddenGlyphPoints++;
      } else {
        const id = pt.rule.split(':')[1] ?? '';
        if (hiddenIds.has(id)) hiddenBoxPoints++;
      }
      const i = (pt.y * chrome.width + pt.x) * 4;
      const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
      if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
    }
  }
  return { problems, hiddenBoxPoints, hiddenGlyphPoints, visibleGlyphPoints, outlinePoints };
}

describe('T150a visibility: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the six visibility fixtures in both directions', () => {
    expect(VISIBILITY_FIXTURES.map((f) => f.id)).toEqual(['visibility-basic', 'visibility-paint', 'visibility-flex', 'visibility-text', 'visibility-root', 'visibility-outline']);
  });
  for (const spec of VISIBILITY_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}; the ignored and subtree faults are caught`, async () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        for (const p of [programs.programs.uikit, programs.programs['android-views']]) {
          const v = judge(c.id, p, c.environment.viewport, 'none');
          expect(v.problems).toEqual([]);
          expect(v.hiddenBoxPoints, 'points on hidden boxes').toBeGreaterThan(0);
          if (spec.id === 'visibility-text' || spec.id === 'visibility-root') expect(v.hiddenGlyphPoints, 'glyph points of hidden text').toBeGreaterThan(0);
          if (spec.id === 'visibility-text' || spec.id === 'visibility-root' || spec.id === 'visibility-flex') expect(v.visibleGlyphPoints, 'glyph points of visible text inside hidden boxes').toBeGreaterThan(0);
          for (const fault of ['ignored', 'subtree'] as const) expect(judge(c.id, p, c.environment.viewport, fault).problems.length, fault).toBeGreaterThan(0);
          if (spec.id === 'visibility-outline') {
            // Chrome paints no outline or box-shadow for a hidden box; the hidden boxes have neither write, and their visible children's outlines paint.
            const hidden = new Set(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'visibility')).map((n) => n.id));
            expect(p.nodes.filter((n) => hidden.has(n.id) && n.writes.some((w) => w.kind === 'outline' || w.kind === 'box-shadow')).map((n) => n.id)).toEqual([]);
            expect(v.outlinePoints, 'outline points of visible children').toBeGreaterThan(0);
            const own = await chromeOwn(c.id, hidden);
            expect([...own].filter(([, o]) => o.outline !== null).map(([id]) => id).sort()).toEqual(['hid-dbl', 'hid-inh', 'hid-ring']);
            expect([...own].filter(([, o]) => o.spread !== null).map(([id]) => id).sort()).toEqual(['hid-dbl', 'hid-inh', 'hid-ring']);
            for (const fault of ['outline', 'shadow'] as const) expect(judge(c.id, p, c.environment.viewport, fault, own).problems.length, fault).toBeGreaterThan(0);
          }
        }
      });
    }
  }
});
