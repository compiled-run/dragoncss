// Dashed and dotted borders as Chrome 145 paints them, in device px (P6a, notes/T008-p5-review.md): a port of Blink
// 145.0.7632.6 BoxBorderPainter's complex side path for boxes without radii (core/paint/box_border_painter.cc: ComplexBorderInfo
// :1145-1215, PaintOpacityGroup :1523-1567, PaintSide :1569-1649, ComputeMiter :1651-1694, PaintOneBorderSide :1696-1751,
// ClipBorderSidePolygon :2006-2437, DrawLineForBoxSide :900-956, DrawDoubleBoxSide :647-752, DrawSolidBoxSide :839-898,
// DrawDashedOrDottedBoxSide :561-596, DrawLineWithStyle :500-559, EnforceDotsAtEndpoints :398-498), StyledStrokeData's dash
// selection (platform/graphics/styled_stroke_data.cc:40-131), BorderEdge (core/style/border_edge.cc) and the geometry Skia
// 2ab8add5 makes of a dashed line (src/utils/SkDashPath.cpp CalcDashParameters, InternalFilter and SpecialLineRec). The result is
// data: the drawing operations of one box's border, which both native backends draw. Float steps use fround.
import { floorOf, froundOf, roundOf, truncOf } from './rt-easing.ts';

/** Planted faults (P6a); the Chrome pixel oracle and the device pixel lane must catch each one. */
export type DashFaults = {
  /** The dash pattern starts 1 device px into its first interval (Skia phase 1, not Blink's 0). */
  readonly phase1: boolean;
  /** Dashes and round dots keep the nominal gap instead of SelectBestDashGap's fitted one. */
  readonly gapUnfitted: boolean;
};

export const NO_DASH_FAULTS: DashFaults = { phase1: false, gapUnfitted: false };

export type BorderOpKind = 'begin-layer' | 'end-layer' | 'save' | 'restore' | 'clip' | 'fill' | 'dot';

/**
 * One drawing operation in device px. fill: the polygon points (x, y pairs) in the side's colour at alpha; dot: a circle
 * (cx, cy, radius) in the side's colour at alpha; clip: intersect the clip with the polygon; save and restore bracket clips;
 * begin-layer and end-layer bracket a transparency layer of the given alpha. side is the colour's side (0 top, 1 right, 2 bottom,
 * 3 left), -1 for operations without colour.
 */
export type BorderOp = {
  readonly op: BorderOpKind;
  readonly side: number;
  readonly alpha: number;
  readonly antialias: boolean;
  readonly points: readonly number[];
};

const TOP = 0;
const RIGHT = 1;
const BOTTOM = 2;
const LEFT = 3;

type Miter = 'none' | 'soft' | 'hard';

/** A side as BorderEdge holds it: device px width, the effective style and the RGBA8 colour. */
type DashEdge = { width: number; style: string; readonly r: number; readonly g: number; readonly b: number; readonly a: number };

function f32(v: number): number {
  return froundOf(v);
}

/** C++ int division of ints (truncates toward zero). */
function idiv(a: number, b: number): number {
  return truncOf(a / b);
}

/** C++ a % b of non-negative ints. */
function imod(a: number, b: number): number {
  return a - b * floorOf(a / b);
}

function absNum(v: number): number {
  return v < 0 ? -v : v;
}

function maxNum(a: number, b: number): number {
  return a > b ? a : b;
}

function at(xs: readonly number[], i: number): number {
  const v = xs[i];
  if (v === undefined) throw new Error(`paint-dash: no value at ${i}`);
  return v;
}

/** The EBorderStyle enum value (computed_style_constants.h): only its order matters here. */
function styleRank(style: string): number {
  if (style === 'none') return 0;
  if (style === 'hidden') return 1;
  if (style === 'dotted') return 6;
  if (style === 'dashed') return 7;
  if (style === 'solid') return 8;
  if (style === 'double') return 9;
  throw new Error(`paint-dash: border style ${style} has no side painter`);
}

/** BorderEdge::EffectiveStyle for the styles Dragon lowers: double under 3 device px is solid. */
function effectiveStyle(style: string, width: number): string {
  return style === 'double' && width < 3 ? 'solid' : style;
}

function isDottedOrDashed(style: string): boolean {
  return style === 'dotted' || style === 'dashed';
}

/** BorderEdge::HasVisibleColorAndStyle. */
function visible(e: DashEdge): boolean {
  return styleRank(e.style) > 1 && e.a !== 0;
}

/** BorderEdge::ShouldRender (every side is present in a box's border). */
function shouldRender(e: DashEdge): boolean {
  return e.width !== 0 && visible(e);
}

function sharesColor(a: DashEdge, b: DashEdge): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function edgeAt(edges: readonly DashEdge[], side: number): DashEdge {
  const e = edges[side];
  if (e === undefined) throw new Error(`paint-dash: no side ${side}`);
  return e;
}

/** A Blink Color's alpha from an RGBA8 alpha. */
function alphaOf(e: DashEdge): number {
  return f32(e.a / 255);
}

/** The side priority of ComplexBorderInfo's sort (box_border_painter.cc:369-374). */
function sidePriority(side: number): number {
  if (side === TOP) return 0;
  if (side === RIGHT) return 2;
  if (side === BOTTOM) return 1;
  return 3;
}

/** kStylePriority (box_border_painter.cc:354-365). */
function stylePriority(style: string): number {
  if (style === 'solid') return 3;
  if (style === 'dotted' || style === 'dashed' || style === 'double') return 1;
  return 0;
}

/**
 * Whether this file paints the box: a visible side is dashed or dotted, or every visible side is solid (T116: same-colour solid
 * sides meet with no miter, as ComputeMiter rules, and Blink's uniform fast path fills the same pixels). A visible double side
 * without a dashed or dotted one stays on the native band painter.
 */
export function borderNeedsSidePainter(widths: readonly number[], styles: readonly string[], colors: readonly number[]): boolean {
  let any = false;
  let allSolid = true;
  for (let side = 0; side < 4; side++) {
    const e = makeEdge(widths, styles, colors, side);
    if (!shouldRender(e)) continue;
    if (isDottedOrDashed(e.style)) return true;
    any = true;
    if (e.style !== 'solid') allSolid = false;
  }
  return any && allSolid;
}

function makeEdge(widths: readonly number[], styles: readonly string[], colors: readonly number[], side: number): DashEdge {
  const s = styles[side];
  if (s === undefined) throw new Error(`paint-dash: no style for side ${side}`);
  const w = at(widths, side);
  return { width: w, style: effectiveStyle(s, w), r: at(colors, 4 * side), g: at(colors, 4 * side + 1), b: at(colors, 4 * side + 2), a: at(colors, 4 * side + 3) };
}

type DashPainter = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /** The inner (padding-box) rect: the outer rect less the used widths (PixelSnappedContouredInnerBorder without radii). */
  readonly innerLeft: number;
  readonly innerTop: number;
  readonly innerRight: number;
  readonly innerBottom: number;
  readonly edges: readonly DashEdge[];
  readonly faults: DashFaults;
  readonly out: BorderOp[];
};

/**
 * The drawing operations of one box's border (BoxBorderPainter::Paint's complex path) in device px: the outer border box
 * (integer device px), the side widths (whole device px, top right bottom left), the side styles and the side colours (RGBA8,
 * four numbers per side). Empty when no side renders. Boxes with radii are not modelled (PNT1).
 */
export function borderPaintOps(left: number, top: number, right: number, bottom: number, widths: readonly number[], styles: readonly string[], colors: readonly number[], faults: DashFaults): BorderOp[] {
  const out: BorderOp[] = [];
  const edges: DashEdge[] = [];
  for (let side = 0; side < 4; side++) edges.push(makeEdge(widths, styles, colors, side));
  let count = 0;
  for (let side = 0; side < 4; side++) if (shouldRender(edgeAt(edges, side))) count++;
  if (count === 0 || right <= left || bottom <= top) return out;
  const innerLeft = left + edgeAt(edges, LEFT).width;
  const innerTop = top + edgeAt(edges, TOP).width;
  const innerRight = right - edgeAt(edges, RIGHT).width;
  const innerBottom = bottom - edgeAt(edges, BOTTOM).width;
  // The border width never exceeds the border box (BoxBorderPainter's constructor, ClampWidth).
  clampWidth(edgeAt(edges, TOP), bottom - top);
  clampWidth(edgeAt(edges, RIGHT), right - left);
  clampWidth(edgeAt(edges, BOTTOM), bottom - top);
  clampWidth(edgeAt(edges, LEFT), right - left);
  const p: DashPainter = { left, top, right, bottom, innerLeft, innerTop, innerRight, innerBottom, edges, faults, out };
  const groups = opacityGroups(p);
  paintOpacityGroup(p, groups, 0, 1);
  return out;
}

function clampWidth(e: DashEdge, max: number): void {
  if (e.width > max) {
    e.width = max;
    e.style = effectiveStyle(e.style, max);
  }
}

type DashOpacityGroup = { readonly alpha: number; readonly sides: number[] };

/** ComplexBorderInfo: the visible sides sorted by alpha, style priority and side priority, grouped by alpha. */
function opacityGroups(p: DashPainter): DashOpacityGroup[] {
  const sorted: number[] = [];
  let visibleCount = 0;
  for (let side = 0; side < 4; side++) if (shouldRender(edgeAt(p.edges, side))) visibleCount++;
  for (let pos = 0; pos < visibleCount; pos++) {
    for (let side = 0; side < 4; side++) {
      if (!shouldRender(edgeAt(p.edges, side))) continue;
      let before = 0;
      for (let other = 0; other < 4; other++) if (other !== side && shouldRender(edgeAt(p.edges, other)) && sidesBefore(p, other, side)) before++;
      if (before === pos) sorted.push(side);
    }
  }
  const groups: DashOpacityGroup[] = [];
  let current = 0;
  for (const side of sorted) {
    const a = alphaOf(edgeAt(p.edges, side));
    if (a !== current) {
      groups.push({ alpha: a, sides: [] });
      current = a;
    }
    const g = groups[groups.length - 1];
    if (g === undefined) throw new Error('paint-dash: no opacity group');
    g.sides.push(side);
  }
  return groups;
}

function sidesBefore(p: DashPainter, a: number, b: number): boolean {
  const ea = edgeAt(p.edges, a);
  const eb = edgeAt(p.edges, b);
  const aa = alphaOf(ea);
  const ab = alphaOf(eb);
  if (aa !== ab) return aa < ab;
  const sa = stylePriority(ea.style);
  const sb = stylePriority(eb.style);
  if (sa !== sb) return sa < sb;
  return sidePriority(a) < sidePriority(b);
}

function includesAdjacentEdges(sides: readonly number[]): boolean {
  let horizontal = false;
  let vertical = false;
  for (const s of sides) {
    if (s === TOP || s === BOTTOM) horizontal = true;
    else vertical = true;
  }
  return horizontal && vertical;
}

/** PaintOpacityGroup: layers in decreasing opacity, sides in increasing opacity; returns the completed sides. */
/** A mutable flag: whether a side is completed (painted, or not rendered). */
type DashDone = { v: boolean };

function doneAt(completed: readonly DashDone[], side: number): boolean {
  const d = completed[side];
  if (d === undefined) throw new Error(`paint-dash: no side ${side}`);
  return d.v;
}

function paintOpacityGroup(p: DashPainter, groups: readonly DashOpacityGroup[], index: number, effectiveOpacity: number): DashDone[] {
  if (index >= groups.length) {
    const done: DashDone[] = [];
    for (let side = 0; side < 4; side++) done.push({ v: !shouldRender(edgeAt(p.edges, side)) });
    return done;
  }
  const group = groups[groups.length - index - 1];
  if (group === undefined) throw new Error('paint-dash: no opacity group');
  let paintAlpha = f32(group.alpha / effectiveOpacity);
  let opacity = effectiveOpacity;
  const needsLayer = group.alpha !== 1 && (includesAdjacentEdges(group.sides) || index + 1 < groups.length);
  if (needsLayer) {
    p.out.push({ op: 'begin-layer', side: -1, alpha: f32(group.alpha / effectiveOpacity), antialias: false, points: [] });
    opacity = group.alpha;
    paintAlpha = 1;
  }
  const completed = paintOpacityGroup(p, groups, index + 1, opacity);
  for (const side of group.sides) {
    paintSide(p, side, paintAlpha, completed);
    const d = completed[side];
    if (d !== undefined) d.v = true;
  }
  if (needsLayer) p.out.push({ op: 'end-layer', side: -1, alpha: 1, antialias: false, points: [] });
  return completed;
}

/** PaintSide and PaintOneBorderSide for a straight side (no radii). */
function paintSide(p: DashPainter, side: number, alpha: number, completed: readonly DashDone[]): void {
  const e = edgeAt(p.edges, side);
  let x1 = p.left;
  let y1 = p.top;
  let x2 = p.right;
  let y2 = p.bottom;
  if (side === TOP) y2 = p.top + e.width;
  else if (side === BOTTOM) y1 = p.bottom - e.width;
  else if (side === LEFT) x2 = p.left + e.width;
  else x1 = p.right - e.width;
  const adj1 = side === TOP || side === BOTTOM ? LEFT : TOP;
  const adj2 = side === TOP || side === BOTTOM ? RIGHT : BOTTOM;
  let miter1 = computeMiter(p, side, adj1, completed);
  let miter2 = computeMiter(p, side, adj2, completed);
  const clip = miter1 === 'hard' || miter2 === 'hard' || ((miter1 !== 'none' || miter2 !== 'none') && isDottedOrDashed(e.style));
  if (clip) {
    p.out.push({ op: 'save', side: -1, alpha: 1, antialias: false, points: [] });
    clipBorderSidePolygon(p, side, miter1, miter2);
    miter1 = 'none';
    miter2 = 'none';
  }
  drawLineForBoxSide(p, x1, y1, x2, y2, side, alpha, e.style, miter1 !== 'none' ? edgeAt(p.edges, adj1).width : 0, miter2 !== 'none' ? edgeAt(p.edges, adj2).width : 0);
  if (clip) p.out.push({ op: 'restore', side: -1, alpha: 1, antialias: false, points: [] });
}

/** ComputeMiter (box_border_painter.cc:1651-1680). */
function computeMiter(p: DashPainter, side: number, adjacent: number, completed: readonly DashDone[]): Miter {
  const adj = edgeAt(p.edges, adjacent);
  if (adj.width === 0) return 'none';
  // WillOverdraw: the adjacent side is still to be drawn and fills its whole band.
  if (!doneAt(completed, adjacent) && !(isDottedOrDashed(adj.style) || adj.style === 'double')) return 'none';
  const e = edgeAt(p.edges, side);
  if (!(shouldRender(adj) && sharesColor(e, adj))) return 'soft';
  // BorderStylesRequireMiter for the styles Dragon lowers.
  if (e.style === 'double' || adj.style === 'double') return 'hard';
  if (isDottedOrDashed(e.style) !== isDottedOrDashed(adj.style)) return 'hard';
  if (e.style !== adj.style) return 'hard';
  return 'none';
}

function push2(pts: number[], x: number, y: number): void {
  pts.push(x);
  pts.push(y);
}

/** gfx::LineF(p1, p2).IntersectionWith({q1, q2}), or the fallback when the lines are parallel. */
function intersect(p1x: number, p1y: number, p2x: number, p2y: number, q1x: number, q1y: number, q2x: number, q2y: number, fx: number, fy: number): number[] {
  const ax = f32(p2x - p1x);
  const ay = f32(p2y - p1y);
  const bx = f32(q2x - q1x);
  const by = f32(q2y - q1y);
  const denom = f32(ax * by - ay * bx);
  if (denom === 0) return [fx, fy];
  const cx = f32(q1x - p1x);
  const cy = f32(q1y - p1y);
  const param = f32((cx * by - cy * bx) / denom);
  return [f32(p1x + f32(ax * param)), f32(p1y + f32(ay * param))];
}

/** ClipBorderSidePolygon for a box without radii (box_border_painter.cc:2006-2437). */
function clipBorderSidePolygon(p: DashPainter, side: number, m1: Miter, m2: Miter): void {
  const ox = [p.left, p.right, p.right, p.left];
  const oy = [p.top, p.top, p.bottom, p.bottom];
  const ix = [p.innerLeft, p.innerRight, p.innerRight, p.innerLeft];
  const iy = [p.innerTop, p.innerTop, p.innerBottom, p.innerBottom];
  const ext = f32(0.1);
  let first = m1;
  let second = m2;
  // edge_quad: outer, inner, inner, outer.
  let q: number[] = [];
  let b1x = 0;
  let b1y = 0;
  let b2x = 0;
  let b2y = 0;
  let ex = 0;
  let ey = 0;
  if (side === TOP) {
    q = [at(ox, 0), at(oy, 0), at(ix, 0), at(iy, 0), at(ix, 1), at(iy, 1), at(ox, 1), at(oy, 1)];
    b1x = at(q, 0);
    b1y = at(q, 3);
    b2x = at(q, 6);
    b2y = at(q, 5);
    ex = -ext;
  } else if (side === LEFT) {
    first = m2;
    second = m1;
    q = [at(ox, 3), at(oy, 3), at(ix, 3), at(iy, 3), at(ix, 0), at(iy, 0), at(ox, 0), at(oy, 0)];
    b1x = at(q, 2);
    b1y = at(q, 1);
    b2x = at(q, 4);
    b2y = at(q, 7);
    ey = ext;
  } else if (side === BOTTOM) {
    first = m2;
    second = m1;
    q = [at(ox, 2), at(oy, 2), at(ix, 2), at(iy, 2), at(ix, 3), at(iy, 3), at(ox, 3), at(oy, 3)];
    b1x = at(q, 0);
    b1y = at(q, 3);
    b2x = at(q, 6);
    b2y = at(q, 5);
    ex = ext;
  } else {
    q = [at(ox, 1), at(oy, 1), at(ix, 1), at(iy, 1), at(ix, 2), at(iy, 2), at(ox, 2), at(oy, 2)];
    b1x = at(q, 2);
    b1y = at(q, 1);
    b2x = at(q, 4);
    b2y = at(q, 7);
    ey = -ext;
  }
  if (first === second) {
    p.out.push({ op: 'clip', side: -1, alpha: 1, antialias: first === 'soft', points: q });
    return;
  }
  if (first !== 'none') {
    const c = intersect(at(q, 0), at(q, 1), at(q, 2), at(q, 3), b1x, b1y, b2x, b2y, 0, 0);
    const pts: number[] = [];
    push2(pts, f32(at(q, 0) + ex), f32(at(q, 1) + ey));
    push2(pts, f32(at(c, 0) + ex), f32(at(c, 1) + ey));
    push2(pts, b2x, b2y);
    push2(pts, at(q, 6), at(q, 7));
    p.out.push({ op: 'clip', side: -1, alpha: 1, antialias: first === 'soft', points: pts });
  }
  if (second !== 'none') {
    const c = intersect(at(q, 4), at(q, 5), at(q, 6), at(q, 7), b1x, b1y, b2x, b2y, 0, 0);
    const pts: number[] = [];
    push2(pts, at(q, 0), at(q, 1));
    push2(pts, b1x, b1y);
    push2(pts, f32(at(c, 0) - ex), f32(at(c, 1) - ey));
    push2(pts, f32(at(q, 6) - ex), f32(at(q, 7) - ey));
    p.out.push({ op: 'clip', side: -1, alpha: 1, antialias: second === 'soft', points: pts });
  }
}

function fillRect(p: DashPainter, side: number, alpha: number, l: number, t: number, r: number, b: number, antialias: boolean): void {
  p.out.push({ op: 'fill', side, alpha, antialias, points: [l, t, r, t, r, b, l, b] });
}

/** DrawLineForBoxSide (box_border_painter.cc:900-956) for the styles Dragon lowers. */
function drawLineForBoxSide(p: DashPainter, x1: number, y1: number, x2: number, y2: number, side: number, alpha: number, style: string, adj1: number, adj2: number): void {
  const horizontal = side === TOP || side === BOTTOM;
  const thickness = horizontal ? y2 - y1 : x2 - x1;
  const length = horizontal ? x2 - x1 : y2 - y1;
  if (length <= 0 || thickness <= 0) return;
  const s = effectiveStyle(style, thickness);
  if (isDottedOrDashed(s)) drawDashedOrDottedBoxSide(p, x1, y1, x2, y2, side, alpha, thickness, s);
  else if (s === 'double') drawDoubleBoxSide(p, x1, y1, x2, y2, length, side, alpha, thickness, adj1, adj2);
  else drawSolidBoxSide(p, x1, y1, x2, y2, side, alpha, adj1, adj2);
}

/** DrawSolidBoxSide (box_border_painter.cc:839-898). */
function drawSolidBoxSide(p: DashPainter, x1: number, y1: number, x2: number, y2: number, side: number, alpha: number, adj1: number, adj2: number): void {
  if (adj1 === 0 && adj2 === 0) {
    fillRect(p, side, alpha, x1, y1, x2, y2, true);
    return;
  }
  const pts: number[] = [];
  if (side === TOP) {
    push2(pts, x1 + maxNum(-adj1, 0), y1);
    push2(pts, x1 + maxNum(adj1, 0), y2);
    push2(pts, x2 - maxNum(adj2, 0), y2);
    push2(pts, x2 - maxNum(-adj2, 0), y1);
  } else if (side === BOTTOM) {
    push2(pts, x1 + maxNum(adj1, 0), y1);
    push2(pts, x1 + maxNum(-adj1, 0), y2);
    push2(pts, x2 - maxNum(-adj2, 0), y2);
    push2(pts, x2 - maxNum(adj2, 0), y1);
  } else if (side === LEFT) {
    push2(pts, x1, y1 + maxNum(-adj1, 0));
    push2(pts, x1, y2 - maxNum(-adj2, 0));
    push2(pts, x2, y2 - maxNum(adj2, 0));
    push2(pts, x2, y1 + maxNum(adj1, 0));
  } else {
    push2(pts, x1, y1 + maxNum(adj1, 0));
    push2(pts, x1, y2 - maxNum(adj2, 0));
    push2(pts, x2, y2 - maxNum(-adj2, 0));
    push2(pts, x2, y1 + maxNum(-adj1, 0));
  }
  p.out.push({ op: 'fill', side, alpha, antialias: true, points: pts });
}

/** DrawDoubleBoxSide (box_border_painter.cc:647-752). */
function drawDoubleBoxSide(p: DashPainter, x1: number, y1: number, x2: number, y2: number, length: number, side: number, alpha: number, thickness: number, adj1: number, adj2: number): void {
  const third = idiv(thickness + 1, 3);
  if (adj1 === 0 && adj2 === 0) {
    if (side === TOP || side === BOTTOM) {
      fillRect(p, side, alpha, x1, y1, x1 + length, y1 + third, true);
      fillRect(p, side, alpha, x1, y2 - third, x1 + length, y2, true);
    } else {
      fillRect(p, side, alpha, x1, y1, x1 + third, y1 + length, true);
      fillRect(p, side, alpha, x2 - third, y1, x2, y1 + length, true);
    }
    return;
  }
  const big1 = idiv(adj1 > 0 ? adj1 + 1 : adj1 - 1, 3);
  const big2 = idiv(adj2 > 0 ? adj2 + 1 : adj2 - 1, 3);
  const o1 = maxNum(idiv(-adj1 * 2 + 1, 3), 0);
  const o2 = maxNum(idiv(-adj2 * 2 + 1, 3), 0);
  const i1 = maxNum(idiv(adj1 * 2 + 1, 3), 0);
  const i2 = maxNum(idiv(adj2 * 2 + 1, 3), 0);
  if (side === TOP) {
    drawLineForBoxSide(p, x1 + o1, y1, x2 - o2, y1 + third, side, alpha, 'solid', big1, big2);
    drawLineForBoxSide(p, x1 + i1, y2 - third, x2 - i2, y2, side, alpha, 'solid', big1, big2);
  } else if (side === LEFT) {
    drawLineForBoxSide(p, x1, y1 + o1, x1 + third, y2 - o2, side, alpha, 'solid', big1, big2);
    drawLineForBoxSide(p, x2 - third, y1 + i1, x2, y2 - i2, side, alpha, 'solid', big1, big2);
  } else if (side === BOTTOM) {
    drawLineForBoxSide(p, x1 + i1, y1, x2 - i2, y1 + third, side, alpha, 'solid', big1, big2);
    drawLineForBoxSide(p, x1 + o1, y2 - third, x2 - o2, y2, side, alpha, 'solid', big1, big2);
  } else {
    drawLineForBoxSide(p, x1, y1 + i1, x1 + third, y2 - i2, side, alpha, 'solid', big1, big2);
    drawLineForBoxSide(p, x2 - third, y1 + o1, x2, y2 - o2, side, alpha, 'solid', big1, big2);
  }
}

/** DrawDashedOrDottedBoxSide: the stroke runs along the band's middle (integer division) across the whole outer side. */
function drawDashedOrDottedBoxSide(p: DashPainter, x1: number, y1: number, x2: number, y2: number, side: number, alpha: number, thickness: number, style: string): void {
  if (side === TOP || side === BOTTOM) {
    const midY = y1 + idiv(thickness, 2);
    drawLineWithStyle(p, x1, midY, x2, midY, thickness, style, side, alpha);
  } else {
    const midX = x1 + idiv(thickness, 2);
    drawLineWithStyle(p, midX, y1, midX, y2, thickness, style, side, alpha);
  }
}

/** A dash pattern (DashDescription): two intervals and the cap; round caps draw dots. */
type DashPattern = { readonly on: number; readonly off: number; readonly round: boolean };

/** SelectBestDashGap (styled_stroke_data.cc:40-57) for an open path. */
export function selectBestDashGap(strokeLength: number, dashLength: number, gapLength: number): number {
  const available = f32(strokeLength + gapLength);
  const minDashes = floorOf(f32(available / f32(dashLength + gapLength)));
  const maxDashes = minDashes + 1;
  const minGaps = minDashes - 1;
  const maxGaps = maxDashes - 1;
  const minGap = f32(f32(strokeLength - f32(minDashes * dashLength)) / minGaps);
  const maxGap = f32(f32(strokeLength - f32(maxDashes * dashLength)) / maxGaps);
  return maxGap <= 0 || absNum(f32(minGap - gapLength)) < absNum(f32(maxGap - gapLength)) ? minGap : maxGap;
}

/** DashEffectFromStrokeStyle (styled_stroke_data.cc:81-131) for an open path; null draws a plain line. */
function dashEffect(width: number, style: string, pathLength: number, faults: DashFaults): DashPattern | null {
  if (style === 'dashed' || width <= 3) {
    let dash = width;
    let gap = width;
    if (style === 'dashed') {
      dash = f32(dash * (width >= 3 ? 2 : 3));
      gap = f32(gap * (width >= 3 ? 1 : 2));
    }
    if (pathLength <= f32(dash * 2)) return null;
    const two = f32(f32(2 * dash) + gap);
    if (pathLength <= two) {
      const m = f32(pathLength / two);
      return { on: f32(dash * m), off: f32(gap * m), round: false };
    }
    const fitted = style === 'dashed' && !faults.gapUnfitted ? selectBestDashGap(pathLength, dash, gap) : gap;
    return { on: dash, off: fitted, round: false };
  }
  const perDot = width * 2;
  if (pathLength < perDot) return { on: 0, off: perDot, round: true };
  const gap = faults.gapUnfitted ? width : selectBestDashGap(pathLength, width, width);
  return { on: 0, off: f32(f32(gap + width) - f32(0.01)), round: true };
}

/** EnforceDotsAtEndpoints (box_border_painter.cc:398-498): whole end dots for dotted lines 3 device px thick or less. */
/** A line's two end points, moved by the dotted-line adjustments. */
type DashLine = { x1: number; y1: number; x2: number; y2: number };

function enforceDotsAtEndpoints(p: DashPainter, pts: DashLine, length: number, width: number, vertical: boolean, side: number, alpha: number): void {
  const mod4 = imod(length, 4);
  const mod6 = imod(length, 6);
  let useStart = false;
  let startGrowth = 0;
  let startOffset = 0;
  let useEnd = false;
  let endGrowth = 0;
  if ((width === 1 && imod(length, 2) === 0) || (width === 3 && mod6 === 0)) {
    useStart = true;
    startGrowth = 1;
    startOffset = 1;
  }
  if ((width === 2 && (mod4 === 0 || mod4 === 1)) || (width === 3 && (mod6 === 1 || mod6 === 2))) {
    useStart = true;
    startOffset = -1;
  }
  if ((width === 2 && mod4 === 0) || (width === 3 && mod6 === 1)) useEnd = true;
  if ((width === 2 && mod4 === 3) || (width === 3 && (mod6 === 4 || mod6 === 5))) {
    useStart = true;
    startOffset = 1;
  }
  if (width === 3 && mod6 === 5) useEnd = true;
  else if (width === 3 && mod6 === 0) {
    useEnd = true;
    endGrowth = 1;
  }
  const half = idiv(width, 2);
  if (useStart) {
    const x = pts.x1;
    const y = pts.y1;
    if (vertical) {
      fillRect(p, side, alpha, x - half, y, x + width - half, y + width + startGrowth, false);
      pts.y1 = y + (2 * width + startOffset);
    } else {
      fillRect(p, side, alpha, x, y - half, x + width + startGrowth, y + width - half, false);
      pts.x1 = x + (2 * width + startOffset);
    }
  }
  if (useEnd) {
    const x = pts.x2;
    const y = pts.y2;
    if (vertical) {
      fillRect(p, side, alpha, x - half, y - width - endGrowth, x + width - half, y, false);
      pts.y2 = y - (width + endGrowth + 1);
    } else {
      fillRect(p, side, alpha, x - width - endGrowth, y - half, x, y + width - half, false);
      pts.x2 = x - (width + endGrowth + 1);
    }
  }
}

/** DrawLineWithStyle (box_border_painter.cc:500-559), then the line as Skia strokes it. */
function drawLineWithStyle(p: DashPainter, x1: number, y1: number, x2: number, y2: number, thickness: number, style: string, side: number, alpha: number): void {
  const vertical = x1 === x2;
  const width = roundOf(thickness);
  const length = x2 - x1 + (y2 - y1);
  const dash = dashEffect(width, style, length, p.faults);
  const pts: DashLine = { x1, y1, x2, y2 };
  if (style === 'dotted') {
    if (width <= 3) enforceDotsAtEndpoints(p, pts, length, width, vertical, side, alpha);
    else if (vertical) {
      pts.y1 = f32(pts.y1 + f32(width / 2));
      pts.y2 = f32(pts.y2 - f32(width / 2));
    } else {
      pts.x1 = f32(pts.x1 + f32(width / 2));
      pts.x2 = f32(pts.x2 - f32(width / 2));
    }
  }
  if (imod(width, 2) === 1) {
    if (vertical) {
      pts.x1 = f32(pts.x1 + 0.5);
      pts.x2 = f32(pts.x2 + 0.5);
    } else {
      pts.y1 = f32(pts.y1 + 0.5);
      pts.y2 = f32(pts.y2 + 0.5);
    }
  }
  strokeLine(p, pts.x1, pts.y1, pts.x2, pts.y2, thickness, dash, side, alpha);
}

/** SkDashPath's CalcDashParameters find_first_interval: the first interval's index and remaining length at a phase. */
function firstInterval(on: number, off: number, phase: number): number[] {
  let ph = phase;
  const intervals = [on, off];
  for (let i = 0; i < 2; i++) {
    const gap = at(intervals, i);
    if (ph > gap || (ph === gap && gap !== 0)) ph = f32(ph - gap);
    else return [i, f32(gap - ph)];
  }
  return [0, on];
}

/**
 * The stroke of one axis-aligned line p0 to p1 of width w: a plain stroke is one rect; a dash pattern gives a rect per dash
 * (SkDashPath InternalFilter with SpecialLineRec, phase 0, distances in double) or a round dot per zero-length dash.
 */
function strokeLine(p: DashPainter, x0: number, y0: number, x1: number, y1: number, w: number, dash: DashPattern | null, side: number, alpha: number): void {
  const dx = f32(x1 - x0);
  const dy = f32(y1 - y0);
  const length = absNum(dx) + absNum(dy);
  if (length === 0) return;
  const inv = f32(1 / length);
  const tx = f32(dx * inv);
  const ty = f32(dy * inv);
  const half = f32(w / 2);
  // SkPointPriv::RotateCCW(tangent) scaled to half the stroke width.
  const nx = f32(ty * half);
  const ny = f32(-tx * half);
  const segment = (d0: number, d1: number): void => {
    const e = d1 > length ? length : d1;
    const ax = f32(x0 + f32(tx * d0));
    const bx = f32(x0 + f32(tx * e));
    const ay = f32(y0 + f32(ty * d0));
    const by = f32(y0 + f32(ty * e));
    p.out.push({ op: 'fill', side, alpha, antialias: true, points: [f32(ax + nx), f32(ay + ny), f32(bx + nx), f32(by + ny), f32(bx - nx), f32(by - ny), f32(ax - nx), f32(ay - ny)] });
  };
  if (dash === null) {
    segment(0, length);
    return;
  }
  const first = firstInterval(dash.on, dash.off, p.faults.phase1 ? 1 : 0);
  let index = at(first, 0);
  let dlen = at(first, 1);
  let distance = 0;
  while (distance < length) {
    if (index === 0) {
      if (dash.round) {
        // A zero-length segment stroked with round caps: a dot of the stroke width at the SkContourMeasure position.
        const t = f32(f32(distance) / length);
        p.out.push({ op: 'dot', side, alpha, antialias: true, points: [f32(x0 + f32(dx * t)), f32(y0 + f32(dy * t)), half] });
      } else segment(f32(distance), f32(distance + dlen));
    }
    distance = distance + dlen;
    index = index === 0 ? 1 : 0;
    dlen = index === 0 ? dash.on : dash.off;
  }
}
