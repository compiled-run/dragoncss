// PNT2 (notes/T046-paint-spec.md §2): the sample points of transformed boxes. The base points (samples.ts) sit on the untransformed
// geometry, so the base points of every node in a transformed subtree are replaced by the same points mapped through the device
// matrix (paint-transform.ts at the box size, each transformed ancestor's T(origin) · functions · T(-origin) in device px), kept
// only where they stay clear of every transformed edge. Edge scanlines of transformed subtrees are dropped (the content quads prove
// those edges, pnt2-quads.test.ts), and so are base points of other nodes that a transformed edge now crosses or comes near.
import type { Matrix2D, TransformOp, TransformOrigin, Trig } from '@dragon/layout';
import { mapPoint, paintTransformMatrix } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { glyphLines } from '../pixel-reference.ts';
import type { SampleBox, SamplePoint } from '../samples.ts';
import { CLEAR_SUFFIX, ruleKind, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

const TRIG: Trig = { sin: Math.sin, cos: Math.cos };

/** The transform facts the lowering publishes (dragon lower/paint/transform.ts TransformFacts). */
type Facts = { readonly ops: readonly TransformOp[]; readonly origin: TransformOrigin };

type Point = { readonly x: number; readonly y: number };
type Segment = readonly [Point, Point];

/** a · b for matrices [a c e; b d f]. */
function times(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return {
    full: true,
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

/** The device-px matrix of one transformed box: T(box) · (the CSS px paint matrix scaled to device px) · T(-box). */
function deviceMatrix(f: Facts, b: SampleBox, dpr: number): Matrix2D {
  const m = paintTransformMatrix(f.ops, f.origin, (b.right - b.left) / dpr, (b.bottom - b.top) / dpr, TRIG);
  const scaled: Matrix2D = { full: true, a: m.a, b: m.b, c: m.c, d: m.d, e: m.e * dpr, f: m.f * dpr };
  return times(times({ full: true, a: 1, b: 0, c: 0, d: 1, e: b.left, f: b.top }, scaled), { full: true, a: 1, b: 0, c: 0, d: 1, e: -b.left, f: -b.top });
}

/** The four sides of a rectangle mapped through m. */
function quadSides(m: Matrix2D, l: number, t: number, r: number, b: number): Segment[] {
  const c = [mapPoint(m, l, t), mapPoint(m, r, t), mapPoint(m, r, b), mapPoint(m, l, b)];
  return c.map((p, i) => [p, c[(i + 1) % 4] as Point] as const);
}

function distanceToSegment(p: Point, [a, b]: Segment): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The clearance a point keeps from every transformed edge: the inset plus the half diagonal of its pixel. */
export const TRANSFORM_CLEARANCE_DEVICE_PX = SAMPLE_INSET_DEVICE_PX + Math.SQRT1_2;

/** An edge or border rule after its kind: the owner, a box side or a line's glyph side, and the suffix of a rescued pixel. */
const SIDED_RULE = new RegExp(`^(.+):(?:top|right|bottom|left|glyph-(?:left|right|top|bottom))(?:${CLEAR_SUFFIX})?$`);

/**
 * Where a base point belongs: the box, text or line id of its rule, without the rule kind, the side, corner or index, and the
 * CLEAR_SUFFIX of a rescued edge or border pixel (T093 F2).
 */
export function ruleOwner(rule: string): string {
  const kind = ruleKind(rule);
  const rest = rule.slice(kind.length + 1);
  if (kind === 'glyph') return rest.replace(/:\d+$/, '');
  if (kind === 'edge' || kind === 'border') {
    const m = SIDED_RULE.exec(rest);
    if (m === null) throw new Error(`the transform samples cannot read the owner of ${rule}`);
    return m[1] as string;
  }
  if (kind === 'clip') return rest.replace(/:(top|right|bottom|left)$/, '');
  if (kind === 'radius') return rest.replace(/:(top-left|top-right|bottom-right|bottom-left)$/, '');
  return rest;
}

/**
 * The program with its transform facts removed, or the program itself when it has none: the same layout, since a transform never
 * moves a layout box, so its sample points are the base points this module maps.
 */
export function withoutTransforms(p: NativeProgram): NativeProgram {
  if (!p.nodes.some((n) => n.facts['transform'] !== undefined)) return p;
  return { ...p, nodes: p.nodes.map((n) => (n.facts['transform'] === undefined ? n : { ...n, facts: Object.fromEntries(Object.entries(n.facts).filter(([k]) => k !== 'transform')) })) };
}

type Info = {
  /** The device matrix of every node, box and line owned by a transformed subtree (text and line ids take their box's). */
  readonly matrices: ReadonlyMap<string, Matrix2D>;
  /** Every transformed edge: the border and padding quads of transformed-subtree boxes and their mapped glyph boxes. */
  readonly edges: readonly Segment[];
  /** Base edge rules to drop whole: a scanline of a transformed subtree, or one a transformed edge comes near. */
  readonly droppedEdgeRules: ReadonlySet<string>;
};

const cache = new WeakMap<PaintSampleContext, Info>();

const nodeOf = (p: NativeProgram): Map<string, NativeProgram['nodes'][number]> => new Map(p.nodes.map((n) => [n.id, n]));

function info(ctx: PaintSampleContext): Info {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const nodes = nodeOf(ctx.program);
  const boxes = new Map(ctx.boxes.map((b) => [b.id, b]));
  const own = new Map<string, Matrix2D | null>();
  const total = (id: string): Matrix2D | null => {
    if (own.has(id)) return own.get(id) as Matrix2D | null;
    const n = nodes.get(id);
    if (n === undefined) throw new Error(`the transform samples reach ${id}, which the program does not have`);
    const up = n.parent === null ? null : total(n.parent);
    const f = n.facts['transform'] as Facts | undefined;
    const b = boxes.get(id);
    let m = up;
    if (f !== undefined && f.ops.length > 0) {
      if (b === undefined) throw new Error(`${id} is transformed but has no sample box`);
      const d = deviceMatrix(f, b, ctx.dpr);
      m = up === null ? d : times(up, d);
    }
    own.set(id, m);
    return m;
  };
  const matrices = new Map<string, Matrix2D>();
  for (const n of ctx.program.nodes) {
    const m = total(n.id);
    if (m !== null) matrices.set(n.id, m);
  }
  const edges: Segment[] = [];
  for (const b of ctx.boxes) {
    const m = matrices.get(b.id);
    if (m === undefined) continue;
    edges.push(...quadSides(m, b.left, b.top, b.right, b.bottom));
    if (b.border.top + b.border.right + b.border.bottom + b.border.left > 0) edges.push(...quadSides(m, b.left + b.border.left, b.top + b.border.top, b.right - b.border.right, b.bottom - b.border.bottom));
  }
  if (ctx.program.nodes.some((n) => n.kind === 'text' && matrices.has(n.id))) {
    for (const line of glyphLines(ctx.program, ctx.viewport, ctx.dpr)) {
      const text = line.id.replace(/:line\d+$/, '');
      const m = matrices.get(text);
      if (m === undefined) continue;
      matrices.set(line.id, m);
      for (const g of line.glyphs) edges.push(...quadSides(m, g.left, g.top, g.right, g.bottom));
    }
  }
  const near = (p: SamplePoint): boolean => edges.some((s) => distanceToSegment({ x: p.x + 0.5, y: p.y + 0.5 }, s) < TRANSFORM_CLEARANCE_DEVICE_PX);
  const droppedEdgeRules = new Set<string>();
  for (const p of ctx.base) if (ruleKind(p.rule) === 'edge' && (matrices.has(ruleOwner(p.rule)) || near(p))) droppedEdgeRules.add(p.rule);
  const out: Info = { matrices, edges, droppedEdgeRules };
  cache.set(ctx, out);
  return out;
}

function clear(i: Info, x: number, y: number): boolean {
  return i.edges.every((s) => distanceToSegment({ x, y }, s) >= TRANSFORM_CLEARANCE_DEVICE_PX);
}

export const TRANSFORM_SAMPLES: PaintSamples = {
  name: 'transform',
  keep: (p, ctx) => {
    const i = info(ctx);
    if (i.matrices.size === 0) return true;
    if (ruleKind(p.rule) === 'edge') return !i.droppedEdgeRules.has(p.rule);
    return !i.matrices.has(ruleOwner(p.rule)) && clear(i, p.x + 0.5, p.y + 0.5);
  },
  points: (ctx) => {
    const i = info(ctx);
    if (i.matrices.size === 0) return [];
    const out: SamplePoint[] = [];
    for (const p of ctx.base) {
      if (ruleKind(p.rule) === 'edge') continue;
      const m = i.matrices.get(ruleOwner(p.rule));
      if (m === undefined) continue;
      const q = mapPoint(m, p.x + 0.5, p.y + 0.5);
      const x = Math.floor(q.x);
      const y = Math.floor(q.y);
      if (x < 0 || y < 0 || x >= ctx.size.width || y >= ctx.size.height) continue;
      if (clear(i, x + 0.5, y + 0.5)) out.push({ x, y, rule: p.rule });
    }
    return out;
  },
};
