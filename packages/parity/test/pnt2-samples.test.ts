// PNT2: the sample points of transformed boxes (paint-samples/transform.ts) against Chrome's committed pixels. Every point of a
// transformed subtree is a base point mapped through the device matrix and kept clear of every transformed edge; no base point of
// a transformed subtree and no base edge scanline it moves survives. On Chrome's PNG at every device DPR, each mapped interior
// point shows its box's background colour, each border point its side's colour and each glyph point its text colour, so the mapping is Chrome's before a device
// runs; with the origin planted away (0 0 for every transform) some mapped point lands on another colour.
import { describe, expect, it } from 'vitest';
import type { NativeProgram } from 'dragon';
import { DPRS } from '../src/dpr.ts';
import { nativeCases } from '../src/native-host.ts';
import { casePoints, committedPixels, glyphLines } from '../src/pixel-reference.ts';
import { withPaintSamples } from '../src/paint-samples/registry.ts';
import { ruleOwner, TRANSFORM_CLEARANCE_DEVICE_PX, withoutTransforms } from '../src/paint-samples/transform.ts';
import type { SampleBox } from '../src/samples.ts';
import { CLEAR_SUFFIX, generateSamples, ruleKind } from '../src/samples.ts';
import { transformCases } from '../src/transform-capture.ts';

type Rgba = readonly [number, number, number, number];

const SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * The colour Chrome must show at a point of a transformed subtree: a box's background (interior), a solid border side's colour
 * (border), or a glyph's text colour (glyph); null for other rules and for paint that is not opaque.
 */
function wanted(p: NativeProgram, rule: string): Rgba | null {
  const kind = ruleKind(rule);
  const owner = ruleOwner(rule);
  const id = kind === 'glyph' ? owner.replace(/:line\d+$/, '') : owner;
  const n = p.nodes.find((x) => x.id === id);
  if (n === undefined) return null;
  let c: { r: number; g: number; b: number; alpha: number } | undefined;
  if (kind === 'border') {
    const bare = rule.endsWith(CLEAR_SUFFIX) ? rule.slice(0, -CLEAR_SUFFIX.length) : rule;
    const side = SIDES.indexOf(bare.slice(bare.lastIndexOf(':') + 1));
    const styles = n.writes.find((x) => x.kind === 'border-styles');
    const colors = n.writes.find((x) => x.kind === 'border-colors');
    if (styles?.kind !== 'border-styles' || colors?.kind !== 'border-colors' || styles.styles[side] !== 'solid') return null;
    c = colors.colors[side];
  } else {
    const w = n.writes.find((x) => x.kind === (kind === 'glyph' ? 'text-color' : kind === 'interior' ? 'background-color' : ''));
    if (w === undefined || (w.kind !== 'text-color' && w.kind !== 'background-color')) return null;
    c = w.color;
  }
  if (c === undefined) return null;
  // A transparent box shows what is beneath it; only opaque paint is a colour the point must show.
  return c.alpha === 255 ? [c.r, c.g, c.b, c.alpha] : null;
}

function transformedIds(p: NativeProgram): Set<string> {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  const inside = (id: string | null): boolean => {
    for (let at = id; at !== null; at = byId.get(at)?.parent ?? null) {
      const f = byId.get(at)?.facts['transform'] as { ops: readonly unknown[] } | undefined;
      if (f !== undefined && f.ops.length > 0) return true;
    }
    return false;
  };
  for (const n of p.nodes) if (inside(n.id)) out.add(n.id);
  return out;
}

/** The opaque background colours of a node's descendants, as JSON RGBA arrays. */
function descendantColors(p: NativeProgram, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (parent: string): void => {
    for (const n of p.nodes.filter((x) => x.parent === parent)) {
      const w = n.writes.find((x) => x.kind === 'background-color');
      if (w?.kind === 'background-color' && w.color.alpha === 255) out.add(JSON.stringify([w.color.r, w.color.g, w.color.b, 255]));
      walk(n.id);
    }
  };
  walk(id);
  return out;
}

/**
 * The line whose glyph box holds a box's base interior point, when the text is the box's own: the base sampler keeps an interior
 * point clear of every glyph box edge, not off the glyphs (T093 ruling A), so such a point shows the text colour.
 */
function glyphUnder(p: NativeProgram, owner: string, at: { readonly x: number; readonly y: number }, lines: ReturnType<typeof glyphLines>): string | null {
  const parent = new Map(p.nodes.map((n) => [n.id, n.parent]));
  for (const l of lines) {
    if (parent.get(l.id.replace(/:line\d+$/, '')) !== owner) continue;
    if (l.glyphs.some((g) => at.x >= g.left && at.x + 1 <= g.right && at.y >= g.top && at.y + 1 <= g.bottom)) return l.id;
  }
  return null;
}

/** The program with every transform origin planted at the border box's top left. */
function originIgnored(p: NativeProgram): NativeProgram {
  const zero = { kind: 'px', px: 0, percent: 0 };
  return { ...p, nodes: p.nodes.map((n) => (n.facts['transform'] === undefined ? n : { ...n, facts: { ...n.facts, transform: { ...(n.facts['transform'] as object), origin: { x: zero, y: zero } } } })) };
}

/** Every mapped interior, border and glyph point of the transforms cases whose colour differs from Chrome's, and how many were compared. */
async function mismatches(plant: (p: NativeProgram) => NativeProgram): Promise<{ readonly checked: number; readonly problems: readonly string[] }> {
  const ids = new Set((await transformCases()).map((c) => c.id));
  let checked = 0;
  const problems: string[] = [];
  for (const n of nativeCases().filter((c) => ids.has(c.case.id))) {
    const p = plant(n.programs.uikit);
    const moved = transformedIds(p);
    for (const dpr of DPRS) {
      const png = committedPixels(n.case.id, dpr);
      if (png === null) throw new Error(`${n.case.id}@${dpr}: no committed Chrome pixels`);
      const points = casePoints(p, n.case.environment.viewport, dpr);
      const base = casePoints(withoutTransforms(p), n.case.environment.viewport, dpr);
      const lines = glyphLines(p, n.case.environment.viewport, dpr);
      const owned = points.filter((x) => {
        const o = ruleOwner(x.rule);
        return moved.has(ruleKind(x.rule) === 'glyph' ? o.replace(/:line\d+$/, '') : o);
      });
      if (moved.size > 0 && owned.length === 0) problems.push(`${n.case.id}@${dpr}: no point on a transformed box`);
      for (const x of owned) {
        expect(ruleKind(x.rule), x.rule).not.toBe('edge');
        if (ruleKind(x.rule) !== 'interior' && ruleKind(x.rule) !== 'glyph') continue;
        const at = ruleKind(x.rule) === 'interior' ? base.find((q) => q.rule === x.rule) : undefined;
        const line = at === undefined ? null : glyphUnder(p, ruleOwner(x.rule), at, lines);
        const want = wanted(p, line === null ? x.rule : `glyph:${line}:0`);
        if (want === null) continue;
        const i = (x.y * png.width + x.x) * 4;
        const got = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
        // A box's own children paint over it (its base interior point may sit under a child, as the demo's record centre does).
        if (ruleKind(x.rule) === 'interior' && descendantColors(p, ruleOwner(x.rule)).has(JSON.stringify(got))) continue;
        checked++;
        if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${n.case.id}@${dpr} ${x.rule} at ${x.x},${x.y}: Chrome ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      }
    }
  }
  return { checked, problems };
}

describe('PNT2: the transform sample filter on a rotated box', () => {
  const size = { width: 200, height: 200 };
  const outer: SampleBox = { id: 'p', left: 0, top: 0, right: 200, bottom: 200, border: { top: 0, right: 0, bottom: 0, left: 0 }, radius: 0, clips: false };
  const box: SampleBox = { id: 'b', left: 60, top: 60, right: 140, bottom: 120, border: { top: 4, right: 4, bottom: 4, left: 4 }, radius: 0, clips: true };
  const px = { kind: 'px', px: 0, percent: 0 } as const;
  const node = (id: string, parent: string | null, facts: Record<string, unknown>) => ({ id, parent, host: parent, kind: 'element' as const, native: 'DragonBoxView', clips: false, text: null, writes: [], facts });
  const program = (deg: number): NativeProgram => ({ version: 'v', backend: 'uikit', root: {} as never, rootFontSize: 16, nodes: [node('p', null, {}), node('b', 'p', { transform: { ops: [{ fn: 'rotate', x: px, y: px, angle: deg, sx: 1, sy: 1 }], origin: { x: { kind: 'percent', px: 0, percent: 50 }, y: { kind: 'percent', px: 0, percent: 50 } }, willChange: [] } })] });
  const points = (deg: number) => {
    const base = generateSamples([outer, box], size);
    return { base, out: withPaintSamples({ program: program(deg), viewport: { width: 100, height: 100 }, dpr: 2, size, boxes: [outer, box], base }) };
  };
  it('drops the box\'s edge scanlines, replaces its points by rotated ones, and keeps the others clear of its edges', () => {
    const { base, out } = points(90);
    expect(out.filter((p) => p.rule.startsWith('edge:b:'))).toEqual([]);
    expect(base.some((p) => p.rule.startsWith('edge:b:'))).toBe(true);
    // rotate(90deg) about the centre (100, 90) turns the pixel centre (100.5, 90.5) to (100 - 0.5, 90 + 0.5): pixel (99, 90).
    expect(base.find((p) => p.rule === 'interior:b')).toEqual({ x: 100, y: 90, rule: 'interior:b' });
    expect(out.find((p) => p.rule === 'interior:b')).toEqual({ x: 99, y: 90, rule: 'interior:b' });
    // The parent's interior point is covered by the rotated box but clear of its edges, so it stays.
    expect(out.filter((p) => p.rule === 'interior:p')).toEqual(base.filter((p) => p.rule === 'interior:p'));
    // Every kept point is clear of the rotated box's edges: its border band's outer and inner quads.
    const quad = [[70, 50], [130, 50], [130, 130], [70, 130]];
    const inner = [[74, 54], [126, 54], [126, 126], [74, 126]];
    const dist = (x: number, y: number, q: number[][]): number => Math.min(...q.map((a, i) => {
      const b = q[(i + 1) % 4] as number[];
      const [ax, ay, bx, by] = [a[0] as number, a[1] as number, b[0] as number, b[1] as number];
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
    }));
    for (const p of out.filter((x) => !x.rule.startsWith('edge:'))) expect(Math.min(dist(p.x + 0.5, p.y + 0.5, quad), dist(p.x + 0.5, p.y + 0.5, inner)), p.rule).toBeGreaterThanOrEqual(TRANSFORM_CLEARANCE_DEVICE_PX);
  });
  it('changes nothing without a transform', () => {
    const base = generateSamples([outer, box], size);
    const plain: NativeProgram = { ...program(0), nodes: [node('p', null, {}), node('b', 'p', {})] };
    expect(withPaintSamples({ program: plain, viewport: { width: 100, height: 100 }, dpr: 2, size, boxes: [outer, box], base })).toEqual(base);
  });
  it('reads the owner of every rule kind', () => {
    expect(['interior:a/b', 'border:a:b:top', 'clip:x:left', 'edge:x:bottom', 'edge:t:text0:line1:glyph-left', 'glyph:t:text0:line1:12', 'outside:q', 'radius:q:top-left'].map(ruleOwner)).toEqual(['a/b', 'a:b', 'x', 'x', 't:text0:line1', 't:text0:line1', 'q', 'q']);
    // T093: glyph-top and glyph-bottom scanlines, and the rescued pixels of a dropped edge or border rule (CLEAR_SUFFIX).
    expect(['edge:t:text0:line1:glyph-bottom', 'edge:t:text0:line1:glyph-top', 'edge:x:left:clear', 'edge:t:text0:line0:glyph-right:clear', 'border:a:b:top:clear'].map(ruleOwner)).toEqual(['t:text0:line1', 't:text0:line1', 'x', 't:text0:line0', 'a:b']);
    expect(() => ruleOwner('edge:x')).toThrow(/cannot read the owner/);
    expect(() => ruleOwner('border:x:middle')).toThrow(/cannot read the owner/);
  });
});

describe('PNT2: transformed sample points against Chrome', () => {
  it('map every transformed interior, border and glyph point onto its colour in Chrome\'s pixels at every device DPR', async () => {
    const { checked, problems } = await mismatches((p) => p);
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(200);
    console.log(`pnt2-samples: ${checked} mapped interior, border and glyph points equal Chrome's colour`);
  }, 600_000);

  it('see a planted origin: with every origin at the top left, mapped points land on other colours', async () => {
    expect((await mismatches(originIgnored)).problems.length).toBeGreaterThan(0);
  }, 600_000);

  it('keep the clearance rule a sample geometry, not a tolerance: the inset plus half a pixel diagonal', () => {
    expect(TRANSFORM_CLEARANCE_DEVICE_PX).toBeCloseTo(2 + Math.SQRT1_2, 15);
  });
});
