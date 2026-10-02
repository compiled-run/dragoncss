// P6a, the host half of the two-stage paint proof (notes/T046-paint-spec.md §2): the dashed and dotted border reference
// (packages/layout/src/paint-dash.ts) against Chrome 145's committed pixels. For every committed case with a box that has a
// visible dashed or dotted side, at every device DPR, each border-band pixel the reference covers wholly or not at all (a crisp
// pixel) must equal Chrome's pixel exactly: the side's colour, or the box's background. Pixels the reference covers in part
// (anti-aliased dash ends and dot rims) are the edge rule's business, and pixels another box paints over are skipped. Each
// planted fault must make crisp pixels differ. T116: boxes whose visible sides are all solid use the same reference, and every case
// with a solid side is compared the same way (border-join pins its no-miter corners).
import { describe, expect, it } from 'vitest';
import type { BorderOp, DashFaults, LayoutBox, LayoutRect } from '@dragon/layout';
import { borderNeedsSidePainter, borderPaintOps, NO_DASH_FAULTS, snapEdges } from '@dragon/layout';
import type { NativeProgram, ProgramWrite } from 'dragon';
import { borderDevicePx, programInput } from 'dragon';
import { DPRS } from '../src/dpr.ts';
import type { NativeCase } from '../src/native-host.ts';
import { expectedEngine, nativeCases } from '../src/native-host.ts';
import { committedPixels, glyphLines } from '../src/pixel-reference.ts';

type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
type Pt = readonly [number, number];

/** Whether two convex polygons overlap (separating axis test); touching edges do not overlap. */
function overlaps(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Pt;
      const q = poly[(i + 1) % poly.length] as Pt;
      const nx = q[1] - p[1];
      const ny = p[0] - q[0];
      if (nx === 0 && ny === 0) continue;
      const proj = (xs: readonly Pt[]): [number, number] => {
        const v = xs.map(([x, y]) => x * nx + y * ny);
        return [Math.min(...v), Math.max(...v)];
      };
      const [a0, a1] = proj(a);
      const [b0, b1] = proj(b);
      if (a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9) return false;
    }
  }
  return true;
}

/** Whether point (x, y) is inside a convex polygon (either winding), boundary included. */
function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    const c = (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/** The width of a dot's rim band in device px, each side of its circle. */
const DOT_RIM = 0.5;

const pairs = (pts: readonly number[]): Pt[] => Array.from({ length: pts.length / 2 }, (_, i) => [pts[2 * i] as number, pts[2 * i + 1] as number] as const);

/** How an operation's shape covers pixel [x, x+1) x [y, y+1): wholly, not at all, or in part. */
function cover(o: BorderOp, x: number, y: number): 'full' | 'none' | 'part' {
  const corners: Pt[] = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
  if (o.op === 'dot') {
    const [cx, cy, r] = o.points as [number, number, number];
    // Skia rasters a dot as conics flattened to quads with analytic anti-aliasing, so its rim is not the exact circle: pixels
    // within half a pixel of the circle are the rim, compared by the edge rule, not here.
    if (corners.every(([px, py]) => Math.hypot(px - cx, py - cy) <= r - DOT_RIM)) return 'full';
    const nx = Math.max(x, Math.min(cx, x + 1));
    const ny = Math.max(y, Math.min(cy, y + 1));
    return Math.hypot(nx - cx, ny - cy) >= r + DOT_RIM ? 'none' : 'part';
  }
  const poly = pairs(o.points);
  if (!overlaps(poly, corners)) return 'none';
  return corners.every(([px, py]) => inside(poly, px, py)) ? 'full' : 'part';
}

/** The reference's crisp colour side at a pixel (-1 for none), or null when some operation covers it in part. */
function crispSide(ops: readonly BorderOp[], x: number, y: number): number | null {
  const clips: (readonly BorderOp[])[] = [[]];
  let side = -1;
  for (const o of ops) {
    const top = clips[clips.length - 1] as BorderOp[];
    if (o.op === 'save') clips.push([...top]);
    else if (o.op === 'restore') clips.pop();
    else if (o.op === 'clip') top.push(o);
    else if (o.op === 'begin-layer' || o.op === 'end-layer') return null;
    else {
      const c = cover(o, x, y);
      if (c === 'none') continue;
      const clipped = top.map((k) => cover(k, x, y));
      if (clipped.includes('none')) continue;
      if (c === 'part' || clipped.includes('part')) return null;
      side = o.side;
    }
  }
  return side;
}

const writeOf = <K extends ProgramWrite['kind']>(p: NativeProgram, id: string, kind: K): (ProgramWrite & { kind: K }) | undefined =>
  p.nodes.find((n) => n.id === id)?.writes.find((w) => w.kind === kind) as (ProgramWrite & { kind: K }) | undefined;

/** The opaque background under a box's border: its own background colour or the nearest ancestor's, else the white canvas. */
function backgroundOf(p: NativeProgram, id: string): number[] {
  for (let at: string | null = id; at !== null; at = p.nodes.find((n) => n.id === at)?.parent ?? null) {
    const w = writeOf(p, at, 'background-color');
    if (w !== undefined && w.color.alpha === 255) return [w.color.r, w.color.g, w.color.b];
    if (w !== undefined && w.color.alpha !== 0) throw new Error(`${id}: a translucent background is not modelled here`);
  }
  return [255, 255, 255];
}

/**
 * The boxes in a positioned box's paint layer (CSS2 Appendix E): a box whose position is not static, or any descendant of one.
 * Within the root stacking context they paint after every in-flow box, in tree order among themselves.
 */
export function positionedLayer(root: LayoutBox): Set<string> {
  const out = new Set<string>();
  const walk = (b: LayoutBox, inLayer: boolean): void => {
    const here = inLayer || b.style.position !== 'static';
    if (here) out.add(b.id);
    for (const c of b.children) if (c.kind === 'box') walk(c, here);
  };
  walk(root, false);
  return out;
}

/** Whether box m paints over box n's border: m is in a later paint phase (positioned over in-flow) or the same phase and later in tree order. */
export function paintsOver(order: readonly string[], layer: ReadonlySet<string>, n: string, m: string): boolean {
  const ln = layer.has(n);
  const lm = layer.has(m);
  if (lm !== ln) return lm;
  return order.indexOf(m) > order.indexOf(n);
}

/**
 * Whether the text of box `owner` paints over box n's border (CSS2 Appendix E): in-flow text paints after every in-flow border of
 * the stacking context, so over an in-flow border any text does; over a positioned border only its own text and the text of a box
 * that paintsOver it.
 */
export function textPaintsOver(order: readonly string[], layer: ReadonlySet<string>, n: string, owner: string): boolean {
  if (owner === n || !layer.has(n)) return true;
  return paintsOver(order, layer, n, owner);
}

/** corners: the boxes' outer corner pixels the reference paints crisp in a side colour, as "id:x,y". */
type Result = { readonly boxes: number; readonly crisp: number; readonly mismatches: readonly string[]; readonly corners: readonly string[]; readonly checked: readonly string[] };

/** The pre-T116 comparison: dashed or dotted boxes only, no raster-bounds or glyph skip (the subset proof uses it). */
type Mode = { readonly preT116: boolean };
const CURRENT: Mode = { preT116: false };

/** Every dashed or dotted box of a case at a DPR against Chrome's committed PNG. */
function compareCase(nc: NativeCase, dpr: number, faults: DashFaults, mode: Mode = CURRENT): Result {
  const p = nc.programs.uikit;
  const chrome = committedPixels(nc.case.id, dpr);
  if (chrome === null) throw new Error(`no committed Chrome pixels for ${nc.case.id}@${dpr}`);
  const vp = nc.case.environment.viewport;
  const input = programInput(p, vp, dpr);
  const engine = expectedEngine();
  const out = engine.layout(input, engine.measurer);
  if (out.kind !== 'ok') throw new Error(`the engine refused ${nc.case.id}@${dpr}`);
  const snapped = snapEdges(out.boxes);
  const borders = borderDevicePx(engine, input);
  const boxOf = new Map<string, Box>(out.boxes.map((b: LayoutRect, i) => [b.id, snapped[i] as Box]));
  const ownerOf = new Map(p.nodes.filter((m) => m.kind === 'text').map((m) => [m.id, m.parent]));
  const glyphs = glyphLines(p, vp, dpr).flatMap((l) => {
    const owner = ownerOf.get(l.id.slice(0, l.id.lastIndexOf(':line')));
    if (owner === undefined || owner === null) throw new Error(`${nc.case.id}: no owning box for the text line ${l.id}`);
    return l.glyphs.map((g) => ({ owner, box: { left: Math.floor(g.left) - 1, top: Math.floor(g.top) - 1, right: Math.ceil(g.right) + 1, bottom: Math.ceil(g.bottom) + 1 } }));
  });
  const order = p.nodes.map((m) => m.id);
  const layer = positionedLayer(p.root);
  let boxes = 0;
  let crisp = 0;
  const mismatches: string[] = [];
  const corners: string[] = [];
  const checked: string[] = [];
  for (const n of p.nodes) {
    const st = writeOf(p, n.id, 'border-styles');
    const co = writeOf(p, n.id, 'border-colors');
    const b = boxOf.get(n.id);
    if (st === undefined || co === undefined || b === undefined) continue;
    const w = [...(borders.get(n.id) ?? [0, 0, 0, 0])];
    const colors = co.colors.flatMap((c) => [c.r, c.g, c.b, c.alpha]);
    if (!borderNeedsSidePainter(w, st.styles, colors)) continue;
    if (mode.preT116 && !st.styles.some((s, k) => (s === 'dashed' || s === 'dotted') && (w[k] as number) > 0 && co.colors[k]?.alpha !== 0)) continue;
    boxes++;
    const ops = borderPaintOps(b.left, b.top, b.right, b.bottom, w, st.styles, colors, faults);
    const bg = backgroundOf(p, n.id);
    // The element boxes after this one in paint order (paintsOver: positioned boxes over in-flow ones, then tree order) paint over
    // its border; their pixels are skipped. Boxes before it in paint order paint below it, so a border pixel they overlap is compared.
    // The pre-T116 comparison keeps master's tree-order rule, so the subset proof measures everything this file changed.
    const hides = (m: string): boolean => (mode.preT116 ? order.indexOf(m) > order.indexOf(n.id) : paintsOver(order, layer, n.id, m));
    const over = p.nodes.filter((m) => m.kind !== 'text' && m.id !== n.id && hides(m.id)).flatMap((m) => {
      const o = boxOf.get(m.id);
      return o === undefined ? [] : [o];
    });
    // Glyphs that paint over this border (textPaintsOver) hide it too (text that overflows its line box), with a device px of
    // anti-aliasing around each glyph box; text painted below a positioned border is compared.
    if (!mode.preT116) for (const g of glyphs) if (textPaintsOver(order, layer, n.id, g.owner)) over.push(g.box);
    for (let y = b.top; y < b.bottom; y++) {
      for (let x = b.left; x < b.right; x++) {
        const inBand = y < b.top + (w[0] as number) || y >= b.bottom - (w[2] as number) || x < b.left + (w[3] as number) || x >= b.right - (w[1] as number);
        // Pixels outside Chrome's raster (a box past the viewport) are not painted.
        if (!mode.preT116 && (x < 0 || y < 0 || x >= chrome.width || y >= chrome.height)) continue;
        if (!inBand || over.some((o) => x >= o.left && x < o.right && y >= o.top && y < o.bottom)) continue;
        const side = crispSide(ops, x, y);
        if (side === null) continue;
        crisp++;
        checked.push(`${n.id}:${x},${y}`);
        if (side >= 0 && (x === b.left || x === b.right - 1) && (y === b.top || y === b.bottom - 1)) corners.push(`${n.id}:${x},${y}`);
        const want = side < 0 ? bg : colors.slice(4 * side, 4 * side + 3);
        const k = (y * chrome.width + x) * 4;
        const got = [chrome.data[k], chrome.data[k + 1], chrome.data[k + 2]];
        if (!want.every((v, i) => v === got[i])) mismatches.push(`${nc.case.id}@${dpr} ${n.id} ${x},${y}: reference ${side < 0 ? 'background' : `side ${side}`} [${want.join(',')}], Chrome [${got.join(',')}]`);
      }
    }
  }
  return { boxes, crisp, mismatches, corners, checked };
}

const withStyle = (ok: (s: string) => boolean): NativeCase[] =>
  nativeCases().filter((nc) => nc.programs.uikit.nodes.some((n) => (n.writes.find((w) => w.kind === 'border-styles') as { styles?: readonly string[] } | undefined)?.styles?.some(ok)));
const dashed = withStyle((s) => s === 'dashed' || s === 'dotted');
// T116: boxes whose visible sides are all solid are drawn by the same reference; every case with a solid side is compared.
const solid = withStyle((s) => s === 'solid').filter((nc) => !dashed.includes(nc));

describe('the oracle\'s paint order (which boxes hide a border pixel)', () => {
  it('puts positioned boxes and their descendants over in-flow ones, orders each phase by tree order, and puts in-flow text over every in-flow border', () => {
    const order = ['c2', 'b5', 'c3', 'd3', 'c4'];
    const layer = new Set(['b5', 'd3']);
    // An earlier positioned box paints over a later in-flow border (b5 over c3); an earlier in-flow box does not (c2 under c3).
    expect(paintsOver(order, layer, 'c3', 'b5')).toBe(true);
    expect(paintsOver(order, layer, 'c3', 'c2')).toBe(false);
    expect(paintsOver(order, layer, 'c3', 'c4')).toBe(true);
    // A positioned border is under later positioned boxes only, never under an in-flow box.
    expect(paintsOver(order, layer, 'b5', 'd3')).toBe(true);
    expect(paintsOver(order, layer, 'd3', 'b5')).toBe(false);
    expect(paintsOver(order, layer, 'b5', 'c4')).toBe(false);
    const p = nativeCases().find((c) => c.case.id === 'position-relative-percent')?.programs.uikit;
    if (p === undefined) throw new Error('no position-relative-percent case');
    // Over an in-flow border every text paints; over a positioned border its own text and that of boxes painting over it only.
    expect(textPaintsOver(order, layer, 'c3', 'c2')).toBe(true);
    expect(textPaintsOver(order, layer, 'c3', 'b5')).toBe(true);
    expect(textPaintsOver(order, layer, 'b5', 'b5')).toBe(true);
    expect(textPaintsOver(order, layer, 'b5', 'd3')).toBe(true);
    expect(textPaintsOver(order, layer, 'b5', 'c4')).toBe(false);
    expect(textPaintsOver(order, layer, 'd3', 'b5')).toBe(false);
    expect([...positionedLayer(p.root)].sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'b4', 'b5', 'd1', 'd2', 'd3', 'e1', 'e2']);
  });
});

describe('the dash reference against Chrome 145 (crisp border pixels, channel delta 0)', () => {
  it('covers the border-paint fixtures and every earlier case with a dashed or dotted side', () => {
    expect(dashed.map((nc) => nc.case.id)).toEqual(expect.arrayContaining(['border-dash-fit', 'border-dot-fit', 'color-border-sides', 'logical-border', 'logical-border-rtl', 'css-wide-keywords']));
  });
  for (const nc of dashed) {
    it(`${nc.case.id}: every crisp border pixel equals Chrome at DPR ${DPRS.join(', ')}`, () => {
      let crisp = 0;
      const bad: string[] = [];
      for (const dpr of DPRS) {
        const r = compareCase(nc, dpr, NO_DASH_FAULTS);
        crisp += r.crisp;
        bad.push(...r.mismatches);
      }
      expect(bad.slice(0, 40), `${bad.length} mismatches`).toEqual([]);
      expect(crisp).toBeGreaterThan(0);
    });
  }
});

describe('planted dash faults fail the Chrome comparison', () => {
  for (const [name, faults] of [['dash-phase-1', { phase1: true, gapUnfitted: false }], ['dash-gap-unfitted', { phase1: false, gapUnfitted: true }]] as const) {
    it(`${name}: crisp pixels differ at every DPR`, () => {
      for (const dpr of DPRS) {
        const bad = dashed.filter((nc) => nc.case.id.startsWith('border-')).reduce((n, nc) => n + compareCase(nc, dpr, faults).mismatches.length, 0);
        expect(bad, `DPR ${dpr}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('the solid border reference against Chrome 145 (T116: same-colour sides join with no miter)', () => {
  it('covers the border-join fixture and the earlier solid-border cases', () => {
    expect(solid.map((nc) => nc.case.id)).toEqual(expect.arrayContaining(['border-join', 'tree-projected-text#3']));
  });
  // A case's solid boxes may all be covered (children, glyphs, translucent layers); the border-join fixture must not be.
  for (const nc of solid) {
    it(`${nc.case.id}: every crisp border pixel equals Chrome at DPR ${DPRS.join(', ')}`, () => {
      const bad: string[] = [];
      for (const dpr of DPRS) bad.push(...compareCase(nc, dpr, NO_DASH_FAULTS).mismatches);
      expect(bad.slice(0, 40), `${bad.length} mismatches`).toEqual([]);
    });
  }
  it('border-join: every box is drawn by the reference and its corners are crisp and solid at every DPR', () => {
    const nc = solid.find((c) => c.case.id === 'border-join');
    if (nc === undefined) throw new Error('no border-join case');
    for (const dpr of DPRS) {
      const r = compareCase(nc, dpr, NO_DASH_FAULTS);
      expect(r.boxes, `DPR ${dpr}`).toBe(8);
      expect(r.crisp, `DPR ${dpr}`).toBeGreaterThan(0);
      expect(r.mismatches).toEqual([]);
      // Same-colour opaque corners (no miter): all four outer corner pixels are crisp; the translucent box draws in a layer.
      // Different colours meet on an anti-aliased soft miter, so those corners are not crisp.
      const count = (id: string): number => r.corners.filter((c) => c.startsWith(`${id}:`)).length;
      expect(Object.fromEntries(['all4', 'all1', 'frac', 'two', 'three', 'cols', 'uneven', 'alpha'].map((id) => [id, count(id)])), `DPR ${dpr}`).toEqual({ all4: 4, all1: 4, frac: 4, two: 3, three: 2, cols: 0, uneven: 4, alpha: 0 });
    }
  });
});

describe('the T116 skips drop no pixel the pre-T116 comparison checked', () => {
  // The pre-T116 test checked dashed or dotted boxes only, without the raster-bounds and glyph skips; every pixel it checked must
  // still be checked (the new routing only adds solid boxes).
  for (const nc of dashed) {
    it(`${nc.case.id}: the pre-T116 checked pixels are a subset at every DPR`, () => {
      for (const dpr of DPRS) {
        const now = new Set(compareCase(nc, dpr, NO_DASH_FAULTS).checked);
        const before = compareCase(nc, dpr, NO_DASH_FAULTS, { preT116: true }).checked;
        expect(before.length, `${nc.case.id}@${dpr}`).toBeGreaterThan(0);
        expect(before.filter((k) => !now.has(k)).slice(0, 20), `${nc.case.id}@${dpr}`).toEqual([]);
      }
    });
  }
});
