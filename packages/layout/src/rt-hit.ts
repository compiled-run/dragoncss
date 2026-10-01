// Dragon's hit test (notes/T047-runtime-spec.md RT-9 and amendment T063J), ported from Chrome 145 (47e20adcc15f, Chromium BSD):
// third_party/blink/renderer/core/paint/box_fragment_painter.cc NodeAtPoint, HitTestAllPhases, HitTestBlockChildren,
// HitTestItemsChildren, HitTestTextItem, HitTestLineBoxFragment and HitTestClippedOutByBorder; layout/inline/fragment_item.cc
// ComputeTextBoundsRectForHitTest; paint/contoured_border_geometry.cc, platform/geometry/contoured_rect.cc and
// float_rounded_rect.cc (the inclusive border test); paint/clip_rect.cc Intersects; ui/gfx/geometry/quad_f.cc IntersectsRect. The
// point semantics (floor to 1/64 px, a 1x1 px box, exclusive rect intersection), the layer order (positioned boxes in reverse
// document order, then the root) and the layer clips (a clipping layer clips its in-flow content to its border box, and descendant
// layers on its containing-block chain to its padding box) are measured against Chrome, not taken from the LGPL
// hit_test_location.cc or paint_layer.cc. Every length is in LU (1/64 px), absolute to the root.
import { floorOf } from './rt-easing.ts';

/** One hit node: a box, or a text piece or line of a block's inline content. target is the node index hit testing returns. */
export type HitNode = {
  readonly kind: HitKind;
  /** The parent box (for a text piece or line, the block whose inline content it is); -1 for the root. */
  readonly parent: number;
  /** The index of the element the hit returns: the box itself, or the nearest element box for anonymous boxes and inline content. */
  readonly target: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** overflow hidden: descendants are clipped to the padding box (the border box inset by these widths). */
  readonly clips: boolean;
  readonly borderTop: number;
  readonly borderRight: number;
  readonly borderBottom: number;
  readonly borderLeft: number;
  /** position other than static: the box paints and hit tests as its own layer (z-index auto). */
  readonly layer: boolean;
  /** position absolute: its containing block is the nearest layer ancestor. */
  readonly absolute: boolean;
  /** Painted atomically (a flex item): all its phases are tested together, in the parent's foreground phase. */
  readonly atomic: boolean;
  /** The flex order among siblings (order-modified document order); 0 for every other box. */
  readonly order: number;
  /** The index of the inline line a text piece or line belongs to, within its block; -1 for boxes. */
  readonly line: number;
  /** A text piece's glyph ink (its glyph bounds rounded out to whole pixels); 0 for boxes and lines. */
  readonly inkLeft: number;
  readonly inkTop: number;
  readonly inkRight: number;
  readonly inkBottom: number;
  readonly pointerEvents: PointerEvents;
};

export type HitKind = 'box' | 'text' | 'line';
export type PointerEvents = 'auto' | 'none';

/** Planted faults of the hit test (T047 §3.3 item 12). */
export type HitFaults = { readonly ignorePointerEventsNone: boolean; readonly reversedOrder: boolean };
export const NO_HIT_FAULTS: HitFaults = { ignorePointerEventsNone: false, reversedOrder: false };

export class HitError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`hit test: ${detail}`);
    this.detail = detail;
  }
}

const LU_PX = 64;

/** LayoutUnit::Round: floor(v + 0.5 px), in LU. */
function roundPx(v: number): number {
  return floorOf((v + LU_PX / 2) / LU_PX) * LU_PX;
}

/** A 1x1 px box at the floored point intersects [x, x + w) x [y, y + h) exclusively; an empty rect never does. */
function intersects(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  if (w <= 0 || h <= 0) return false;
  return x < px + LU_PX && px < x + w && y < py + LU_PX && py < y + h;
}

/** The same box against the pixel-snapped rect, exclusively (ComputeTextBoundsRectForHitTest). */
function intersectsSnapped(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  const x0 = roundPx(x);
  const y0 = roundPx(y);
  return intersects(px, py, x0, y0, roundPx(x + w) - x0, roundPx(y + h) - y0);
}

/** The same box against the pixel-snapped rect, inclusively (the contoured border test through gfx::QuadF::IntersectsRect). */
function touchesSnapped(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  const x0 = roundPx(x);
  const y0 = roundPx(y);
  const x1 = roundPx(x + w);
  const y1 = roundPx(y + h);
  return x0 <= px + LU_PX && px <= x1 && y0 <= py + LU_PX && py <= y1;
}

type Ctx = { readonly nodes: readonly HitNode[]; readonly children: readonly (readonly number[])[]; readonly px: number; readonly py: number; readonly faults: HitFaults };

function node(ctx: Ctx, i: number): HitNode {
  const n = ctx.nodes[i];
  if (n === undefined) throw new HitError(`no hit node ${i}`);
  return n;
}

function visible(ctx: Ctx, n: HitNode): boolean {
  return ctx.faults.ignorePointerEventsNone || n.pointerEvents === 'auto';
}

/**
 * Whether a clipping box lets the point through to its in-flow content: its padding box (NodeAtPoint's overflow clip check), or,
 * for a box that is its own layer, its border box (the layer's own clip, measured).
 */
function insideClip(ctx: Ctx, n: HitNode): boolean {
  if (n.layer) return intersects(ctx.px, ctx.py, n.x, n.y, n.width, n.height);
  return insidePadding(ctx, n);
}

/** Whether the point lies inside a box's padding box. */
function insidePadding(ctx: Ctx, n: HitNode): boolean {
  return intersects(ctx.px, ctx.py, n.x + n.borderLeft, n.y + n.borderTop, n.width - n.borderLeft - n.borderRight, n.height - n.borderTop - n.borderBottom);
}

/** The children of a box in reverse paint order: order-modified document order, reversed (a stable sort by order). */
function reversedChildren(ctx: Ctx, i: number): number[] {
  const own = ctx.children[i];
  if (own === undefined) throw new HitError(`no children list for ${i}`);
  const sorted = own.slice(0).sort((a, b) => node(ctx, a).order - node(ctx, b).order);
  return ctx.faults.reversedOrder ? sorted : sorted.reverse();
}

/** kForeground: inline content (lines last to first, each line's text before the line itself), then block children. */
function foreground(ctx: Ctx, i: number): number {
  const n = node(ctx, i);
  if (n.clips && !insideClip(ctx, n)) return -1;
  const kids = reversedChildren(ctx, i);
  for (const c of kids) {
    const k = node(ctx, c);
    if (k.kind === 'box') {
      if (k.layer) continue;
      const hit = k.atomic ? allPhases(ctx, c) : foreground(ctx, c);
      if (hit >= 0) return hit;
      continue;
    }
    if (k.kind === 'line') {
      const hit = lineHit(ctx, n, k, kids);
      if (hit >= 0) return hit;
    }
  }
  return -1;
}

/**
 * HitTestLineBoxFragment: when the line's ink overflow (the line box and its text) holds the point, the line's text items, last
 * first, against their pixel-snapped rects exclusively (HitTestTextItem); then the line itself, exclusively against the line rect
 * and inclusively against the block's border box placed at the line's offset and pixel-snapped (HitTestClippedOutByBorder).
 */
function lineHit(ctx: Ctx, block: HitNode, line: HitNode, kids: readonly number[]): number {
  let x0 = line.x;
  let y0 = line.y;
  let x1 = line.x + line.width;
  let y1 = line.y + line.height;
  const texts: HitNode[] = [];
  for (const c of kids) {
    const t = node(ctx, c);
    if (t.kind !== 'text' || t.line !== line.line) continue;
    texts.push(t);
    // The text item's ink overflow: its rect and its glyph ink.
    const left = t.inkLeft < t.x ? t.inkLeft : t.x;
    const right = t.inkRight > t.x + t.width ? t.inkRight : t.x + t.width;
    if (left < x0) x0 = left;
    if (right > x1) x1 = right;
    const top = t.inkTop < t.y ? t.inkTop : t.y;
    const bottom = t.inkBottom > t.y + t.height ? t.inkBottom : t.y + t.height;
    if (top < y0) y0 = top;
    if (bottom > y1) y1 = bottom;
  }
  if (!intersects(ctx.px, ctx.py, x0, y0, x1 - x0, y1 - y0)) return -1;
  for (const t of texts) {
    if (visible(ctx, t) && intersectsSnapped(ctx.px, ctx.py, t.x, t.y, t.width, t.height)) return t.target;
  }
  if (visible(ctx, line) && intersects(ctx.px, ctx.py, line.x, line.y, line.width, line.height) && touchesSnapped(ctx.px, ctx.py, line.x, line.y, block.width, block.height)) return line.target;
  return -1;
}

/** kDescendantBlockBackgrounds then kSelfBlockBackground over the non-atomic block descendants, deepest and last first. */
function backgrounds(ctx: Ctx, i: number): number {
  const n = node(ctx, i);
  if (!(n.clips && !insideClip(ctx, n))) {
    for (const c of reversedChildren(ctx, i)) {
      const k = node(ctx, c);
      if (k.kind !== 'box' || k.layer || k.atomic) continue;
      const hit = backgrounds(ctx, c);
      if (hit >= 0) return hit;
    }
  }
  return self(ctx, i);
}

/** The box's own border box, unsnapped and exclusive. */
function self(ctx: Ctx, i: number): number {
  const n = node(ctx, i);
  return visible(ctx, n) && intersects(ctx.px, ctx.py, n.x, n.y, n.width, n.height) ? n.target : -1;
}

/** HitTestAllPhases: foreground, then the descendant block backgrounds, then the box's own background. */
function allPhases(ctx: Ctx, i: number): number {
  const f = foreground(ctx, i);
  if (f >= 0) return f;
  const n = node(ctx, i);
  if (!(n.clips && !insideClip(ctx, n))) {
    for (const c of reversedChildren(ctx, i)) {
      const k = node(ctx, c);
      if (k.kind !== 'box' || k.layer || k.atomic) continue;
      const hit = backgrounds(ctx, c);
      if (hit >= 0) return hit;
    }
  }
  return self(ctx, i);
}

/** The containing block chain step: a layer's for an absolutely positioned box, the parent otherwise. */
function containingParent(ctx: Ctx, i: number): number {
  const n = node(ctx, i);
  if (!n.absolute) return n.parent;
  let at = n.parent;
  while (at >= 0 && !node(ctx, at).layer) at = node(ctx, at).parent;
  return at < 0 ? 0 : at;
}

/** Whether every clipping box on a layer's containing block chain holds the point (the layer's clip rect). */
function layerVisible(ctx: Ctx, i: number): boolean {
  let at = containingParent(ctx, i);
  while (at >= 0) {
    const a = node(ctx, at);
    if (a.clips && !insidePadding(ctx, a)) return false;
    at = containingParent(ctx, at);
  }
  return true;
}

/**
 * The index of the node elementFromPoint names at (px, py), a point in LU already floored to 1/64 px: the positioned layers in
 * reverse document order, then the root layer; the root's target when nothing is hit (the view hit returns the document element).
 */
export function hitTest(nodes: readonly HitNode[], px: number, py: number, faults: HitFaults): number {
  if (nodes.length === 0) throw new HitError('a hit test needs a root');
  const children: number[][] = nodes.map((): number[] => []);
  nodes.forEach((n, i) => {
    if (i === 0) {
      if (n.parent !== -1 || n.kind !== 'box') throw new HitError('node 0 must be the root box');
      return;
    }
    if (n.parent < 0 || n.parent >= i) throw new HitError(`hit node ${i} has parent ${n.parent}, not an earlier node`);
    if (n.target < 0 || n.target >= nodes.length) throw new HitError(`hit node ${i} has target ${n.target}`);
    (children[n.parent] as number[]).push(i);
  });
  const ctx: Ctx = { nodes, children, px, py, faults };
  // The layers in paint order: a preorder walk with each box's children in order-modified document order (measured: Chrome
  // stacks positioned flex items by order).
  const layers: number[] = [];
  const collect = (i: number): void => {
    const n = node(ctx, i);
    if (i > 0 && n.kind === 'box' && n.layer) layers.push(i);
    const own = ctx.children[i];
    if (own === undefined) throw new HitError(`no children list for ${i}`);
    for (const c of own.slice(0).sort((a, b) => node(ctx, a).order - node(ctx, b).order)) collect(c);
  };
  collect(0);
  const order = faults.reversedOrder ? layers : layers.slice(0).reverse();
  for (const l of order) {
    if (!layerVisible(ctx, l)) continue;
    const hit = allPhases(ctx, l);
    if (hit >= 0) return hit;
  }
  const root = allPhases(ctx, 0);
  return root >= 0 ? root : node(ctx, 0).target;
}

/** Tap dispatch (RT-9): from the hit target to the nearest inclusive ancestor with an activation handler, or -1 for none. */
export function activationTarget(nodes: readonly HitNode[], activation: readonly boolean[], hit: number): number {
  if (activation.length !== nodes.length) throw new HitError(`${activation.length} activation flags for ${nodes.length} nodes`);
  let at = hit;
  while (at >= 0) {
    const flag = activation[at];
    if (flag !== undefined && flag) return at;
    const n = nodes[at];
    if (n === undefined) throw new HitError(`no hit node ${at}`);
    at = n.parent;
  }
  return -1;
}
