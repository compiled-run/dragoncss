// Dragon's hit test (notes/T047-runtime-spec.md RT-9 and amendment T063J), ported from Chrome 145 (47e20adcc15f, Chromium BSD):
// third_party/blink/renderer/core/paint/box_fragment_painter.cc NodeAtPoint, HitTestAllPhases, HitTestBlockChildren,
// HitTestItemsChildren, HitTestTextItem, HitTestLineBoxFragment and HitTestClippedOutByBorder; layout/inline/fragment_item.cc
// ComputeTextBoundsRectForHitTest; paint/contoured_border_geometry.cc, platform/geometry/contoured_rect.cc and
// float_rounded_rect.cc (the inclusive border test); paint/clip_rect.cc Intersects; ui/gfx/geometry/quad_f.cc IntersectsRect. The
// point semantics (floor to 1/64 px, a 1x1 px box, exclusive rect intersection), the layer order (positioned boxes in reverse
// document order, then the root) and the layer clips (a clipping layer clips its in-flow content to its border box, and descendant
// layers on its containing-block chain to its padding box) are measured against Chrome, not taken from the LGPL
// hit_test_location.cc or paint_layer.cc. Transforms map the 1x1 px box in float (paint/hit_testing_transform_state.cc, ui/gfx/geometry/axis_transform2d.h, no FMA).
// Every length is in LU (1/64 px), absolute to the root.
import type { Ctx as EngineCtx } from './block.ts';
import { NO_ENGINE_FAULTS } from './block.ts';
import { NO_GRID_FAULTS } from './grid.ts';
import { isScrollContainer, resolveBorder } from './box.ts';
import type { Edges } from './box.ts';
import { controlAsBox } from './controls.ts';
import { placeLines } from './inline.ts';
import { fromPxCeil, fromPxFloor, fromRaw, ZERO } from './units.ts';
import type { ControlBox, InlineChild, LayoutBox, LayoutInput, LayoutStyle, ReplacedLeaf, TextLeaf } from './input.ts';
import type { LayoutRect } from './layout.ts';
import { absoluteRects, layout, resolvedInput } from './layout.ts';
import { UnsupportedSignal } from './unsupported.ts';
import { floorOf, froundOf, roundOf } from './rt-easing.ts';
import { sqrt64 } from './paint-aa.ts';
import { hasRoundedCorner, NO_RADIUS_FAULTS, roundedShape } from './paint-radius.ts';
import type { RadiusLength } from './paint-radius.ts';
import type { TextMeasurer } from './text.ts';
import type { TransformOp, Trig } from './rt-interpolate.ts';
import type { TransformOrigin } from './paint-transform.ts';
import { paintTransformMatrix } from './paint-transform.ts';

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
  /** position fixed: its containing block is the viewport, or its nearest transformed ancestor (css-transforms-1 §2). */
  readonly fixed: boolean;
  /** Painted atomically (a flex item): all its phases are tested together, in the parent's foreground phase. */
  readonly atomic: boolean;
  /** The flex item's place in its container's fragment order (its atomic paint); 0 for every other box. */
  readonly order: number;
  /** The CSS order of an in-flow flex item, which orders positioned boxes among siblings; 0 for every other box. */
  readonly layerOrder: number;
  /** The index of the inline line a text piece or line belongs to, within its block; -1 for boxes. */
  readonly line: number;
  /** A text piece's glyph ink (its glyph bounds rounded out to whole pixels); 0 for boxes and lines. */
  readonly inkLeft: number;
  readonly inkTop: number;
  readonly inkRight: number;
  readonly inkBottom: number;
  readonly pointerEvents: PointerEvents;
  /** A box's rounded border box (a line's rect, with its block's radii) in device px: eight outer radii, then eight inner; empty when square. */
  readonly radii: readonly number[];
  /** A stacking context in the z-index 0 layer (opacity below 1, a transform), hit as its own layer like a positioned box. */
  readonly context: boolean;
  /** A scale and translate transform: container px X = x * scale + offset, x in px from the box's top left (float AxisTransform2d). */
  readonly transformed: boolean;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
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

/** The point's box in one space: [x0, x1) x [y0, y1) in absolute LU, and qx0 to qy1 the same box in float px from the space's origin. */
type HitLocation = {
  /** The space's origin in absolute LU (0 for the root's), which the float box qx0 to qy1 is relative to. */
  readonly ox: number;
  readonly oy: number;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly qx0: number;
  readonly qx1: number;
  readonly qy0: number;
  readonly qy1: number;
  /** The origin pixel snapping is relative to: the nearest space whose box Chrome put at a whole device px (roundsOffset), or 0. */
  readonly sx: number;
  readonly sy: number;
};

/** LayoutUnit::Round of v in the location's space, whose snapping origin may sit at a fraction of a page px. */
function snapX(l: HitLocation, v: number): number {
  return l.sx + roundPx(v - l.sx);
}
function snapY(l: HitLocation, v: number): number {
  return l.sy + roundPx(v - l.sy);
}

/** The location's box intersects [x, x + w) x [y, y + h) exclusively; an empty rect or box never does. */
function intersects(l: HitLocation, x: number, y: number, w: number, h: number): boolean {
  if (w <= 0 || h <= 0 || l.x1 <= l.x0 || l.y1 <= l.y0) return false;
  return x < l.x1 && l.x0 < x + w && y < l.y1 && l.y0 < y + h;
}

/** The same box against the pixel-snapped rect, exclusively (ComputeTextBoundsRectForHitTest). */
function intersectsSnapped(l: HitLocation, x: number, y: number, w: number, h: number): boolean {
  const x0 = snapX(l, x);
  const y0 = snapY(l, y);
  return intersects(l, x0, y0, snapX(l, x + w) - x0, snapY(l, y + h) - y0);
}

/** The same box against the pixel-snapped rect, inclusively (the contoured border test through gfx::QuadF::IntersectsRect). */
function touchesSnapped(l: HitLocation, x: number, y: number, w: number, h: number): boolean {
  if (l.x1 <= l.x0 || l.y1 <= l.y0) return false;
  const x0 = snapX(l, x);
  const y0 = snapY(l, y);
  const x1 = snapX(l, x + w);
  const y1 = snapY(l, y + h);
  return x0 <= l.x1 && l.x0 <= x1 && y0 <= l.y1 && l.y0 <= y1;
}

// ---------------------------------------------------------------- rounded borders (FloatRoundedRect::IntersectsQuad)
// The hit box is the quad (x, y), (x + 1, y), (x + 1, y + 1), (x, y + 1) in device px, clockwise; float steps as gfx::QuadF's,
// cross products and the triangle test in double as quad_f.cc and triangle_f.cc compute them.

function f32(v: number): number {
  return froundOf(v);
}

/** The location's LU box as a clockwise quad in px from its space's origin: Blink's transformed_rect_ of a point hit is its bounding box. */
function quadOf(l: HitLocation): number[] {
  const x0 = (l.x0 - l.ox) / LU_PX;
  const y0 = (l.y0 - l.oy) / LU_PX;
  const x1 = (l.x1 - l.ox) / LU_PX;
  const y1 = (l.y1 - l.oy) / LU_PX;
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

function qx(q: readonly number[], i: number): number {
  const v = q[2 * i];
  if (v === undefined) throw new HitError(`no quad point ${i}`);
  return v;
}

function qy(q: readonly number[], i: number): number {
  const v = q[2 * i + 1];
  if (v === undefined) throw new HitError(`no quad point ${i}`);
  return v;
}

function crossProduct(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** QuadF::IsCounterClockwise. */
function counterClockwise(q: readonly number[]): boolean {
  const p24 = f32(qy(q, 1) - qy(q, 3));
  const p31 = f32(qy(q, 2) - qy(q, 0));
  return qx(q, 0) * p24 + qx(q, 1) * p31 < qx(q, 2) * p24 + qx(q, 3) * p31;
}

/** QuadF::IntersectsRectPartial: no side of the quad has the whole rect on its outer side. */
function quadMeetsRectPartial(q: readonly number[], x: number, y: number, w: number, h: number): boolean {
  const right = f32(x + w);
  const bottom = f32(y + h);
  const ccw = counterClockwise(q);
  for (let k = 0; k < 4; k++) {
    const from = k;
    const to = ccw ? (k === 0 ? 3 : k - 1) : k === 3 ? 0 : k + 1;
    const vx = f32(qx(q, to) - qx(q, from));
    const vy = f32(qy(q, to) - qy(q, from));
    const px = vy >= 0 ? x : right;
    const py = vx >= 0 ? bottom : y;
    if (crossProduct(vx, vy, f32(px - qx(q, from)), f32(py - qy(q, from))) < 0) return false;
  }
  return true;
}

/** QuadF::IntersectsRect: the extents overlap inclusively, then IntersectsRectPartial. */
function quadMeetsRect(q: readonly number[], x: number, y: number, w: number, h: number): boolean {
  const minX = minOf4(qx(q, 0), qx(q, 1), qx(q, 2), qx(q, 3));
  const maxX = maxOf4(qx(q, 0), qx(q, 1), qx(q, 2), qx(q, 3));
  const minY = minOf4(qy(q, 0), qy(q, 1), qy(q, 2), qy(q, 3));
  const maxY = maxOf4(qy(q, 0), qy(q, 1), qy(q, 2), qy(q, 3));
  if (minY > f32(y + h) || y > maxY) return false;
  if (minX > f32(x + w) || x > maxX) return false;
  return quadMeetsRectPartial(q, x, y, w, h);
}

function minOf4(a: number, b: number, c: number, d: number): number {
  const ab = a < b ? a : b;
  const cd = c < d ? c : d;
  return ab < cd ? ab : cd;
}

function maxOf4(a: number, b: number, c: number, d: number): number {
  const ab = a > b ? a : b;
  const cd = c > d ? c : d;
  return ab > cd ? ab : cd;
}

/** gfx::PointIsInTriangle, in double. */
function inTriangle(px: number, py: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): boolean {
  const r31x = f32(x1 - x3);
  const r31y = f32(y1 - y3);
  const r32x = f32(x2 - x3);
  const r32y = f32(y2 - y3);
  const r3px = f32(px - x3);
  const r3py = f32(py - y3);
  const denom = r32y * r31x - r32x * r31y;
  const u = (r32y * r3px - r32x * r3py) / denom;
  const v = (r31x * r3py - r31y * r3px) / denom;
  const w = 1.0 - u - v;
  return u >= 0 && v >= 0 && w >= 0;
}

/** LineIntersectsCircle (quad_f.cc) for a circle at the origin. */
function segmentMeetsCircle(radius: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const radius2 = f32(radius * radius);
  if (f32(f32(x0 * x0) + f32(y0 * y0)) <= radius2 || f32(f32(x1 * x1) + f32(y1 * y1)) <= radius2) return true;
  if (x0 === x1 && y0 === y1) return false;
  const a = f32(y0 - y1);
  const b = f32(x1 - x0);
  const c = f32(f32(x0 * y1) - f32(x1 * y0));
  const ab = f32(f32(a * a) + f32(b * b));
  const distance2 = f32(f32(c * c) / ab);
  if (distance2 > radius2) return false;
  const x = f32(f32(f32(0 - a) * c) / ab);
  const y = f32(f32(f32(0 - b) * c) / ab);
  return ((x0 <= x && x <= x1) || (x0 >= x && x >= x1)) && ((y0 <= y && y <= y1) || (y1 <= y && y <= y0));
}

/** QuadF::IntersectsEllipse: the quad, moved and scaled so the ellipse is a circle at the origin, meets that circle. */
function quadMeetsEllipse(q: readonly number[], cx: number, cy: number, rx: number, ry: number): boolean {
  const t: number[] = [];
  for (let k = 0; k < 4; k++) {
    t.push(f32(f32(qx(q, k) - cx) * ry));
    t.push(f32(f32(qy(q, k) - cy) * rx));
  }
  const radius = f32(ry * rx);
  if (inTriangle(0, 0, qx(t, 0), qy(t, 0), qx(t, 1), qy(t, 1), qx(t, 2), qy(t, 2)) || inTriangle(0, 0, qx(t, 0), qy(t, 0), qx(t, 2), qy(t, 2), qx(t, 3), qy(t, 3))) return true;
  for (let k = 0; k < 4; k++) {
    const n = k === 3 ? 0 : k + 1;
    if (segmentMeetsCircle(radius, qx(t, k), qy(t, k), qx(t, n), qy(t, n))) return true;
  }
  return false;
}

function radiusAt(radii: readonly number[], i: number): number {
  const v = radii[i];
  if (v === undefined) throw new HitError(`no radius ${i}`);
  return v;
}

/**
 * FloatRoundedRect::IntersectsQuad for the hit box at (x, y) device px against the rect (rx, ry, rw, rh) with eight radii (horizontal
 * then vertical, top-left, top-right, bottom-right, bottom-left, from index base): inside the rect, and inside each corner's ellipse it
 * reaches into.
 */
function boxMeetsRounded(q: readonly number[], rx: number, ry: number, rw: number, rh: number, radii: readonly number[], base: number): boolean {
  if (!quadMeetsRect(q, rx, ry, rw, rh)) return false;
  const minX = minOf4(qx(q, 0), qx(q, 1), qx(q, 2), qx(q, 3));
  const maxX = maxOf4(qx(q, 0), qx(q, 1), qx(q, 2), qx(q, 3));
  const minY = minOf4(qy(q, 0), qy(q, 1), qy(q, 2), qy(q, 3));
  const maxY = maxOf4(qy(q, 0), qy(q, 1), qy(q, 2), qy(q, 3));
  const right = f32(rx + rw);
  const bottom = f32(ry + rh);
  const tlw = radiusAt(radii, base + 0);
  const tlh = radiusAt(radii, base + 4);
  if (tlw !== 0 && tlh !== 0) {
    const cr = f32(rx + tlw);
    const cb = f32(ry + tlh);
    if (minY <= cb && minX <= cr && quadMeetsRectPartial(q, rx, ry, tlw, tlh) && !quadMeetsEllipse(q, cr, cb, tlw, tlh)) return false;
  }
  const trw = radiusAt(radii, base + 1);
  const trh = radiusAt(radii, base + 5);
  if (trw !== 0 && trh !== 0) {
    const cx = f32(right - trw);
    const cb = f32(ry + trh);
    if (minY <= cb && maxX >= cx && quadMeetsRectPartial(q, cx, ry, trw, trh) && !quadMeetsEllipse(q, cx, cb, trw, trh)) return false;
  }
  const blw = radiusAt(radii, base + 3);
  const blh = radiusAt(radii, base + 7);
  if (blw !== 0 && blh !== 0) {
    const cy = f32(bottom - blh);
    const cr = f32(rx + blw);
    if (maxY >= cy && minX <= cr && quadMeetsRectPartial(q, rx, cy, blw, blh) && !quadMeetsEllipse(q, cr, cy, blw, blh)) return false;
  }
  const brw = radiusAt(radii, base + 2);
  const brh = radiusAt(radii, base + 6);
  if (brw !== 0 && brh !== 0) {
    const cx = f32(right - brw);
    const cy = f32(bottom - brh);
    if (maxY >= cy && maxX >= cx && quadMeetsRectPartial(q, cx, cy, brw, brh) && !quadMeetsEllipse(q, cx, cy, brw, brh)) return false;
  }
  return true;
}

type HitCtx = {
  readonly nodes: readonly HitNode[];
  readonly children: readonly (readonly number[])[];
  readonly lineTexts: readonly (readonly number[])[];
  /** Each node's space: the nearest transformed inclusive ancestor box, or 0 (the root's). */
  readonly spaces: readonly number[];
  /** The location in each space (HitSpaces). */
  readonly locations: readonly HitLocation[];
  readonly faults: HitFaults;
};

function locationOf(ctx: HitCtx, i: number): HitLocation {
  const s = ctx.spaces[i];
  if (s === undefined) throw new HitError(`no space for hit node ${i}`);
  const l = ctx.locations[s];
  if (l === undefined) throw new HitError(`no location in space ${s}`);
  return l;
}

/** A self-painting layer: a positioned box or a stacking context, hit in the layer phase rather than with its parent's flow. */
function ownLayer(n: HitNode): boolean {
  return n.layer || n.context;
}

function node(ctx: HitCtx, i: number): HitNode {
  const n = ctx.nodes[i];
  if (n === undefined) throw new HitError(`no hit node ${i}`);
  return n;
}

function visible(ctx: HitCtx, n: HitNode): boolean {
  return ctx.faults.ignorePointerEventsNone || n.pointerEvents === 'auto';
}

/**
 * Whether a clipping box lets the point through to its in-flow content: its padding box (NodeAtPoint's overflow clip check), or,
 * for a box that is its own layer, its border box (the layer's own clip, measured).
 */
function insideClip(ctx: HitCtx, n: HitNode, i: number): boolean {
  if (ownLayer(n)) return intersects(locationOf(ctx, i), n.x, n.y, n.width, n.height) && insideRoundedPadding(ctx, n, i);
  return insidePadding(ctx, n, i) && insideRoundedPadding(ctx, n, i);
}

/** Whether the point lies inside a box's padding box. */
function insidePadding(ctx: HitCtx, n: HitNode, i: number): boolean {
  return intersects(locationOf(ctx, i), n.x + n.borderLeft, n.y + n.borderTop, n.width - n.borderLeft - n.borderRight, n.height - n.borderTop - n.borderBottom);
}

/** Whether the hit box meets a rounded box's pixel-snapped border box (HitTestClippedOutByBorder); a square box always passes. */
function insideRoundedBorder(ctx: HitCtx, n: HitNode, i: number): boolean {
  if (n.radii.length === 0) return true;
  const l = locationOf(ctx, i);
  const x = snapX(l, n.x);
  const y = snapY(l, n.y);
  return boxMeetsRounded(quadOf(l), (x - l.ox) / LU_PX, (y - l.oy) / LU_PX, (snapX(l, n.x + n.width) - x) / LU_PX, (snapY(l, n.y + n.height) - y) / LU_PX, n.radii, 0);
}

/** HitTestClippedOutByBorder of a line's block at the line's ink offset: the block's snapped border box moved there, rounded as the block. */
function touchesBlockBorder(l: HitLocation, x: number, y: number, block: HitNode): boolean {
  if (block.radii.length === 0) return touchesSnapped(l, x, y, block.width, block.height);
  const x0 = snapX(l, x);
  const y0 = snapY(l, y);
  return boxMeetsRounded(quadOf(l), (x0 - l.ox) / LU_PX, (y0 - l.oy) / LU_PX, (snapX(l, x + block.width) - x0) / LU_PX, (snapY(l, y + block.height) - y0) / LU_PX, block.radii, 0);
}

/** Whether the hit box meets a rounded clipping box's pixel-snapped padding edge (PixelSnappedContouredInnerBorder). */
function insideRoundedPadding(ctx: HitCtx, n: HitNode, i: number): boolean {
  if (n.radii.length === 0) return true;
  const l = locationOf(ctx, i);
  const x = snapX(l, n.x + n.borderLeft);
  const y = snapY(l, n.y + n.borderTop);
  const w = maxOf0(snapX(l, n.x + n.width - n.borderRight) - x);
  const h = maxOf0(snapY(l, n.y + n.height - n.borderBottom) - y);
  return boxMeetsRounded(quadOf(l), (x - l.ox) / LU_PX, (y - l.oy) / LU_PX, w / LU_PX, h / LU_PX, n.radii, 8);
}

function maxOf0(v: number): number {
  return v > 0 ? v : 0;
}

/** The children of a box in reverse paint order (prepared once by prepareHit). */
function reversedChildren(ctx: HitCtx, i: number): readonly number[] {
  const own = ctx.children[i];
  if (own === undefined) throw new HitError(`no children list for ${i}`);
  return own;
}

/** kForeground: inline content (lines last to first, each line's text before the line itself), then block children. */
function foreground(ctx: HitCtx, i: number): number {
  const n = node(ctx, i);
  if (n.clips && !insideClip(ctx, n, i)) return -1;
  const kids = reversedChildren(ctx, i);
  for (const c of kids) {
    const k = node(ctx, c);
    if (k.kind === 'box') {
      if (ownLayer(k)) continue;
      const hit = k.atomic ? allPhases(ctx, c) : foreground(ctx, c);
      if (hit >= 0) return hit;
      continue;
    }
    if (k.kind === 'line') {
      const hit = lineHit(ctx, n, k, c);
      if (hit >= 0) return hit;
    }
  }
  return -1;
}

/**
 * HitTestLineBoxFragment: when the line's ink overflow (the line box and its text) holds the point, the line's text items, last
 * first, against their pixel-snapped rects exclusively (HitTestTextItem); then the line itself, exclusively against the line rect,
 * inclusively against the block's border box placed at the line's offset and pixel-snapped (HitTestClippedOutByBorder), and against
 * the line rect rounded with the block's radii (PixelSnappedContouredBorder of the block's style on the line's bounds).
 */
function lineHit(ctx: HitCtx, block: HitNode, line: HitNode, at: number): number {
  const l = locationOf(ctx, at);
  let x0 = line.x;
  let y0 = line.y;
  let x1 = line.x + line.width;
  let y1 = line.y + line.height;
  const own = ctx.lineTexts[at];
  if (own === undefined) throw new HitError(`no text list for line ${at}`);
  const texts: HitNode[] = [];
  for (const c of own) {
    const t = node(ctx, c);
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
  if (!intersects(l, x0, y0, x1 - x0, y1 - y0)) return -1;
  for (const t of texts) {
    if (visible(ctx, t) && intersectsSnapped(l, t.x, t.y, t.width, t.height)) return t.target;
  }
  if (visible(ctx, line) && intersects(l, line.x, line.y, line.width, line.height) && touchesBlockBorder(l, line.x, line.y, block) && insideRoundedBorder(ctx, line, at)) return line.target;
  return -1;
}

/** kDescendantBlockBackgrounds then kSelfBlockBackground over the non-atomic block descendants, deepest and last first. */
function backgrounds(ctx: HitCtx, i: number): number {
  const n = node(ctx, i);
  if (!(n.clips && !insideClip(ctx, n, i))) {
    for (const c of reversedChildren(ctx, i)) {
      const k = node(ctx, c);
      if (k.kind !== 'box' || ownLayer(k) || k.atomic) continue;
      const hit = backgrounds(ctx, c);
      if (hit >= 0) return hit;
    }
  }
  return self(ctx, i);
}

/** The box's own border box, unsnapped and exclusive. */
function self(ctx: HitCtx, i: number): number {
  const n = node(ctx, i);
  return visible(ctx, n) && intersects(locationOf(ctx, i), n.x, n.y, n.width, n.height) && insideRoundedBorder(ctx, n, i) ? n.target : -1;
}

/** HitTestAllPhases: foreground, then the descendant block backgrounds, then the box's own background. */
function allPhases(ctx: HitCtx, i: number): number {
  const f = foreground(ctx, i);
  if (f >= 0) return f;
  const n = node(ctx, i);
  if (!(n.clips && !insideClip(ctx, n, i))) {
    for (const c of reversedChildren(ctx, i)) {
      const k = node(ctx, c);
      if (k.kind !== 'box' || ownLayer(k) || k.atomic) continue;
      const hit = backgrounds(ctx, c);
      if (hit >= 0) return hit;
    }
  }
  return self(ctx, i);
}

/** The containing block chain step: a layer's for an absolutely positioned box, the parent otherwise. */
function containingParent(ctx: HitCtx, i: number): number {
  const n = node(ctx, i);
  if (n.fixed) {
    let up = n.parent;
    while (up >= 0 && !node(ctx, up).transformed) up = node(ctx, up).parent;
    return up < 0 ? 0 : up;
  }
  if (!n.absolute) return n.parent;
  let at = n.parent;
  while (at >= 0 && !node(ctx, at).layer) at = node(ctx, at).parent;
  return at < 0 ? 0 : at;
}

/** Whether every clipping box on a layer's containing block chain holds the point (the layer's clip rect). */
function layerVisible(ctx: HitCtx, i: number): boolean {
  let at = containingParent(ctx, i);
  while (at >= 0) {
    const a = node(ctx, at);
    if (a.clips && !insidePadding(ctx, a, at)) return false;
    at = containingParent(ctx, at);
  }
  return true;
}

/** A table prepared for many points: each box's children in reverse paint order, and the layers in hit order. */
export type HitPrepared = {
  readonly nodes: readonly HitNode[];
  readonly children: readonly (readonly number[])[];
  /** For each line node, the text pieces of its block on that line, in its block's reverse paint order; empty for other nodes. */
  readonly lineTexts: readonly (readonly number[])[];
  readonly layers: readonly number[];
  readonly spaces: HitSpaces;
  readonly faults: HitFaults;
};

/** Each node's space (0 the root's, k the k-th transformed box), and each transformed box's node and container space. */
export type HitSpaces = { readonly of: readonly number[]; readonly boxes: readonly number[]; readonly containers: readonly number[] };

/** The spaces of a checked table (nodes in document order, each parent before its children). */
export function hitSpaces(nodes: readonly HitNode[]): HitSpaces {
  const of: number[] = [];
  const boxes: number[] = [];
  const containers: number[] = [];
  nodes.forEach((n, i) => {
    const up = i === 0 ? 0 : of[n.parent];
    if (up === undefined) throw new HitError(`hit node ${i} has parent ${n.parent}, not an earlier node`);
    if (!n.transformed) {
      of.push(up);
      return;
    }
    if (i === 0 || n.kind !== 'box') throw new HitError(`hit node ${i} is transformed, but only a box below the root can be`);
    if (!n.context) throw new HitError(`hit node ${i} is transformed but makes no stacking context`);
    boxes.push(i);
    containers.push(up);
    of.push(boxes.length);
  });
  return { of, boxes, containers };
}


/** Checks a table and prepares it: children in order-modified document order, reversed, and the layers in reverse paint order. */
export function prepareHit(nodes: readonly HitNode[], faults: HitFaults): HitPrepared {
  if (nodes.length === 0) throw new HitError('a hit test needs a root');
  const children: number[][] = nodes.map((): number[] => []);
  nodes.forEach((n, i) => {
    if (i === 0) {
      if (n.parent !== -1 || n.kind !== 'box') throw new HitError('node 0 must be the root box');
      return;
    }
    if (n.parent < 0 || n.parent >= i) throw new HitError(`hit node ${i} has parent ${n.parent}, not an earlier node`);
    if (n.target < 0 || n.target >= nodes.length) throw new HitError(`hit node ${i} has target ${n.target}`);
    if (n.kind !== 'box' && !(Number.isInteger(n.line) && n.line >= 0 && n.line < nodes.length)) throw new HitError(`hit node ${i} has line ${n.line}`);
    (children[n.parent] as number[]).push(i);
  });
  const nodeOf = (i: number): HitNode => {
    const n = nodes[i];
    if (n === undefined) throw new HitError(`no hit node ${i}`);
    return n;
  };
  // The atomic paint follows fragment order, a stable sort by order.
  const ordered = children.map((own) => own.slice(0).sort((a, b) => nodeOf(a).order - nodeOf(b).order));
  // The layers in paint order: a preorder walk in order-modified document order, a stable sort by the CSS order with an absolute
  // child at 0 (measured: Chrome 145 does not reverse positioned items under a reverse direction).
  const layerOrdered = children.map((own) => own.slice(0).sort((a, b) => nodeOf(a).layerOrder - nodeOf(b).layerOrder));
  const layers: number[] = [];
  const collect = (i: number): void => {
    const n = nodeOf(i);
    if (i > 0 && n.kind === 'box' && ownLayer(n)) layers.push(i);
    const own = layerOrdered[i];
    if (own === undefined) throw new HitError(`no children list for ${i}`);
    for (const c of own) collect(c);
  };
  collect(0);
  const reversed = faults.reversedOrder ? ordered : ordered.map((own) => own.slice(0).reverse());
  // Each line's text pieces, grouped once per block (in the block's child order) so a point tests a line in O(its pieces).
  const lineTexts: number[][] = nodes.map((): number[] => []);
  reversed.forEach((own) => {
    const byLine: number[][] = [];
    for (const c of own) {
      const t = nodes[c];
      if (t === undefined || t.kind !== 'text') continue;
      while (byLine.length <= t.line) byLine.push([]);
      (byLine[t.line] as number[]).push(c);
    }
    for (const c of own) {
      const l = nodes[c];
      if (l === undefined || l.kind !== 'line') continue;
      const texts = byLine[l.line];
      if (texts === undefined) continue;
      const dest = lineTexts[c] as number[];
      for (const x of texts) dest.push(x);
    }
  });
  return { nodes, children: reversed, lineTexts, layers: faults.reversedOrder ? layers : layers.slice(0).reverse(), spaces: hitSpaces(nodes), faults };
}

/** FLT_MIN: the smallest normal float. */
const FLOAT_MIN_NORMAL = 1.1754943508222875e-38;

/** The container's float box through AxisTransform2d::Invert and MapPoint, enclosed in LU; a non-normal float determinant hits nothing. */
function mappedLocation(from: HitLocation, n: HitNode): HitLocation {
  const det = froundOf(n.scaleX * n.scaleY);
  const a = det < 0 ? -det : det;
  const rounds = !(n.scaleX === 1 && n.scaleY === 1);
  const sx = rounds ? n.x : from.sx;
  const sy = rounds ? n.y : from.sy;
  if (!(a >= FLOAT_MIN_NORMAL && Number.isFinite(a))) return { ox: n.x, oy: n.y, x0: 0, x1: 0, y0: 0, y1: 0, qx0: 0, qx1: 0, qy0: 0, qy1: 0, sx, sy };
  const ix = froundOf(1 / n.scaleX);
  const iy = froundOf(1 / n.scaleY);
  const tx = froundOf(n.offsetX * -ix);
  const ty = froundOf(n.offsetY * -iy);
  const ax = froundOf(froundOf(from.qx0 * ix) + tx);
  const bx = froundOf(froundOf(from.qx1 * ix) + tx);
  const ay = froundOf(froundOf(from.qy0 * iy) + ty);
  const by = froundOf(froundOf(from.qy1 * iy) + ty);
  const qx0 = ax < bx ? ax : bx;
  const qx1 = ax < bx ? bx : ax;
  const qy0 = ay < by ? ay : by;
  const qy1 = ay < by ? by : ay;
  return { ox: n.x, oy: n.y, x0: n.x + fromPxFloor(qx0), x1: n.x + fromPxCeil(qx1), y0: n.y + fromPxFloor(qy0), y1: n.y + fromPxCeil(qy1), qx0, qx1, qy0, qy1, sx, sy };
}

/** The location of a point in every space of a prepared table: the 1x1 px box in the root's, mapped down each transform. */
function locationsAt(prepared: HitPrepared, px: number, py: number): HitLocation[] {
  const out: HitLocation[] = [{ ox: 0, oy: 0, x0: px, x1: px + LU_PX, y0: py, y1: py + LU_PX, qx0: px / LU_PX, qx1: (px + LU_PX) / LU_PX, qy0: py / LU_PX, qy1: (py + LU_PX) / LU_PX, sx: 0, sy: 0 }];
  prepared.spaces.boxes.forEach((b, k) => {
    const from = out[prepared.spaces.containers[k] as number];
    const n = prepared.nodes[b];
    if (from === undefined || n === undefined) throw new HitError(`no container location for transformed node ${b}`);
    out.push(mappedLocation(from, n));
  });
  return out;
}

/**
 * The index of the node elementFromPoint names at (px, py), a point in LU already floored to 1/64 px: the positioned layers in
 * reverse paint order, then the root layer; the root's target when nothing is hit (the view hit returns the document element).
 */
export function hitAt(prepared: HitPrepared, px: number, py: number): number {
  const ctx: HitCtx = { nodes: prepared.nodes, children: prepared.children, lineTexts: prepared.lineTexts, spaces: prepared.spaces.of, locations: locationsAt(prepared, px, py), faults: prepared.faults };
  for (const l of prepared.layers) {
    if (!layerVisible(ctx, l)) continue;
    const hit = allPhases(ctx, l);
    if (hit >= 0) return hit;
  }
  const root = allPhases(ctx, 0);
  return root >= 0 ? root : node(ctx, 0).target;
}

/** hitAt on a table prepared for one point. */
export function hitTest(nodes: readonly HitNode[], px: number, py: number, faults: HitFaults): number {
  return hitAt(prepareHit(nodes, faults), px, py);
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

// ---------------------------------------------------------------------------------------------------------------------
// The hit table of a laid-out engine input (SELD-R1b): the same function on the host (TypeScript) and on the device (translated).

/** One element's hit facts from the compiler: computed pointer-events, whether it was inherited, and its activation handler. */
export type HitFact = {
  readonly pointerEvents: PointerEvents;
  readonly inherited: boolean;
  readonly activation: boolean;
  /** The eight authored border-radius components (horizontal then vertical, top-left first); empty when every corner is square. */
  readonly radii: readonly RadiusLength[];
  /** A stacking context in the z-index 0 layer (opacity below 1, a transform). */
  readonly context: boolean;
  /** The transform functions (none when empty) and origin. */
  readonly transform: readonly TransformOp[];
  readonly origin: TransformOrigin;
};
/** Why the hit table does not model a transform, or null: it models translate and positive scale functions (a rotate by 0 is the identity). */
export function hitTransformRefusal(id: string, ops: readonly TransformOp[]): string | null {
  for (const o of ops) {
    if (o.fn === 'rotate' && o.angle !== 0) return `${id} rotates, and the hit table models scale and translate transforms only (SELD-R2b)`;
    if (o.sx < 0 || o.sy < 0) return `${id} flips, and the hit table models scales by positive factors only (SELD-R2b)`;
  }
  // Measured at DPR 2.625: Chrome's mapping through a translate after a scale differs from this float mapping at an exact edge.
  let scaled = false;
  for (const o of ops) {
    if (scaled && (o.fn === 'translate' || o.fn === 'translateX' || o.fn === 'translateY')) return `${id} translates after it scales, and the hit table models a translate before a scale only (SELD-R2b)`;
    if ((o.fn === 'scale' || o.fn === 'scaleX' || o.fn === 'scaleY') && (o.sx !== 1 || o.sy !== 1)) scaled = true;
  }
  return null;
}

/** Never read: a rotate by 0 returns before sin and cos, and any other turn leaves a full matrix paintOf refuses. */
function unreadAngle(radians: number): number {
  return radians * 0;
}
const NO_ROTATION: Trig = { sin: unreadAngle, cos: unreadAngle };

/** A box's paint facts in the hit table: its stacking context and its transform as an axis transform from its container's space. */
type HitPaint = { readonly context: boolean; readonly transformed: boolean; readonly scaleX: number; readonly scaleY: number; readonly offsetX: number; readonly offsetY: number };

/** A transform length at the device zoom, as Blink zooms a computed length. */
function zoomedLength(l: TransformOp['x'], zoom: number): TransformOp['x'] {
  return { kind: l.kind, px: l.px * zoom, percent: l.percent };
}

/** A box's paint facts: its transform at its device border-box size (paint-transform.ts), offset from the space origin (ox, oy) in float. */
function paintOf(id: string, f: HitFact, r: LayoutRect, zoom: number, ox: number, oy: number, sox: number, soy: number, faults: HitTableFaults): HitPaint {
  if (f.transform.length === 0 || faults.transformIgnored) return { context: f.context && !(faults.contextNotLayered && f.transform.length === 0), transformed: false, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  const refused = hitTransformRefusal(id, f.transform);
  if (refused !== null) throw new HitError(refused);
  if (!f.context) throw new HitError(`${id} is transformed but its facts make no stacking context`);
  const ops = f.transform.map((o): TransformOp => ({ fn: o.fn, x: zoomedLength(o.x, zoom), y: zoomedLength(o.y, zoom), angle: o.angle, sx: o.sx, sy: o.sy }));
  const origin: TransformOrigin = { x: zoomedLength(f.origin.x, zoom), y: zoomedLength(f.origin.y, zoom) };
  const m = paintTransformMatrix(ops, origin, r.width / LU_PX, r.height / LU_PX, NO_ROTATION);
  if (m.full || m.b !== 0 || m.c !== 0) throw new HitError(`${id}: a scale and translate transform did not stay axis-aligned`);
  // Chrome rounds the paint offset of a box whose transform is not a translation to whole device px from the snapping origin, which
  // a translating ancestor's subpixel fraction reaches (paint_property_tree_builder.cc CanPropagateSubpixelAccumulation).
  const translates = m.a === 1 && m.d === 1;
  const atX = translates ? (r.x - ox) / LU_PX : (sox + roundPx(r.x - sox) - ox) / LU_PX;
  const atY = translates ? (r.y - oy) / LU_PX : (soy + roundPx(r.y - soy) - oy) / LU_PX;
  return { context: true, transformed: true, scaleX: m.a, scaleY: m.d, offsetX: froundOf(atX + m.e), offsetY: froundOf(atY + m.f) };
}


/** A table: the nodes hitTest takes, the id each names, and each node's activation flag. */
export type HitTable = { readonly nodes: readonly HitNode[]; readonly ids: readonly string[]; readonly activation: readonly boolean[] };

/** Table plants: inherited pointer-events read as auto; transforms ignored; untransformed stacking contexts hit with their parent's flow. */
export type HitTableFaults = { readonly pointerEventsNotInherited: boolean; readonly transformIgnored: boolean; readonly contextNotLayered: boolean };
export const NO_HIT_TABLE_FAULTS: HitTableFaults = { pointerEventsNotInherited: false, transformIgnored: false, contextNotLayered: false };

type TableState = {
  readonly nodes: HitNode[];
  readonly ids: string[];
  readonly activation: boolean[];
  readonly abs: Map<string, LayoutRect>;
  readonly boxes: readonly LayoutRect[];
  readonly zoomed: Map<string, LayoutBox>;
  /** The zoomed style of each replaced leaf, by id. */
  readonly zoomedReplaced: Map<string, LayoutStyle>;
  readonly ctx: EngineCtx;
  /** The input's device pixel ratio: the hit facts' px radii are CSS px, the rects device px (ctx's ratio is the zoomed input's 1). */
  readonly dpr: number;
  readonly facts: ReadonlyMap<string, HitFact>;
  readonly faults: HitTableFaults;
};

function rectOf(s: TableState, id: string): LayoutRect {
  const r = s.abs.get(id);
  if (r === undefined) throw new HitError(`the engine laid out no ${id}`);
  return r;
}

function zoomedBox(s: TableState, id: string): LayoutBox {
  const b = s.zoomed.get(id);
  if (b === undefined) throw new HitError(`no zoomed box ${id}`);
  return b;
}

function indexZoomed(m: Map<string, LayoutBox>, r: Map<string, LayoutStyle>, b: LayoutBox): void {
  m.set(b.id, b);
  for (const c of b.children) {
    if (c.kind === 'box') indexZoomed(m, r, c);
    else if (c.kind === 'control') indexZoomed(m, r, controlAsBox(c));
    else if (c.kind === 'replaced') r.set(c.id, c.style);
  }
}

/**
 * The flex items' places in a container's fragment order, by id: the engine lists in-flow items line by line, each line in flow
 * order (reversed for a reverse direction), which is Blink's FlexLayoutAlgorithm order except that Blink also reverses the lines
 * under wrap-reverse (ApplyReversals). A line is a run of items whose cross-axis ranges overlap. When an empty cross-axis range
 * only touches the current line's, the main axis decides: an item past the previous one in flow direction continues its line, one
 * before it starts the next; an item at the same main position is refused under wrap-reverse, where the lines' order matters.
 */
function fragmentOrders(s: TableState, container: LayoutBox): Map<string, number> {
  const row = container.style.flexDirection === 'row' || container.style.flexDirection === 'row-reverse';
  const reverse = container.style.flexWrap === 'wrap-reverse';
  // The engine's main-axis flow start is the physical left for an ltr row, the right for an rtl row, and the top for a column.
  const flow = row && container.style.direction === 'rtl' ? -1 : 1;
  const inFlow = new Map<string, boolean>();
  for (const c of container.children) {
    if ((c.kind === 'box' || c.kind === 'control' || c.kind === 'replaced') && c.style.position !== 'absolute') inFlow.set(c.id, true);
  }
  const lines: LayoutRect[][] = [];
  let lo = 0;
  let hi = 0;
  let main = 0;
  for (const x of s.boxes) {
    const parent = x.parent;
    if (parent === null || parent !== container.id || !inFlow.has(x.id)) continue;
    const r = rectOf(s, x.id);
    const a = row ? r.y : r.x;
    const z = a + (row ? r.height : r.width);
    const m = row ? r.x : r.y;
    const cur = lines.length > 0 ? lines[lines.length - 1] : undefined;
    let same = cur !== undefined && a < hi && lo < z;
    if (cur !== undefined && !same && a <= hi && lo <= z && (z <= a || hi <= lo)) {
      const step = flow * (m - main);
      if (step === 0 && reverse) throw new HitError(`${x.id}: a wrap-reverse flex item whose line neither its cross nor its main position tells`);
      same = step > 0;
    }
    main = m;
    if (cur !== undefined && same) {
      cur.push(r);
      if (a < lo) lo = a;
      if (z > hi) hi = z;
      continue;
    }
    lines.push([r]);
    lo = a;
    hi = z;
  }
  const ordered = reverse ? lines.slice(0).reverse() : lines;
  const out = new Map<string, number>();
  let k = 0;
  for (const line of ordered) {
    for (const r of line) {
      out.set(r.id, k);
      k++;
    }
  }
  return out;
}

/**
 * The grid items' places in a container's fragment order, by id: Blink paints grid items atomically in order-modified document
 * order (css-grid-2 §9; GridLayoutAlgorithm::PlaceGridItems adds them in that order), which is the order the engine lists them in.
 */
function gridOrders(s: TableState, container: LayoutBox): Map<string, number> {
  const inFlow = new Map<string, boolean>();
  for (const c of container.children) {
    if ((c.kind === 'box' || c.kind === 'replaced') && c.style.position !== 'absolute') inFlow.set(c.id, true);
  }
  const out = new Map<string, number>();
  let k = 0;
  for (const x of s.boxes) {
    const parent = x.parent;
    if (parent === null || parent !== container.id || !inFlow.has(x.id)) continue;
    out.set(x.id, k);
    k++;
  }
  return out;
}

/** Ahem's ink of a leaf: the em box when a glyph other than p (descender only) shows; p alone inks below the baseline only. */
function inkAbove(leaf: TextLeaf): boolean {
  let full = false;
  for (const ch of leaf.text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0xc9) throw new HitError(`${leaf.id}: Ahem's É glyph inks only its ascender, which the hit table does not model`);
    if (cp !== 0x20 && cp !== 0x200b && cp !== 0x70) full = true;
  }
  return full;
}

function hasPartialInk(leaf: TextLeaf): boolean {
  for (const ch of leaf.text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp === 0x70) return true;
  }
  return false;
}

function pushNode(s: TableState, n: HitNode, id: string, act: boolean): void {
  s.nodes.push(n);
  s.ids.push(id);
  s.activation.push(act);
}

/** A run's line box height, its top half-leading and its ascent (CSS2 §10.8.1), as the engine's placeLines lays them out. */
type LineMetrics = { readonly lineHeight: number; readonly halfLeading: number; readonly ascent: number };

/** A width every line fits in, so the probe line holds the run's first visible text; only its metrics are read. */
const LINE_PROBE_WIDTH = fromRaw(1073741824);

/** A text piece and whether its leaf inks the whole em box. */
type HitPiece = { readonly rect: LayoutRect; readonly full: boolean };

function inlineNodes(s: TableState, b: LayoutBox, parent: number, target: number, pe: PointerEvents, leaves: readonly TextLeaf[], lengths: readonly RadiusLength[], sox: number, soy: number): void {
  const zb = zoomedBox(s, b.id);
  const zLeaves: TextLeaf[] = [];
  for (const c of zb.children) {
    if (c.kind === 'text') zLeaves.push(c);
  }
  // The run's line metrics, read from the engine's own first line box (one font per formatting context, checked below).
  const placed = placeLines(s.ctx, zb, LINE_PROBE_WIDTH);
  const firstLine = placed[0];
  const firstPlaced = firstLine === undefined ? undefined : firstLine.pieces[0];
  const run: LineMetrics = firstLine === undefined || firstPlaced === undefined
    ? { lineHeight: 0, halfLeading: 0, ascent: 0 }
    : { lineHeight: firstLine.height, halfLeading: firstPlaced.top - firstLine.top, ascent: firstPlaced.ascent };
  const first = zLeaves[0];
  if (first === undefined) throw new HitError(`${b.id}: no text leaves`);
  const size = first.font.size;
  for (const l of zLeaves) {
    if (l.font.size !== size) throw new HitError(`${b.id}: text leaves of two font sizes; one inline formatting context holds one font`);
  }
  // The line pieces (<leaf>:line<j>), grouped into lines by their top; a line box starts half-leading above its text.
  const pieces: HitPiece[] = [];
  for (const leaf of leaves) {
    const full = inkAbove(leaf);
    let j = 0;
    while (s.abs.has(`${leaf.id}:line${j}`)) {
      pieces.push({ rect: rectOf(s, `${leaf.id}:line${j}`), full });
      j++;
    }
    if (hasPartialInk(leaf) && full && j > 1) throw new HitError(`${leaf.id}: Ahem p glyphs mixed with full glyphs over several lines give each line its own ink, which the hit table does not model`);
  }
  // Grouped by top with one stable sort (piece order within a line), so the table is not quadratic in the pieces.
  const byTop = pieces.slice(0).sort((p, q) => p.rect.y - q.rect.y);
  let k = 0;
  let from = 0;
  while (from < byTop.length) {
    const head = byTop[from];
    if (head === undefined) throw new HitError(`${b.id}: no piece ${from}`);
    const own: HitPiece[] = [];
    let at = from;
    while (at < byTop.length) {
      const p = byTop[at];
      if (p === undefined || p.rect.y !== head.rect.y) break;
      own.push(p);
      at++;
    }
    linePieces(s, b, parent, target, pe, run, size, own, head.rect.y, k, lengths, sox, soy);
    k++;
    from = at;
  }
}

/** One line of a block's inline content (its pieces, all with this top): the line node, then each text piece on it. */
function linePieces(s: TableState, b: LayoutBox, parent: number, target: number, pe: PointerEvents, run: LineMetrics, em: number, own: readonly HitPiece[], top: number, k: number, lengths: readonly RadiusLength[], sox: number, soy: number): void {
  const firstPiece = own[0];
  if (firstPiece === undefined) throw new HitError(`${b.id}: an empty line`);
  let x0 = firstPiece.rect.x;
  let x1 = x0 + firstPiece.rect.width;
  for (const p of own) {
    if (p.rect.x < x0) x0 = p.rect.x;
    if (p.rect.x + p.rect.width > x1) x1 = p.rect.x + p.rect.width;
  }
  const y = top - run.halfLeading;
  const radii = roundedOf(x0, y, x1 - x0, run.lineHeight, NO_EDGES, lengths, s.dpr, sox, soy);
  pushNode(s, { kind: 'line', parent, target, x: x0, y, width: x1 - x0, height: run.lineHeight, clips: false, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0, layer: false, absolute: false, fixed: false, atomic: false, order: 0, layerOrder: 0, line: k, inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: pe, radii, context: false, transformed: false, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, `${b.id}:hitline${k}`, false);
  for (const p of own) {
    const q = p.rect;
    // Ahem's ink: the glyph run's bounds rounded out to whole pixels in the run's own space (from the run origin to n em, and
    // from 0.8 em above the baseline to 0.2 em below), placed at the text's origin and ascent; measured against Chrome.
    const baseline = q.y + run.ascent;
    const glyphs = roundOf(q.width / (em * LU_PX));
    const above = p.full ? floorOf(-0.8 * em) : 0;
    pushNode(s, {
      kind: 'text', parent, target, x: q.x, y: q.y, width: q.width, height: q.height, clips: false, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
      layer: false, absolute: false, fixed: false, atomic: false, order: 0, layerOrder: 0, line: k, inkLeft: q.x, inkTop: baseline + above * LU_PX, inkRight: q.x - floorOf(-(glyphs * em)) * LU_PX,
      inkBottom: baseline - floorOf(-0.2 * em) * LU_PX, pointerEvents: pe, radii: [], context: false, transformed: false, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0,
    }, q.id, false);
  }
}

const NO_EDGES: Edges = { top: ZERO, right: ZERO, bottom: ZERO, left: ZERO };

/**
 * A box's rounded border for the hit test (ContouredBorderGeometry::PixelSnappedContouredBorder and ...InnerBorder): roundedShape on
 * its pixel-snapped border box in device px, radii resolved against the unsnapped size; empty when no corner is rounded.
 */
function roundedOf(x: number, y: number, w: number, h: number, border: Edges, lengths: readonly RadiusLength[], dpr: number, sox: number, soy: number): number[] {
  if (lengths.length === 0) return [];
  // The radii are constrained against the border box snapped in the box's own space (from its snapping origin), as the hit is.
  const snap = (v: number, o: number): number => o + roundPx(v - o);
  const shape = roundedShape(snap(x, sox) / LU_PX, snap(y, soy) / LU_PX, snap(x + w, sox) / LU_PX, snap(y + h, soy) / LU_PX, w / LU_PX, h / LU_PX, [border.top / LU_PX, border.right / LU_PX, border.bottom / LU_PX, border.left / LU_PX], lengths, dpr, NO_RADIUS_FAULTS);
  const outer: number[] = [];
  for (let i = 0; i < 8; i++) outer.push(radiusAt(shape, i));
  return hasRoundedCorner(outer) ? shape : [];
}

function boxNodes(s: TableState, b: LayoutBox, parent: number, orders: Map<string, number> | null, target: number, inherited: PointerEvents, ox: number, oy: number, sox: number, soy: number): void {
  const i = s.nodes.length;
  let pe = inherited;
  let own = target;
  let act = false;
  let lengths: readonly RadiusLength[] = [];
  const r = rectOf(s, b.id);
  let paint: HitPaint = { context: false, transformed: false, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  if (b.boxType !== 'anonymous') {
    const f = s.facts.get(b.id);
    if (f === undefined) throw new HitError(`no hit facts for element ${b.id}`);
    pe = s.faults.pointerEventsNotInherited && f.inherited ? 'auto' : f.pointerEvents;
    own = i;
    act = f.activation;
    lengths = f.radii;
    paint = paintOf(b.id, f, r, s.dpr, ox, oy, sox, soy, s.faults);
  }
  if (own < 0) throw new HitError(`anonymous box ${b.id} has no element ancestor`);
  const border = resolveBorder(zoomedBox(s, b.id).style, s.ctx.devicePixelRatio);
  const order = orders === null ? undefined : orders.get(b.id);
  const rounds = paint.transformed && !(paint.scaleX === 1 && paint.scaleY === 1);
  const snapX0 = rounds ? r.x : sox;
  const snapY0 = rounds ? r.y : soy;
  pushNode(s, {
    kind: 'box', parent, target: own, x: r.x, y: r.y, width: r.width, height: r.height, clips: clipsBothAxes(b.style),
    borderTop: border.top, borderRight: border.right, borderBottom: border.bottom, borderLeft: border.left, layer: b.style.position !== 'static',
    absolute: b.style.position === 'absolute', fixed: b.style.position === 'fixed', atomic: orders !== null, order: order === undefined ? 0 : order,
    layerOrder: orders !== null && b.style.position !== 'absolute' ? b.style.order : 0, line: -1,
    inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: pe, radii: roundedOf(r.x, r.y, r.width, r.height, border, lengths, s.dpr, snapX0, snapY0),
    context: paint.context, transformed: paint.transformed, scaleX: paint.scaleX, scaleY: paint.scaleY, offsetX: paint.offsetX, offsetY: paint.offsetY,
  }, b.id, act);
  const sx = paint.transformed ? r.x : ox;
  const sy = paint.transformed ? r.y : oy;
  const leaves: TextLeaf[] = [];
  let kids = 0;
  for (const child of b.children) {
    const c = child.kind === 'control' ? hitControlBox(child) : child;
    if (c.kind === 'text') leaves.push(c);
    else if (c.kind === 'inline' || c.kind === 'br') throw new HitError(inlineRefusal(c.id, c.kind));
    else if ((c.kind === 'box' || c.kind === 'replaced') && isAtomicInline(c)) throw new HitError(atomicRefusal(c.id));
    else if ((c.kind === 'box' || c.kind === 'replaced') && c.style.float !== 'none' && c.style.position !== 'absolute' && c.style.position !== 'fixed' && (b.style.display === 'block' || b.style.display === 'inline-block')) throw new HitError(floatRefusal(c.id));
    else kids++;
  }
  if (leaves.length > 0 && kids > 0) throw new HitError(`${b.id} mixes text and boxes; the compiler wraps text in anonymous boxes`);
  if (leaves.length > 0) inlineNodes(s, b, i, own, pe, leaves, lengths, snapX0, snapY0);
  const childOrders = b.style.display === 'flex' ? fragmentOrders(s, b) : b.style.display === 'grid' ? gridOrders(s, b) : null;
  for (const c of b.children) {
    if (c.kind === 'box') boxNodes(s, c, i, childOrders, own, pe, sx, sy, snapX0, snapY0);
    else if (c.kind === 'control') boxNodes(s, hitControlBox(c), i, childOrders, own, pe, sx, sy, snapX0, snapY0);
    else if (c.kind === 'replaced') replacedNode(s, c, i, childOrders, sx, sy, snapX0, snapY0);
  }
}

/** css-overflow-3 §3: a scroll container (at rest) and clip on both axes clip hits to the padding box. */
function clipsBothAxes(style: LayoutStyle): boolean {
  return isScrollContainer(style) || (style.overflowX === 'clip' && style.overflowY === 'clip');
}

/**
 * A replaced element (img, iframe; REPL-a): a box with no descendants, hit on its border box. Blink hit-tests a block-level
 * replaced box like any block child (BoxFragmentPainter::HitTestBlockChildren; a flex item is painted atomically), and a point
 * inside an iframe's content box returns the iframe element itself to the outer document's elementFromPoint.
 */
function replacedNode(s: TableState, c: ReplacedLeaf, parent: number, orders: Map<string, number> | null, ox: number, oy: number, sox: number, soy: number): void {
  const f = s.facts.get(c.id);
  if (f === undefined) throw new HitError(`no hit facts for replaced element ${c.id}`);
  const pe = s.faults.pointerEventsNotInherited && f.inherited ? 'auto' : f.pointerEvents;
  const r = rectOf(s, c.id);
  const style = s.zoomedReplaced.get(c.id);
  if (style === undefined) throw new HitError(`no zoomed replaced element ${c.id}`);
  const border = resolveBorder(style, s.ctx.devicePixelRatio);
  const order = orders === null ? undefined : orders.get(c.id);
  const paint = paintOf(c.id, f, r, s.dpr, ox, oy, sox, soy, s.faults);
  pushNode(s, {
    kind: 'box', parent, target: s.nodes.length, x: r.x, y: r.y, width: r.width, height: r.height, clips: c.style.overflowX === 'hidden',
    borderTop: border.top, borderRight: border.right, borderBottom: border.bottom, borderLeft: border.left, layer: c.style.position !== 'static',
    absolute: c.style.position === 'absolute', fixed: c.style.position === 'fixed', atomic: orders !== null, order: order === undefined ? 0 : order,
    layerOrder: orders !== null && c.style.position !== 'absolute' ? c.style.order : 0, line: -1,
    inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: pe, radii: roundedOf(r.x, r.y, r.width, r.height, border, f.radii, s.dpr, paint.transformed && !(paint.scaleX === 1 && paint.scaleY === 1) ? r.x : sox, paint.transformed && !(paint.scaleX === 1 && paint.scaleY === 1) ? r.y : soy),
    context: paint.context, transformed: paint.transformed, scaleX: paint.scaleX, scaleY: paint.scaleY, offsetX: paint.offsetX, offsetY: paint.offsetY,
  }, c.id, f.activation);
}

function inlineRefusal(id: string, kind: 'inline' | 'br'): string {
  return `${id} is ${kind === 'br' ? 'a <br>' : 'an inline box'}, which the hit table does not model yet (INL1a; no Chrome hit capture)`;
}

/**
 * FORM-a: Chrome retargets a hit on a control's UA shadow parts (a range's thumb and track, a button's contents) to the control
 * element, which the hit table does not model, and no Chrome hit capture covers a control.
 */
function controlRefusal(id: string): string {
  return `${id} is a form control, which the hit table does not model yet (FORM-a; Chrome retargets its parts to the control, no Chrome hit capture)`;
}

/** Whether the hit table models a control: a button, a select, a text field or a textarea; a range (its touch, T064 P7), a fieldset and a legend not yet. */
function hitModelsControl(c: ControlBox): boolean {
  return c.control.kind === 'button-block' || c.control.kind === 'select-menulist' || c.control.kind === 'text-field' || c.control.kind === 'text-area';
}

/** A control the hit table models as its box: a button with its children, a select, text field or textarea as one box, since Chrome retargets its UA shadow parts to it. */
function hitControlBox(c: ControlBox): LayoutBox {
  if (!hitModelsControl(c)) throw new HitError(controlRefusal(c.id));
  if (c.control.kind === 'button-block') return controlAsBox(c);
  const none: (LayoutBox | ControlBox | ReplacedLeaf | InlineChild)[] = [];
  return { kind: 'box', id: c.id, boxType: c.boxType, style: c.style, strut: c.strut, marker: null, children: none };
}

function isAtomicInline(b: LayoutBox | ReplacedLeaf): boolean {
  const d = b.style.display;
  if (b.kind === 'replaced') return d === 'inline' || d === 'inline-block' || d === 'inline-flex';
  return d === 'inline-block' || d === 'inline-flex' || d === 'inline-grid';
}

function floatRefusal(id: string): string {
  return `${id} is a float, which the hit table does not model yet (FLT; no Chrome hit capture)`;
}

function atomicRefusal(id: string): string {
  return `${id} is an atomic inline, which the hit table does not model yet (INL2a and G-INL: inline-block, inline-flex and inline-grid on their lines; no Chrome hit capture)`;
}

/**
 * TXT2-g: Chrome hit tests the content past a -webkit-line-clamp clamp point by rules not measured yet. That content stays
 * hittable in Chrome 145 (Blink hides it, LineClampData::IsHidden, only under the CSSLineClamp runtime feature), and in
 * line-clamp-nested the hit table matches Chrome on n4c's text and at n4's right edge in the 1 px band above n4's clip edge
 * (y 85 to 86, n4c laid out past the clamp point from y 86), but between them (x 20 to 27.5) Chrome names n4b under n4c's
 * background where the hit table names n4c. Until that band is measured the hit lane refuses a line-clamp container by name.
 */
function clampRefusal(id: string): string {
  return `${id} clamps its lines (-webkit-line-clamp), and Chrome hit tests the content past the clamp point by rules the hit table does not model yet (TXT2-g)`;
}

function boxHitRefusal(b: LayoutBox): string | null {
  for (const child of b.children) {
    if (child.kind === 'control' && !hitModelsControl(child)) return controlRefusal(child.id);
    const c = child.kind === 'control' ? hitControlBox(child) : child;
    if (c.kind === 'inline' || c.kind === 'br') return inlineRefusal(c.id, c.kind);
    if (c.kind === 'replaced' && isAtomicInline(c)) return atomicRefusal(c.id);
    if ((c.kind === 'box' || c.kind === 'replaced') && c.style.float !== 'none' && c.style.position !== 'absolute' && c.style.position !== 'fixed' && (b.style.display === 'block' || b.style.display === 'inline-block')) return floatRefusal(c.id);
    if (c.kind === 'box') {
      if (c.style.lineClamp > 0) return clampRefusal(c.id);
      if (isAtomicInline(c)) return atomicRefusal(c.id);
      const r = boxHitRefusal(c);
      if (r !== null) return r;
    }
  }
  return null;
}

/**
 * Why hitTableOf refuses an engine input, or null when it models it: an inline box or a <br> (INL1a), an atomic inline (INL2a), a
 * line-clamp container (TXT2-g), a range, a fieldset and a legend (FORM-a) have no hit model yet.
 */
export function hitRefusal(input: LayoutInput): string | null {
  return boxHitRefusal(input.root);
}

/** The input as layout resolved it, with the caller's measurer; a refusal there is a HitError, as the layout's own is. */
function hitZoomed(input: LayoutInput, measurer: TextMeasurer): LayoutInput {
  try {
    return resolvedInput(input, measurer, NO_ENGINE_FAULTS);
  } catch (e) {
    if (e instanceof UnsupportedSignal) throw new HitError(`the engine refused the input (${e.unsupported.code} at ${e.unsupported.nodeId})`);
    throw e;
  }
}

/** The hit table of an engine input at its device scale, from the engine's own layout of it and the compiler's hit facts. */
export function hitTableOf(input: LayoutInput, measurer: TextMeasurer, facts: ReadonlyMap<string, HitFact>, faults: HitTableFaults): HitTable {
  // The named refusal comes first, so a case is refused for what hitRefusal names, not for whatever the walk meets before it
  // (line-clamp-lines' walk meets l7's Ahem p glyphs over several lines first).
  const refused = hitRefusal(input);
  if (refused !== null) throw new HitError(refused);
  const out = layout(input, measurer);
  if (out.kind !== 'ok') throw new HitError(`the engine refused the input (${out.unsupported.code} at ${out.unsupported.nodeId})`);
  const zoomed = hitZoomed(input, measurer);
  const zmap = new Map<string, LayoutBox>();
  const rmap = new Map<string, LayoutStyle>();
  indexZoomed(zmap, rmap, zoomed.root);
  const s: TableState = { nodes: [], ids: [], activation: [], abs: absoluteRects(out.boxes), boxes: out.boxes, zoomed: zmap, zoomedReplaced: rmap, ctx: { measurer, devicePixelRatio: zoomed.devicePixelRatio, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS }, dpr: input.devicePixelRatio, facts, faults };
  boxNodes(s, input.root, -1, null, -1, 'auto', 0, 0, 0, 0);
  return { nodes: s.nodes, ids: s.ids, activation: s.activation };
}

// ---------------------------------------------------------------------------------------------------------------------
// The derived grid and the encoded answers (the host lane, the vectors and the device-hit lane all read these).

/** One grid point in LU. */
export type HitPoint = { readonly x: number; readonly y: number };

function addAxis(out: number[], a: number, b: number): void {
  const values = [a - LU_PX - 1, a - LU_PX, a - LU_PX + 1, a - LU_PX / 2, a + LU_PX / 2, floorOf((a + b) / 2), b - LU_PX / 2, b - 1, b, b + LU_PX / 2, b + 1];
  for (const v of values) out.push(v);
}

/** The bound a transformed space's corner points are taken within before they are mapped to the root's viewport. */
const LOCAL_EXTENT = 1073741824;

/** An edge (LU, absolute as laid out) of a node in a space, mapped up every transform to the root's space and rounded to LU. */
function edgeInRoot(nodes: readonly HitNode[], spaces: HitSpaces, space: number, horizontal: boolean, v: number): number {
  let at = v;
  let k = space;
  while (k > 0) {
    const b = nodes[spaces.boxes[k - 1] as number];
    const up = spaces.containers[k - 1];
    if (b === undefined || up === undefined) throw new HitError(`no transformed box for space ${k}`);
    const from = horizontal ? b.x : b.y;
    const mapped = froundOf(froundOf(((at - from) / LU_PX) * (horizontal ? b.scaleX : b.scaleY)) + (horizontal ? b.offsetX : b.offsetY));
    const c = up === 0 ? undefined : nodes[spaces.boxes[up - 1] as number];
    at = mapped * LU_PX + (c === undefined ? 0 : horizontal ? c.x : c.y);
    k = up;
  }
  return roundOf(at);
}

/** addAxis over the edges a and b of a node's space, mapped to the root's (a scale below 0 swaps them). */
function addMappedAxis(out: number[], nodes: readonly HitNode[], spaces: HitSpaces, space: number, horizontal: boolean, a: number, b: number): void {
  if (space === 0) {
    addAxis(out, a, b);
    return;
  }
  const p = edgeInRoot(nodes, spaces, space, horizontal, a);
  const q = edgeInRoot(nodes, spaces, space, horizontal, b);
  addAxis(out, p < q ? p : q, p < q ? q : p);
}

function cross(out: HitPoint[], xs: readonly number[], ys: readonly number[], width: number, height: number): void {
  for (const x of xs) {
    for (const y of ys) {
      // elementFromPoint answers only points whose rounded position is inside the viewport (a gate before the hit test).
      if (x < 0 || y < 0 || x >= width - LU_PX / 2 || y >= height - LU_PX / 2) continue;
      out.push({ x, y });
    }
  }
}

/** Every whole-px point, and the LU just before it, from one px before a to one px after b. */
function addSpan(out: number[], a: number, b: number): void {
  for (let v = floorOf(a / LU_PX) * LU_PX - LU_PX; v <= b + LU_PX; v += LU_PX) {
    out.push(v - 1);
    out.push(v);
  }
}

/** For a rounded box, the points along each rounded corner's arc of its snapped border box and of its snapped padding edge. */
function addCorners(out: HitPoint[], n: HitNode, width: number, height: number): void {
  if (n.radii.length === 0) return;
  for (let pass = 0; pass < 2; pass++) {
    const left = pass === 0 ? roundPx(n.x) : roundPx(n.x + n.borderLeft);
    const top = pass === 0 ? roundPx(n.y) : roundPx(n.y + n.borderTop);
    const right = pass === 0 ? roundPx(n.x + n.width) : roundPx(n.x + n.width - n.borderRight);
    const bottom = pass === 0 ? roundPx(n.y + n.height) : roundPx(n.y + n.height - n.borderBottom);
    for (let k = 0; k < 4; k++) {
      const rw = radiusAt(n.radii, pass * 8 + k) * LU_PX;
      const rh = radiusAt(n.radii, pass * 8 + 4 + k) * LU_PX;
      if (rw <= 0 || rh <= 0) continue;
      const west = k === 0 || k === 3;
      const north = k === 0 || k === 1;
      const cx = west ? left + rw : right - rw;
      const cy = north ? top + rh : bottom - rh;
      const xs: number[] = [];
      const ys: number[] = [];
      if (west) addSpan(xs, left, left + rw);
      else addSpan(xs, right - rw, right);
      if (north) addSpan(ys, top, top + rh);
      else addSpan(ys, bottom - rh, bottom);
      // Only the pixels the arc crosses decide a hit; the rest of the corner square is the box's or its parent's either way.
      for (const x of xs) {
        if (floorOf(x / LU_PX) * LU_PX !== x) continue;
        // A pixel hits when its 1 px box reaches the arc, so the crossing is read at its edge nearest the corner's centre.
        const t = arcRatio(x + (west ? LU_PX : 0) - cx, rw);
        arcBand(out, [x], cy + (north ? -1 : 1) * rh * sqrt64(1 - t * t), 'y', width, height);
      }
      for (const y of ys) {
        if (floorOf(y / LU_PX) * LU_PX !== y) continue;
        const t = arcRatio(y + (north ? LU_PX : 0) - cy, rh);
        arcBand(out, [y], cx + (west ? -1 : 1) * rw * sqrt64(1 - t * t), 'x', width, height);
      }
    }
  }
}

/** |d| / r, at most 1: how far across a corner a point sits. */
function arcRatio(d: number, r: number): number {
  const t = (d < 0 ? -d : d) / r;
  return t > 1 ? 1 : t;
}

/** The whole px at and either side of an arc's crossing at v on one axis, each with its 1 LU neighbour, crossed with the other axis' points. */
function arcBand(out: HitPoint[], others: readonly number[], v: number, axis: 'x' | 'y', width: number, height: number): void {
  const at = floorOf(v / LU_PX) * LU_PX;
  const band: number[] = [];
  for (let d = -LU_PX; d <= LU_PX; d += LU_PX) {
    band.push(at + d - 1);
    band.push(at + d);
  }
  if (axis === 'y') cross(out, others, band, width, height);
  else cross(out, band, others, width, height);
}

/**
 * The derived grid of a table in LU, inside a viewport of width x height LU: for each rect, around each edge's exclusive boundary
 * (a point p hits [a, b) when a - 1 px < p < b) and inclusive boundary, half a pixel either side of each edge and the centre,
 * crossed per rect; for text the snapped rect too, for a line the block's snapped border box at the line, and for a rounded box
 * the whole px along each rounded corner's arc. Sorted by y then x, without repeats.
 */
export function hitGrid(t: HitTable, width: number, height: number): HitPoint[] {
  const all: HitPoint[] = [];
  const spaces = hitSpaces(t.nodes);
  t.nodes.forEach((n, i) => {
    if (n.width <= 0 && n.height <= 0 && n.kind !== 'line') return;
    const space = spaces.of[i];
    if (space === undefined) throw new HitError(`no space for hit node ${i}`);
    const xs: number[] = [];
    const ys: number[] = [];
    addMappedAxis(xs, t.nodes, spaces, space, true, n.x, n.x + n.width);
    addMappedAxis(ys, t.nodes, spaces, space, false, n.y, n.y + n.height);
    cross(all, xs, ys, width, height);
    if (space === 0) addCorners(all, n, width, height);
    else {
      const local: HitPoint[] = [];
      addCorners(local, n, LOCAL_EXTENT, LOCAL_EXTENT);
      for (const p of local) cross(all, [edgeInRoot(t.nodes, spaces, space, true, p.x)], [edgeInRoot(t.nodes, spaces, space, false, p.y)], width, height);
    }
    if (n.kind === 'text') {
      const sx: number[] = [];
      const sy: number[] = [];
      addMappedAxis(sx, t.nodes, spaces, space, true, roundPx(n.x), roundPx(n.x + n.width));
      addMappedAxis(sy, t.nodes, spaces, space, false, roundPx(n.y), roundPx(n.y + n.height));
      cross(all, sx, sy, width, height);
    }
    if (n.kind === 'line') {
      const block = t.nodes[n.parent];
      if (block === undefined) throw new HitError(`line ${i} has no block`);
      const lx: number[] = [];
      const ly: number[] = [];
      addMappedAxis(lx, t.nodes, spaces, space, true, roundPx(n.x), roundPx(n.x + block.width));
      addMappedAxis(ly, t.nodes, spaces, space, false, roundPx(n.y), roundPx(n.y + block.height));
      cross(all, lx, ly, width, height);
    }
  });
  const sorted = all.slice(0).sort((p, q) => (p.y === q.y ? p.x - q.x : p.y - q.y));
  const out: HitPoint[] = [];
  for (const p of sorted) {
    const last = out.length > 0 ? out[out.length - 1] : undefined;
    if (last !== undefined && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  return out;
}

/** The answers at every grid point, run-length encoded as "<id> <count>;" runs, in grid order (the device-hit record). */
export function hitRuns(t: HitTable, grid: readonly HitPoint[], faults: HitFaults): string {
  const prepared = prepareHit(t.nodes, faults);
  let out = '';
  let prev = '';
  let count = 0;
  for (const p of grid) {
    const id = t.ids[hitAt(prepared, p.x, p.y)];
    if (id === undefined) throw new HitError('a hit outside the table');
    if (count > 0 && id === prev) {
      count++;
      continue;
    }
    if (count > 0) out = `${out}${prev} ${count.toString(16)};`;
    prev = id;
    count = 1;
  }
  if (count > 0) out = `${out}${prev} ${count.toString(16)};`;
  return out;
}
