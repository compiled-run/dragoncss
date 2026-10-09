// Scrollable overflow and the client sizes of scroll containers and the viewport (css-overflow-3 §2.2 and §3), with a zero
// scrollbar gutter. A port of Blink 145.0.7632.6: core/layout/scrollable_overflow_calculator.cc (whole file) and
// core/layout/scrollable_overflow_calculator.h (AddChild, AddOverflow), and the inflow bounds of core/layout/box_fragment_builder.cc
// lines 241-366. The scroll rect follows css-overflow-3 §2.2 and matches Chrome (ports.json reference:
// core/paint/paint_layer_scrollable_area.cc lines 968-982). The layout itself is unchanged: this reads the input and the layout's boxes.
import type { Direction, LayoutBox, LayoutInput, ReplacedLeaf } from './input.ts';
import type { LU } from './units.ts';
import { add, clampNegativeToZero, fromCssPx, max, min, sub, ZERO } from './units.ts';
import type { Edges } from './box.ts';
import { blockMinMaxWith, hasPercent, INDEFINITE, isScrollContainer, resolveBorder, resolveMarginWith, resolvePaddingWith, sumEdges } from './box.ts';
import type { Ctx, EngineFaults, Strut } from './block.ts';
import { directionOf, EMPTY_STRUT, NO_ENGINE_FAULTS } from './block.ts';
import type { LayoutRect } from './layout.ts';
import { absoluteRects, layoutMeasurer, layoutWithFaults, resolvedInput } from './layout.ts';
import { UnsupportedSignal } from './unsupported.ts';
import { placeLines } from './inline.ts';
import { isOutOfFlow, relativeOffsetWith } from './position.ts';
import type { TextMeasurer } from './text.ts';

/** A rectangle in LU relative to a box's border-box top-left. */
export type OverflowRect = { readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

/**
 * One scroll container: clientWidth and clientHeight are its padding box (the border box less its borders, with no gutter), and
 * scrollRect its scrollable overflow rect united with its client box (Blink overflow_rect_), whose size is scrollWidth and
 * scrollHeight, all in zoomed LU.
 */
export type ScrollMetrics = { readonly id: string; readonly clientWidth: LU; readonly clientHeight: LU; readonly scrollRect: OverflowRect };

/**
 * viewport: the initial containing block's scroll container (Blink LayoutView), id "viewport". containers: every box that is a
 * scroll container, in input preorder. refused: the layout was unsupported (detail starts with its code), or a case this port
 * does not decide.
 */
export type ScrollMetricsResult =
  | { readonly kind: 'ok'; readonly viewport: ScrollMetrics; readonly containers: readonly ScrollMetrics[] }
  | { readonly kind: 'refused'; readonly nodeId: string; readonly detail: string };

/** A case the scrollable overflow port does not decide. */
export class OverflowRefusal extends Error {
  readonly nodeId: string;
  readonly detail: string;
  constructor(nodeId: string, detail: string) {
    super(`${nodeId}: ${detail}`);
    this.nodeId = nodeId;
    this.detail = detail;
  }
}

/** Planted fault gutterReserved: a classic scrollbar's 15 CSS px, taken from the inline-end and block-end of every scroll container. */
const PLANTED_GUTTER_PX = 15;

/**
 * The scroll metrics of a layout. viewportDirection is the direction the viewport takes (Blink propagates it from body, or from
 * the root element when there is no body), which the compiler writes; it decides which side the viewport's overflow may extend.
 */
export function scrollMetrics(input: LayoutInput, measurer: TextMeasurer, viewportDirection: Direction): ScrollMetricsResult {
  return scrollMetricsWithFaults(input, measurer, viewportDirection, NO_ENGINE_FAULTS);
}

/** The nodes this port reads: indexOf refuses a form control (FORM-a), whose scrollable overflow it does not decide. */
type OverflowNode = LayoutBox | ReplacedLeaf;

/** What the port reads about one box: its node (a box or a replaced leaf), DOM parent, absolute border box and resolved edges. */
type Node = {
  readonly box: OverflowNode;
  readonly parent: LayoutBox | null;
  readonly rect: LayoutRect;
  readonly border: Edges;
  readonly padding: Edges;
  /** The inline size the box's percentage margins and padding resolve against. */
  readonly cbInline: LU;
};

type Index = {
  readonly ctx: Ctx;
  readonly nodes: Map<string, Node>;
  readonly order: OverflowNode[];
  /** The absolutely positioned boxes by the id of their containing block ("" for the initial containing block). */
  readonly oofByCb: Map<string, OverflowNode[]>;
  readonly flows: Map<string, Flow>;
};

/** scrollMetrics with planted engine faults; only the parity harness's planted tests pass anything but NO_ENGINE_FAULTS. */
export function scrollMetricsWithFaults(given: LayoutInput, measurer: TextMeasurer, viewportDirection: Direction, faults: EngineFaults): ScrollMetricsResult {
  const r = layoutWithFaults(given, measurer, faults);
  if (r.kind !== 'ok') return { kind: 'refused', nodeId: r.unsupported.nodeId, detail: `${r.unsupported.code}: ${r.unsupported.detail}` };
  const m = layoutMeasurer(measurer, faults);
  try {
    // The input as the layout above resolved it, with the caller's measurer.
    const input = resolvedInput(given, measurer, faults);
    const ctx: Ctx = { measurer: m, devicePixelRatio: input.devicePixelRatio, faults };
    const ix = indexOf(ctx, input, absoluteRects(r.boxes));
    const containers: ScrollMetrics[] = [];
    for (const b of ix.order) {
      if (!isScrollContainer(b.style)) continue;
      const n = nodeOf(ix, b.id);
      const client = clientOf(ix, n);
      containers.push(metricsOf(b.id, overflowOf(ix, n), client));
    }
    return { kind: 'ok', viewport: viewportMetrics(ix, input, viewportDirection), containers };
  } catch (e) {
    if (e instanceof OverflowRefusal) return { kind: 'refused', nodeId: e.nodeId, detail: e.detail };
    if (e instanceof UnsupportedSignal) return { kind: 'refused', nodeId: e.unsupported.nodeId, detail: `${e.unsupported.code}: ${e.unsupported.detail}` };
    throw e;
  }
}

function nodeOf(ix: Index, id: string): Node {
  const n = ix.nodes.get(id);
  if (n === undefined) throw new Error(`no laid-out box ${id}`);
  return n;
}

function indexOf(ctx: Ctx, input: LayoutInput, abs: Map<string, LayoutRect>): Index {
  const ix: Index = { ctx, nodes: new Map(), order: [], oofByCb: new Map(), flows: new Map() };
  const icbWidth = fromCssPx(input.viewport.width);
  const walk = (b: OverflowNode, parent: LayoutBox | null, cbInline: LU, positioned: OverflowNode | null): void => {
    const rect = abs.get(b.id);
    if (rect === undefined) throw new Error(`no laid-out box ${b.id}`);
    const border = resolveBorder(b.style, ctx.devicePixelRatio);
    const padding = resolvePaddingWith(b.style, cbInline, ctx.faults);
    ix.nodes.set(b.id, { box: b, parent, rect, border, padding, cbInline });
    ix.order.push(b);
    const content = clampNegativeToZero(sub(rect.width, sumEdges(border.left, border.right, padding.left, padding.right)));
    const paddingBoxWidth = clampNegativeToZero(sub(rect.width, add(border.left, border.right)));
    const nextPositioned = b.style.position === 'static' ? positioned : b;
    // A replaced leaf has no children (its fallback content never renders).
    if (b.kind === 'replaced') return;
    for (const k of b.children) {
      if (k.kind === 'control') throw new OverflowRefusal(k.id, 'a form control: its scrollable overflow is not decided here');
      if (k.kind !== 'box' && k.kind !== 'replaced') continue;
      if (isOutOfFlow(ctx, k)) {
        // CSS2 §10.1: the containing block is the padding box of the nearest positioned ancestor, or the initial one.
        const cb = nextPositioned;
        const key = cb === null ? '' : cb.id;
        const list = ix.oofByCb.get(key);
        if (list === undefined) ix.oofByCb.set(key, [k]);
        else list.push(k);
        walk(k, b, cb === null ? icbWidth : cb === b ? paddingBoxWidth : paddingBoxWidthOf(ix, cb), nextPositioned);
      } else {
        walk(k, b, content, nextPositioned);
      }
    }
  };
  walk(input.root, null, icbWidth, null);
  return ix;
}

function paddingBoxWidthOf(ix: Index, b: OverflowNode): LU {
  const n = nodeOf(ix, b.id);
  return clampNegativeToZero(sub(n.rect.width, add(n.border.left, n.border.right)));
}

/** The gutter the planted fault gutterReserved takes from a scroll container, or 0. */
function gutterOf(ix: Index, box: OverflowNode): LU {
  return ix.ctx.faults.gutterReserved && isScrollContainer(box.style) ? fromCssPx(PLANTED_GUTTER_PX) : ZERO;
}

/** Blink LayoutBox::ClientWidth and ClientHeight: the border box less borders and scrollbars, clamped at 0. */
function clientOf(ix: Index, n: Node): OverflowRect {
  const g = gutterOf(ix, n.box);
  return {
    x: n.border.left,
    y: n.border.top,
    width: clampNegativeToZero(sub(sub(n.rect.width, add(n.border.left, n.border.right)), g)),
    height: clampNegativeToZero(sub(sub(n.rect.height, add(n.border.top, n.border.bottom)), g)),
  };
}

/** css-overflow-3 §2.2: the scrollable overflow united with the client size at its offset (the scrollport is part of it); matches Chrome. */
function metricsOf(id: string, overflow: OverflowRect, client: OverflowRect): ScrollMetrics {
  const withClient = unite(overflow, { x: overflow.x, y: overflow.y, width: client.width, height: client.height });
  return { id, clientWidth: client.width, clientHeight: client.height, scrollRect: withClient };
}

// ---------------------------------------------------------------- rectangles (Blink PhysicalRect)

const isEmpty = (r: OverflowRect): boolean => r.width <= 0 || r.height <= 0;
const right = (r: OverflowRect): LU => add(r.x, r.width);
const bottom = (r: OverflowRect): LU => add(r.y, r.height);

function span(left: LU, top: LU, r: LU, b: LU): OverflowRect {
  return { x: left, y: top, width: sub(r, left), height: sub(b, top) };
}

/** PhysicalRect::UniteEvenIfEmpty: the bounding rect, empty rects included. */
function uniteEvenIfEmpty(a: OverflowRect, b: OverflowRect): OverflowRect {
  return span(min(a.x, b.x), min(a.y, b.y), max(right(a), right(b)), max(bottom(a), bottom(b)));
}

/** PhysicalRect::Unite: an empty rect adds nothing. */
function unite(a: OverflowRect, b: OverflowRect): OverflowRect {
  if (isEmpty(b)) return a;
  if (isEmpty(a)) return b;
  return uniteEvenIfEmpty(a, b);
}

function shifted(r: OverflowRect, dx: LU, dy: LU): OverflowRect {
  return { x: add(r.x, dx), y: add(r.y, dy), width: r.width, height: r.height };
}

// ---------------------------------------------------------------- the calculator

/** One ScrollableOverflowCalculator: the overflow so far, and what AdjustOverflowForScrollOrigin and Result read. */
type Calc = {
  overflow: OverflowRect;
  inflow: OverflowRect | null;
  readonly paddingRect: OverflowRect;
  readonly scrollContainer: boolean;
  readonly leftOverflow: boolean;
  readonly topOverflow: boolean;
};

/** Whether a box's overflow may extend past its left and its top edge. */
type OverflowSides = { readonly left: boolean; readonly top: boolean };

/**
 * LayoutBox::HasLeftOverflow and HasTopOverflow in horizontal-tb: the sides a box's overflow may extend past. A block box overflows
 * to the left in rtl and never to the top. A flex container overrides both (Blink LayoutFlexibleBox's GetOverflowConverter): its
 * overflow starts at its main-start and cross-start, so row-reverse moves the inline start, column-reverse the block start, and
 * wrap-reverse the cross start; the logical sides then map to physical ones by direction.
 */
function overflowSides(ix: Index, b: OverflowNode): OverflowSides {
  const rtl = directionOf(ix.ctx, b) === 'rtl';
  if (b.kind === 'replaced' || b.style.display !== 'flex') return { left: rtl, top: false };
  const s = b.style;
  const column = s.flexDirection === 'column' || s.flexDirection === 'column-reverse';
  const reverse = s.flexDirection === 'row-reverse' || s.flexDirection === 'column-reverse';
  const wrapReverse = s.flexWrap === 'wrap-reverse';
  // Whether the overflow extends past the inline start and the block start (by default only past the ends).
  const inlineStart = column ? wrapReverse : reverse;
  const blockStart = column ? reverse : wrapReverse;
  return { left: rtl ? !inlineStart : inlineStart, top: blockStart };
}

/** AdjustOverflowForScrollOrigin: a scroll container's overflow never extends before its scroll origin, on either axis. */
function adjustForScrollOrigin(c: Calc, r: OverflowRect): OverflowRect {
  const p = c.paddingRect;
  const left = c.leftOverflow ? min(right(p), r.x) : max(p.x, r.x);
  const rr = c.leftOverflow ? min(right(p), right(r)) : max(p.x, right(r));
  const top = c.topOverflow ? min(bottom(p), r.y) : max(p.y, r.y);
  const bb = c.topOverflow ? min(bottom(p), bottom(r)) : max(p.y, bottom(r));
  return span(left, top, rr, bb);
}

/** AddOverflow: an empty rect adds nothing. */
function addOverflow(c: Calc, r: OverflowRect): void {
  const a = c.scrollContainer ? adjustForScrollOrigin(c, r) : r;
  if (!isEmpty(a)) c.overflow = uniteEvenIfEmpty(c.overflow, a);
}

function addInflow(c: Calc, r: OverflowRect): void {
  c.inflow = c.inflow === null ? r : uniteEvenIfEmpty(c.inflow, r);
}

/** Result: a scroll container's inflow bounds grow by its end padding (planted fault overflowIgnoresPadding drops it). */
function resultOf(ix: Index, c: Calc, padding: Edges): OverflowRect {
  const inflow = c.inflow;
  if (inflow === null || !c.scrollContainer) return c.overflow;
  const keep = ix.ctx.faults.overflowIgnoresPadding;
  const r = span(
    sub(inflow.x, keep ? ZERO : padding.left),
    sub(inflow.y, keep ? ZERO : padding.top),
    add(right(inflow), keep ? ZERO : padding.right),
    add(bottom(inflow), keep ? ZERO : padding.bottom),
  );
  return uniteEvenIfEmpty(c.overflow, adjustForScrollOrigin(c, r));
}

/** The scrollable overflow of a box relative to its border box (RecalculateScrollableOverflowForFragment). */
function overflowOf(ix: Index, n: Node): OverflowRect {
  const b = n.box;
  const g = gutterOf(ix, b);
  const paddingRect: OverflowRect = {
    x: n.border.left,
    y: n.border.top,
    width: clampNegativeToZero(sub(sub(n.rect.width, add(n.border.left, n.border.right)), g)),
    height: clampNegativeToZero(sub(sub(n.rect.height, add(n.border.top, n.border.bottom)), g)),
  };
  const sc = isScrollContainer(b.style);
  const sides = overflowSides(ix, b);
  const c: Calc = { overflow: paddingRect, inflow: null, paddingRect, scrollContainer: sc, leftOverflow: sides.left, topOverflow: sides.top };
  // A replaced leaf (CSS 2.2 §10.3.2) has no children: its scrollable overflow is its own padding box.
  if (b.kind === 'replaced') return resultOf(ix, c, n.padding);
  if (hasInlineContent(b)) {
    refuseLineLevelBoxes(b);
    addLines(ix, n, b, c);
  }
  for (const k of b.children) {
    if ((k.kind !== 'box' && k.kind !== 'replaced') || isOutOfFlow(ix.ctx, k)) continue;
    const kn = nodeOf(ix, k.id);
    const dx = sub(kn.rect.x, n.rect.x);
    const dy = sub(kn.rect.y, n.rect.y);
    addOverflow(c, shifted(propagated(ix, kn), dx, dy));
    if (sc) addInflow(c, inflowBounds(ix, n, kn, dx, dy));
  }
  const oofs = ix.oofByCb.get(b.id);
  if (oofs !== undefined) {
    for (const k of oofs) {
      const kn = nodeOf(ix, k.id);
      addOverflow(c, shifted(propagated(ix, kn), sub(kn.rect.x, n.rect.x), sub(kn.rect.y, n.rect.y)));
    }
  }
  return resultOf(ix, c, n.padding);
}

/**
 * ScrollableOverflowForPropagation: a child's border box, united with its own overflow unless it clips both axes (a scroll
 * container, or clip on both axes with its 0px clip margin at the padding box); a clip axis keeps the border box on that axis.
 */
function propagated(ix: Index, n: Node): OverflowRect {
  const own: OverflowRect = { x: ZERO, y: ZERO, width: n.rect.width, height: n.rect.height };
  const s = n.box.style;
  // ScrollableOverflowForPropagation: a replaced box adds its border box (its content is never scrollable overflow).
  if (n.box.kind === 'replaced' || isScrollContainer(s) || (s.overflowX === 'clip' && s.overflowY === 'clip')) return own;
  let child = overflowOf(ix, n);
  if (s.overflowX === 'clip') child = { x: ZERO, y: child.y, width: n.rect.width, height: child.height };
  if (s.overflowY === 'clip') child = { x: child.x, y: ZERO, width: child.width, height: n.rect.height };
  return uniteEvenIfEmpty(own, child);
}

/**
 * The PlacedLine fields addLines accounts for (R16): a new line item kind is added here with a Chrome metrics case, never skipped.
 * boxes, boxRects, breaks and breakRects are empty on every line addLines sees, as refuseLineLevelBoxes refuses inline boxes and <br>s.
 */
export const PLACED_LINE_FIELDS: readonly string[] = ['top', 'height', 'baseline', 'pieces', 'boxes', 'boxRects', 'breaks', 'breakRects'];

/** Whether a box's children form an inline formatting context (placeLines): it has a text, inline box or <br> child. */
function hasInlineContent(box: LayoutBox): boolean {
  return box.children.some((k) => k.kind === 'text' || k.kind === 'inline' || k.kind === 'br');
}

/**
 * R16: a box or replaced child of an inline formatting context (INL2's atomic inlines) is a line item addLines does not place, so
 * the scrollable overflow refuses it rather than measuring it as a block child; whichever of OVFL and INL2 lands second adds it.
 */
export function refuseLineLevelBoxes(box: LayoutBox): void {
  if (!hasInlineContent(box)) return;
  for (const k of box.children) {
    if (k.kind === 'box' || k.kind === 'replaced') throw new OverflowRefusal(k.id, `an atomic inline in the inline formatting context of ${box.id}: its scrollable overflow is not decided here (R16, INL2)`);
    // INL1a's inline box fragments and <br>s are line items addLines does not measure (ScrollableOverflowForLine adds them).
    if (k.kind === 'inline') throw new OverflowRefusal(k.id, `an inline box in the inline formatting context of ${box.id}: its scrollable overflow is not decided here (R16, INL1a)`);
    if (k.kind === 'br') throw new OverflowRefusal(k.id, `a <br> in the inline formatting context of ${box.id}: its scrollable overflow is not decided here (R16, INL1a)`);
  }
}

/** The line boxes and text fragments of an inline formatting context (AddItemsInternal); lines are inflow children. */
function addLines(ix: Index, n: Node, box: LayoutBox, c: Calc): void {
  const ox = add(n.border.left, n.padding.left);
  const oy = add(n.border.top, n.padding.top);
  const content = clampNegativeToZero(sub(n.rect.width, sumEdges(n.border.left, n.border.right, n.padding.left, n.padding.right)));
  for (const line of placeLines(ix.ctx, box, content)) {
    let first = true;
    let l = ZERO;
    let r = ZERO;
    const take = (x: LU, w: LU): void => {
      l = first ? x : min(l, x);
      r = first ? add(x, w) : max(r, add(x, w));
      first = false;
    };
    for (const p of line.pieces) take(p.x, p.width);
    const lineRect: OverflowRect = { x: add(ox, l), y: add(oy, line.top), width: sub(r, l), height: line.height };
    if (!isEmpty(lineRect)) c.overflow = uniteEvenIfEmpty(c.overflow, lineRect);
    if (c.scrollContainer) addInflow(c, lineRect);
    for (const p of line.pieces) addOverflow(c, { x: add(ox, p.x), y: add(oy, p.top), width: p.width, height: add(p.ascent, p.descent) });
  }
}

/**
 * BoxFragmentBuilder::AddChild's inflow bounds of an in-flow child of a scroll container: its border box at its offset without the
 * relative offset, grown by its margins as Blink computes them from style (auto is 0). On each axis the margin on the side the
 * container's overflow extends past (overflowSides: the end by default) is clamped at minus the child's size and the other at 0.
 * In block flow the block-end margin is the child's end margin strut with its own block-end margin appended.
 */
function inflowBounds(ix: Index, p: Node, k: Node, dx: LU, dy: LU): OverflowRect {
  const s = k.box.style;
  const cb = contentWidthOf(p);
  const direction = directionOf(ix.ctx, p.box);
  if (s.position === 'relative' && (hasPercentInset(s.top) || hasPercentInset(s.bottom))) {
    throw new OverflowRefusal(k.box.id, 'a relative offset with a percentage top or bottom inside a scroll container: its basis is not decided here');
  }
  const rel = relativeOffsetWith(k.box, cb, INDEFINITE, direction, ix.ctx.faults);
  const x = sub(dx, rel.dx);
  const y = sub(dy, rel.dy);
  const f = ix.ctx.faults;
  const ml = resolveMarginWith(s.marginLeft, cb, f).value;
  const mr = resolveMarginWith(s.marginRight, cb, f).value;
  const mt = resolveMarginWith(s.marginTop, cb, f).value;
  const mb = resolveMarginWith(s.marginBottom, cb, f).value;
  let blockEnd = mb;
  if (p.box.style.display === 'block') {
    const flow = flowOf(ix, p);
    const end = flow.ends.get(k.box.id);
    if (end === undefined) throw new Error(`no end margin strut for ${k.box.id}`);
    const withOwn = joinMargin(end.strut, mb);
    blockEnd = end.selfCollapsing ? sub(collapsed(withOwn), collapsed(end.strut)) : collapsed(withOwn);
  }
  const w = k.rect.width;
  const h = k.rect.height;
  const sides = overflowSides(ix, p.box);
  const left = sides.left ? max(ml, sub(ZERO, w)) : clampNegativeToZero(ml);
  const rightM = sides.left ? clampNegativeToZero(mr) : max(mr, sub(ZERO, w));
  const top = sides.top ? max(mt, sub(ZERO, h)) : clampNegativeToZero(mt);
  const bottomM = sides.top ? clampNegativeToZero(blockEnd) : max(blockEnd, sub(ZERO, h));
  return span(sub(x, left), sub(y, top), add(add(x, w), rightM), add(add(y, h), bottomM));
}

function hasPercentInset(v: LayoutBox['style']['top']): boolean {
  return v.kind !== 'auto' && hasPercent(v);
}

function contentWidthOf(n: Node): LU {
  return clampNegativeToZero(sub(n.rect.width, sumEdges(n.border.left, n.border.right, n.padding.left, n.padding.right)));
}

// ---------------------------------------------------------------- end margin struts (the block flow of block.ts, read back)

// CSS2 §8.3.1, as block.ts collapses margins: these read the struts back from the input and the laid-out boxes, because the
// calculator needs each child's end margin strut (Blink LayoutResult::EndMarginStrut).
function joinMargin(s: Strut, margin: LU): Strut {
  return margin < 0 ? { positive: s.positive, negative: min(s.negative, margin) } : { positive: max(s.positive, margin), negative: s.negative };
}

function joinStruts(a: Strut, b: Strut): Strut {
  return { positive: max(a.positive, b.positive), negative: min(a.negative, b.negative) };
}

function collapsed(s: Strut): LU {
  return add(s.positive, s.negative);
}

/** A child's end margin strut: for a self-collapsing child, the strut it collapses through with its block-start margin. */
type EndStrut = { readonly strut: Strut; readonly selfCollapsing: boolean };

/** One block container's flow read back: what layoutBlockFlow returns, and each in-flow child's end margin strut. */
type Flow = {
  readonly escapeTop: Strut;
  readonly endStrut: Strut;
  /** The bottom border edge of the last in-flow box with content, from the content box top, at its in-flow position. */
  readonly cursor: LU;
  readonly hasContent: boolean;
  readonly ends: Map<string, EndStrut>;
};

/** layoutContents' formattingContextRoot for a child of a block flow. */
function isFcRoot(b: OverflowNode): boolean {
  return b.kind === 'replaced' || b.style.display !== 'block' || isScrollContainer(b.style);
}

function flowOf(ix: Index, n: Node): Flow {
  const known = ix.flows.get(n.box.id);
  if (known !== undefined) return known;
  const flow = readFlow(ix, n);
  ix.flows.set(n.box.id, flow);
  return flow;
}

function readFlow(ix: Index, n: Node): Flow {
  const b = n.box;
  const ends: Map<string, EndStrut> = new Map();
  const inline = b.kind !== 'replaced' && hasInlineContent(b);
  if (b.kind === 'replaced' || b.style.display !== 'block' || inline) {
    const lines = b.kind === 'replaced' || !inline ? 0 : placeLines(ix.ctx, b, contentWidthOf(n)).length;
    return { escapeTop: EMPTY_STRUT, endStrut: EMPTY_STRUT, cursor: ZERO, hasContent: lines > 0, ends };
  }
  const f = ix.ctx.faults;
  const cb = contentWidthOf(n);
  const contentTop = add(n.rect.y, add(n.border.top, n.padding.top));
  const canCollapseTop = !isRootOrFc(ix, n) && n.border.top === 0 && n.padding.top === 0;
  const direction = directionOf(ix.ctx, b);
  let strut = EMPTY_STRUT;
  let cursor = ZERO;
  let seen = false;
  let escapeTop = EMPTY_STRUT;
  for (const k of b.children) {
    if ((k.kind !== 'box' && k.kind !== 'replaced') || isOutOfFlow(ix.ctx, k)) continue;
    const kn = nodeOf(ix, k.id);
    const mt = resolveMarginWith(k.style.marginTop, cb, f).value;
    const mb = resolveMarginWith(k.style.marginBottom, cb, f).value;
    const kf = readChild(ix, kn);
    const before = joinStruts(joinMargin(strut, mt), kf.escapeTop);
    if (kf.collapseThrough) {
      ends.set(k.id, { strut: before, selfCollapsing: true });
      strut = joinMargin(before, mb);
      continue;
    }
    if (!seen && canCollapseTop) escapeTop = before;
    if (k.style.position === 'relative' && (hasPercentInset(k.style.top) || hasPercentInset(k.style.bottom))) {
      throw new OverflowRefusal(k.id, 'a relative offset with a percentage top or bottom in a margin-collapsing flow: its basis is not decided here');
    }
    const rel = relativeOffsetWith(k, cb, INDEFINITE, direction, f);
    cursor = sub(add(sub(kn.rect.y, rel.dy), kn.rect.height), contentTop);
    seen = true;
    ends.set(k.id, { strut: kf.escapeBottom, selfCollapsing: false });
    strut = joinStruts(joinMargin(EMPTY_STRUT, mb), kf.escapeBottom);
  }
  if (!seen && canCollapseTop) return { escapeTop: strut, endStrut: EMPTY_STRUT, cursor: ZERO, hasContent: false, ends };
  return { escapeTop, endStrut: strut, cursor, hasContent: seen, ends };
}

function isRootOrFc(ix: Index, n: Node): boolean {
  return n.parent === null || n.parent.style.display === 'flex' || isFcRoot(n.box) || isOutOfFlow(ix.ctx, n.box);
}

/** What layoutContents returns about margins for a block-flow child: its escaping struts and whether it collapses through. */
type ChildMargins = { readonly escapeTop: Strut; readonly escapeBottom: Strut; readonly collapseThrough: boolean };

function readChild(ix: Index, n: Node): ChildMargins {
  const b = n.box;
  const none: ChildMargins = { escapeTop: EMPTY_STRUT, escapeBottom: EMPTY_STRUT, collapseThrough: false };
  if (b.kind === 'replaced' || isFcRoot(b)) return none;
  const vbp = sumEdges(n.border.top, n.border.bottom, n.padding.top, n.padding.bottom);
  const r = flowOf(ix, n);
  const height = n.rect.height;
  if (!r.hasContent && height === 0 && vbp === 0) return { escapeTop: joinStruts(r.escapeTop, r.endStrut), escapeBottom: EMPTY_STRUT, collapseThrough: true };
  const h = b.style.height;
  if (h.kind !== 'auto' && hasPercent(h) && n.border.bottom === 0 && n.padding.bottom === 0 && (r.endStrut.positive !== 0 || r.endStrut.negative !== 0)) {
    throw new OverflowRefusal(b.id, 'a percentage height on a box whose end margins may collapse through it: its basis is not decided here');
  }
  const minMax = blockMinMaxWith(b, INDEFINITE, vbp, ix.ctx.faults);
  const specNoCollapse = ix.ctx.faults.minMaxEndMarginSpec && minMax.min > vbp;
  const bottomAdjoins = n.border.bottom === 0 && n.padding.bottom === 0 && h.kind === 'auto' && !specNoCollapse;
  const escapeBottom = bottomAdjoins && (height === add(r.cursor, vbp) || ix.ctx.faults.minMaxEndMarginSpec) ? r.endStrut : EMPTY_STRUT;
  return { escapeTop: r.escapeTop, escapeBottom, collapseThrough: false };
}

// ---------------------------------------------------------------- the viewport

/**
 * The viewport (Blink LayoutView, a scroll container the size of the initial containing block, with no border or padding): the
 * root box is its in-flow child, with its margins and no end margin strut (the root is a formatting context root), and the
 * absolutely positioned boxes with no positioned ancestor are its out-of-flow children.
 */
function viewportMetrics(ix: Index, input: LayoutInput, direction: Direction): ScrollMetrics {
  const width = fromCssPx(input.viewport.width);
  const height = fromCssPx(input.viewport.height);
  const paddingRect: OverflowRect = { x: ZERO, y: ZERO, width, height };
  const c: Calc = { overflow: paddingRect, inflow: null, paddingRect, scrollContainer: true, leftOverflow: direction === 'rtl', topOverflow: false };
  const root = nodeOf(ix, input.root.id);
  addOverflow(c, shifted(propagated(ix, root), root.rect.x, root.rect.y));
  const s = root.box.style;
  const f = ix.ctx.faults;
  const ml = resolveMarginWith(s.marginLeft, width, f).value;
  const mr = resolveMarginWith(s.marginRight, width, f).value;
  const mt = resolveMarginWith(s.marginTop, width, f).value;
  const mb = resolveMarginWith(s.marginBottom, width, f).value;
  if (s.position === 'relative' && (hasPercentInset(s.top) || hasPercentInset(s.bottom))) {
    throw new OverflowRefusal(root.box.id, 'a relative offset with a percentage top or bottom on the root: its basis is not decided here');
  }
  const rel = relativeOffsetWith(root.box, width, INDEFINITE, directionOf(ix.ctx, root.box), f);
  const x = sub(root.rect.x, rel.dx);
  const y = sub(root.rect.y, rel.dy);
  const w = root.rect.width;
  const h = root.rect.height;
  const rtl = direction === 'rtl';
  const left = rtl ? max(ml, sub(ZERO, w)) : clampNegativeToZero(ml);
  const rightM = rtl ? clampNegativeToZero(mr) : max(mr, sub(ZERO, w));
  addInflow(c, span(sub(x, left), sub(y, clampNegativeToZero(mt)), add(add(x, w), rightM), add(add(y, h), max(mb, sub(ZERO, h)))));
  const oofs = ix.oofByCb.get('');
  if (oofs !== undefined) {
    for (const k of oofs) {
      const kn = nodeOf(ix, k.id);
      addOverflow(c, shifted(propagated(ix, kn), kn.rect.x, kn.rect.y));
    }
  }
  const none: Edges = { top: ZERO, right: ZERO, bottom: ZERO, left: ZERO };
  return metricsOf('viewport', resultOf(ix, c, none), paddingRect);
}
