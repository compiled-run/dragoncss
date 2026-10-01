// P6a, the host half of the two-stage paint proof (notes/T046-paint-spec.md §2): the dashed and dotted border reference
// (packages/layout/src/paint-dash.ts) against Chrome 145's committed pixels. For every committed case with a box that has a
// visible dashed or dotted side, at every device DPR, each border-band pixel the reference covers wholly or not at all (a crisp
// pixel) must equal Chrome's pixel exactly: the side's colour, or the box's background. Pixels the reference covers in part
// (anti-aliased dash ends and dot rims) are the edge rule's business, and pixels another box paints over are skipped. Each
// planted fault must make crisp pixels differ.
import { describe, expect, it } from 'vitest';
import type { BorderOp, DashFaults, LayoutRect } from '@dragon/layout';
import { borderNeedsSidePainter, borderPaintOps, NO_DASH_FAULTS, snapEdges } from '@dragon/layout';
import type { NativeProgram, ProgramWrite } from 'dragon';
import { borderDevicePx, programInput } from 'dragon';
import { DPRS } from '../src/dpr.ts';
import type { NativeCase } from '../src/native-host.ts';
import { expectedEngine, nativeCases } from '../src/native-host.ts';
import { committedPixels } from '../src/pixel-reference.ts';

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

type Result = { readonly boxes: number; readonly crisp: number; readonly mismatches: readonly string[] };

/** Every dashed or dotted box of a case at a DPR against Chrome's committed PNG. */
function compareCase(nc: NativeCase, dpr: number, faults: DashFaults): Result {
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
  let boxes = 0;
  let crisp = 0;
  const mismatches: string[] = [];
  for (const n of p.nodes) {
    const st = writeOf(p, n.id, 'border-styles');
    const co = writeOf(p, n.id, 'border-colors');
    const b = boxOf.get(n.id);
    if (st === undefined || co === undefined || b === undefined) continue;
    const w = [...(borders.get(n.id) ?? [0, 0, 0, 0])];
    const colors = co.colors.flatMap((c) => [c.r, c.g, c.b, c.alpha]);
    if (!borderNeedsSidePainter(w, st.styles, colors)) continue;
    boxes++;
    const ops = borderPaintOps(b.left, b.top, b.right, b.bottom, w, st.styles, colors, faults);
    const bg = backgroundOf(p, n.id);
    // The element boxes after this one in paint order (its descendants and later boxes) paint over its border; their pixels are
    // skipped. Earlier boxes paint below it, so a border pixel they overlap is still compared.
    const over = p.nodes.slice(p.nodes.indexOf(n) + 1).filter((m) => m.kind !== 'text').flatMap((m) => {
      const o = boxOf.get(m.id);
      return o === undefined ? [] : [o];
    });
    for (let y = b.top; y < b.bottom; y++) {
      for (let x = b.left; x < b.right; x++) {
        const inBand = y < b.top + (w[0] as number) || y >= b.bottom - (w[2] as number) || x < b.left + (w[3] as number) || x >= b.right - (w[1] as number);
        if (!inBand || over.some((o) => x >= o.left && x < o.right && y >= o.top && y < o.bottom)) continue;
        const side = crispSide(ops, x, y);
        if (side === null) continue;
        crisp++;
        const want = side < 0 ? bg : colors.slice(4 * side, 4 * side + 3);
        const k = (y * chrome.width + x) * 4;
        const got = [chrome.data[k], chrome.data[k + 1], chrome.data[k + 2]];
        if (!want.every((v, i) => v === got[i])) mismatches.push(`${nc.case.id}@${dpr} ${n.id} ${x},${y}: reference ${side < 0 ? 'background' : `side ${side}`} [${want.join(',')}], Chrome [${got.join(',')}]`);
      }
    }
  }
  return { boxes, crisp, mismatches };
}

const dashed = nativeCases().filter((nc) =>
  nc.programs.uikit.nodes.some((n) => (n.writes.find((w) => w.kind === 'border-styles') as { styles?: readonly string[] } | undefined)?.styles?.some((s) => s === 'dashed' || s === 'dotted')),
);

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
