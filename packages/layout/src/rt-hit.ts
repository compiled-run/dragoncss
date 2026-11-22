// Dragon's hit test (notes/T047-runtime-spec.md RT-9 and amendment T063J), ported from Chrome 145 (47e20adcc15f, Chromium BSD):
// third_party/blink/renderer/core/paint/box_fragment_painter.cc NodeAtPoint, HitTestAllPhases, HitTestBlockChildren,
// HitTestItemsChildren, HitTestTextItem, HitTestLineBoxFragment and HitTestClippedOutByBorder; layout/inline/fragment_item.cc
// ComputeTextBoundsRectForHitTest; paint/contoured_border_geometry.cc, platform/geometry/contoured_rect.cc and
// float_rounded_rect.cc (the inclusive border test); paint/clip_rect.cc Intersects; ui/gfx/geometry/quad_f.cc IntersectsRect. The
// point semantics (floor to 1/64 px, a 1x1 px box, exclusive rect intersection), the layer order (positioned boxes in reverse
// document order, then the root) and the layer clips (a clipping layer clips its in-flow content to its border box, and descendant
// layers on its containing-block chain to its padding box) are measured against Chrome, not taken from the LGPL
// hit_test_location.cc or paint_layer.cc. Every length is in LU (1/64 px), absolute to the root.
import type { Ctx as EngineCtx } from './block.ts';
import { NO_ENGINE_FAULTS } from './block.ts';
import { NO_GRID_FAULTS } from './grid.ts';
import { hasPercent, isScrollContainer, resolveBorder, resolvePadding } from './box.ts';
import { controlAsBox } from './controls.ts';
import type { HitLine, LinePiece } from './inline.ts';
import { placeHitLines, placeLines } from './inline.ts';
import { fromRaw, ZERO } from './units.ts';
import type { InlineChild, LayoutBox, LayoutInput, LayoutStyle, ReplacedLeaf, TextLeaf } from './input.ts';
import type { LayoutRect } from './layout.ts';
import { absoluteRects, layout, resolvedInput } from './layout.ts';
import { UnsupportedSignal } from './unsupported.ts';
import { floorOf, roundOf } from './rt-easing.ts';
import type { TextMeasurer } from './text.ts';

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
  /** Painted atomically (a flex or grid item, or an atomic inline): all its phases are tested together, in the parent's foreground phase. */
  readonly atomic: boolean;
  /** The flex item's place in its container's fragment order (its atomic paint); 0 for every other box. */
  readonly order: number;
  /** The CSS order of an in-flow flex item, which orders positioned boxes among siblings; 0 for every other box. */
  readonly layerOrder: number;
  /** The index of the inline line a text piece, line or atomic inline belongs to, within its block; -1 for other boxes. */
  readonly line: number;
  /** A text piece's glyph ink (its glyph bounds rounded out to whole pixels), an atomic inline's ink overflow; 0 for other boxes and lines. */
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

type HitCtx = {
  readonly nodes: readonly HitNode[];
  readonly children: readonly (readonly number[])[];
  readonly lineTexts: readonly (readonly number[])[];
  readonly px: number;
  readonly py: number;
  readonly faults: HitFaults;
};

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
function insideClip(ctx: HitCtx, n: HitNode): boolean {
  if (n.layer) return intersects(ctx.px, ctx.py, n.x, n.y, n.width, n.height);
  return insidePadding(ctx, n);
}

/** Whether the point lies inside a box's padding box. */
function insidePadding(ctx: HitCtx, n: HitNode): boolean {
  return intersects(ctx.px, ctx.py, n.x + n.borderLeft, n.y + n.borderTop, n.width - n.borderLeft - n.borderRight, n.height - n.borderTop - n.borderBottom);
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
  if (n.clips && !insideClip(ctx, n)) return -1;
  const kids = reversedChildren(ctx, i);
  for (const c of kids) {
    const k = node(ctx, c);
    if (k.kind === 'box') {
      if (k.layer || k.line >= 0) continue;
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
 * HitTestLineBoxFragment: when the line's ink overflow (the line box, its text and its atomic inlines) holds the point, the line's
 * items, last first: a text item against its pixel-snapped rect exclusively (HitTestTextItem), an atomic inline in all its phases
 * (HitTestChildBoxFragment); then the line itself, exclusively against the line rect and inclusively against the block's border
 * box placed at the line's offset and pixel-snapped (HitTestClippedOutByBorder).
 */
function lineHit(ctx: HitCtx, block: HitNode, line: HitNode, at: number): number {
  let x0 = line.x;
  let y0 = line.y;
  let x1 = line.x + line.width;
  let y1 = line.y + line.height;
  const own = ctx.lineTexts[at];
  if (own === undefined) throw new HitError(`no text list for line ${at}`);
  for (const c of own) {
    const t = node(ctx, c);
    // The item's ink overflow: its rect and its glyph ink, or an atomic inline's ink overflow.
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
  for (const c of own) {
    const t = node(ctx, c);
    if (t.kind === 'box') {
      const hit = allPhases(ctx, c);
      if (hit >= 0) return hit;
      continue;
    }
    if (visible(ctx, t) && intersectsSnapped(ctx.px, ctx.py, t.x, t.y, t.width, t.height)) return t.target;
  }
  if (visible(ctx, line) && intersects(ctx.px, ctx.py, line.x, line.y, line.width, line.height) && touchesSnapped(ctx.px, ctx.py, line.x, line.y, block.width, block.height)) return line.target;
  return -1;
}

/** kDescendantBlockBackgrounds then kSelfBlockBackground over the non-atomic block descendants, deepest and last first. */
function backgrounds(ctx: HitCtx, i: number): number {
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
function self(ctx: HitCtx, i: number): number {
  const n = node(ctx, i);
  return visible(ctx, n) && intersects(ctx.px, ctx.py, n.x, n.y, n.width, n.height) ? n.target : -1;
}

/** HitTestAllPhases: foreground, then the descendant block backgrounds, then the box's own background. */
function allPhases(ctx: HitCtx, i: number): number {
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
function containingParent(ctx: HitCtx, i: number): number {
  const n = node(ctx, i);
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
    if (a.clips && !insidePadding(ctx, a)) return false;
    at = containingParent(ctx, at);
  }
  return true;
}

/** A table prepared for many points: each box's children in reverse paint order, and the layers in hit order. */
export type HitPrepared = {
  readonly nodes: readonly HitNode[];
  readonly children: readonly (readonly number[])[];
  /** For each line node, the text pieces and atomic inlines of its block on that line, in its block's reverse paint order; empty for other nodes. */
  readonly lineTexts: readonly (readonly number[])[];
  readonly layers: readonly number[];
  readonly faults: HitFaults;
};

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
    if (i > 0 && n.kind === 'box' && n.layer) layers.push(i);
    const own = layerOrdered[i];
    if (own === undefined) throw new HitError(`no children list for ${i}`);
    for (const c of own) collect(c);
  };
  collect(0);
  const reversed = faults.reversedOrder ? ordered : ordered.map((own) => own.slice(0).reverse());
  // Each line's text pieces and atomic inlines, grouped once per block (in the block's child order) so a point tests a line in O(its items).
  const lineTexts: number[][] = nodes.map((): number[] => []);
  reversed.forEach((own) => {
    const byLine: number[][] = [];
    for (const c of own) {
      const t = nodes[c];
      if (t === undefined || t.kind === 'line' || t.line < 0) continue;
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
  return { nodes, children: reversed, lineTexts, layers: faults.reversedOrder ? layers : layers.slice(0).reverse(), faults };
}

/**
 * The index of the node elementFromPoint names at (px, py), a point in LU already floored to 1/64 px: the positioned layers in
 * reverse paint order, then the root layer; the root's target when nothing is hit (the view hit returns the document element).
 */
export function hitAt(prepared: HitPrepared, px: number, py: number): number {
  const ctx: HitCtx = { nodes: prepared.nodes, children: prepared.children, lineTexts: prepared.lineTexts, px, py, faults: prepared.faults };
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
export type HitFact = { readonly pointerEvents: PointerEvents; readonly inherited: boolean; readonly activation: boolean };

/** A table: the nodes hitTest takes, the id each names, and each node's activation flag. */
export type HitTable = { readonly nodes: readonly HitNode[]; readonly ids: readonly string[]; readonly activation: readonly boolean[] };

/** Planted fault pointerEventsNotInherited: an inherited pointer-events value is read as auto. */
export type HitTableFaults = { readonly pointerEventsNotInherited: boolean };
export const NO_HIT_TABLE_FAULTS: HitTableFaults = { pointerEventsNotInherited: false };

type TableState = {
  readonly nodes: HitNode[];
  readonly ids: string[];
  readonly activation: boolean[];
  readonly abs: Map<string, LayoutRect>;
  readonly boxes: readonly LayoutRect[];
  readonly zoomed: Map<string, LayoutBox>;
  /** The zoomed style of each replaced leaf, by id. */
  readonly zoomedReplaced: Map<string, LayoutStyle>;
  /** Each atomic inline's ink overflow, by node index, set once its subtree is built. */
  readonly inks: Map<string, InkRect>;
  readonly ctx: EngineCtx;
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

function inlineNodes(s: TableState, b: LayoutBox, parent: number, target: number, pe: PointerEvents, leaves: readonly TextLeaf[]): void {
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
    linePieces(s, b, parent, target, pe, run, size, own, head.rect.y, k);
    k++;
    from = at;
  }
}

/** One line of a block's inline content (its pieces, all with this top): the line node, then each text piece on it. */
function linePieces(s: TableState, b: LayoutBox, parent: number, target: number, pe: PointerEvents, run: LineMetrics, em: number, own: readonly HitPiece[], top: number, k: number): void {
  const firstPiece = own[0];
  if (firstPiece === undefined) throw new HitError(`${b.id}: an empty line`);
  let x0 = firstPiece.rect.x;
  let x1 = x0 + firstPiece.rect.width;
  for (const p of own) {
    if (p.rect.x < x0) x0 = p.rect.x;
    if (p.rect.x + p.rect.width > x1) x1 = p.rect.x + p.rect.width;
  }
  pushNode(s, { kind: 'line', parent, target, x: x0, y: top - run.halfLeading, width: x1 - x0, height: run.lineHeight, clips: false, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0, layer: false, absolute: false, atomic: false, order: 0, layerOrder: 0, line: k, inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: pe }, `${b.id}:hitline${k}`, false);
  for (const p of own) textNode(s, parent, target, pe, p.rect, run.ascent, em, p.full, k);
}

/**
 * A text piece on line k. Ahem's ink: the glyph run's bounds rounded out to whole pixels in the run's own space (from the run origin
 * to n em, and from 0.8 em above the baseline to 0.2 em below), placed at the text's origin and ascent; measured against Chrome.
 */
function textNode(s: TableState, parent: number, target: number, pe: PointerEvents, q: LayoutRect, ascent: number, em: number, full: boolean, k: number): void {
  const baseline = q.y + ascent;
  const glyphs = roundOf(q.width / (em * LU_PX));
  const above = full ? floorOf(-0.8 * em) : 0;
  pushNode(s, {
    kind: 'text', parent, target, x: q.x, y: q.y, width: q.width, height: q.height, clips: false, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
    layer: false, absolute: false, atomic: false, order: 0, layerOrder: 0, line: k, inkLeft: q.x, inkTop: baseline + above * LU_PX, inkRight: q.x - floorOf(-(glyphs * em)) * LU_PX,
    inkBottom: baseline - floorOf(-0.2 * em) * LU_PX, pointerEvents: pe,
  }, q.id, false);
}

/** line: the line index of an atomic inline in its block, -1 for every other box. */
function boxNodes(s: TableState, b: LayoutBox, parent: number, orders: Map<string, number> | null, target: number, inherited: PointerEvents, line: number): void {
  const i = s.nodes.length;
  let pe = inherited;
  let own = target;
  let act = false;
  if (b.boxType !== 'anonymous') {
    const f = s.facts.get(b.id);
    if (f === undefined) throw new HitError(`no hit facts for element ${b.id}`);
    pe = s.faults.pointerEventsNotInherited && f.inherited ? 'auto' : f.pointerEvents;
    own = i;
    act = f.activation;
  }
  if (own < 0) throw new HitError(`anonymous box ${b.id} has no element ancestor`);
  const r = rectOf(s, b.id);
  const border = resolveBorder(zoomedBox(s, b.id).style, s.ctx.devicePixelRatio);
  const order = orders === null ? undefined : orders.get(b.id);
  pushNode(s, {
    kind: 'box', parent, target: own, x: r.x, y: r.y, width: r.width, height: r.height, clips: clipsBothAxes(b.style),
    borderTop: border.top, borderRight: border.right, borderBottom: border.bottom, borderLeft: border.left, layer: b.style.position !== 'static',
    absolute: b.style.position === 'absolute', atomic: orders !== null || line >= 0, order: order === undefined ? 0 : order,
    layerOrder: orders !== null && b.style.position !== 'absolute' ? b.style.order : 0, line,
    inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: pe,
  }, b.id, act);
  const leaves: TextLeaf[] = [];
  const atoms: (LayoutBox | ReplacedLeaf)[] = [];
  let kids = 0;
  for (const c of b.children) {
    if (c.kind === 'text') leaves.push(c);
    else if (c.kind === 'inline' || c.kind === 'br') throw new HitError(inlineRefusal(c.id, c.kind));
    else if ((c.kind === 'box' || c.kind === 'replaced') && isAtomicInline(c) && b.strut === null) throw new HitError(atomicRefusal(c.id));
    else if ((c.kind === 'box' || c.kind === 'replaced') && isAtomicInline(c)) atoms.push(c);
    else if ((c.kind === 'box' || c.kind === 'replaced') && (c.style.position === 'fixed' || c.style.position === 'sticky')) throw new HitError(fixedRefusal(c.id, c.style.position));
    else if ((c.kind === 'box' || c.kind === 'replaced') && c.style.float !== 'none' && c.style.position !== 'absolute' && c.style.position !== 'fixed' && (b.style.display === 'block' || b.style.display === 'inline-block')) throw new HitError(floatRefusal(c.id));
    else kids++;
  }
  if ((leaves.length > 0 || atoms.length > 0) && kids > 0) throw new HitError(`${b.id} mixes inline content and boxes; the compiler wraps inline content in anonymous boxes`);
  if (atoms.length > 0 && percentPadded(b.style)) throw new HitError(paddingRefusal(b.id));
  if (atoms.length > 0) inlineAtomicNodes(s, b, i, own, pe, atoms);
  else if (leaves.length > 0) inlineNodes(s, b, i, own, pe, leaves);
  if (atoms.length === 0) {
    const d = b.style.display;
    const childOrders = d === 'flex' || d === 'inline-flex' ? fragmentOrders(s, b) : d === 'grid' || d === 'inline-grid' ? gridOrders(s, b) : null;
    for (const c of b.children) {
      if (c.kind === 'box') boxNodes(s, c, i, childOrders, own, pe, -1);
      else if (c.kind === 'control') throw new HitError(controlRefusal(c.id));
      else if (c.kind === 'replaced') replacedNode(s, c, i, childOrders, -1);
    }
  }
  if (line >= 0) atomicInk(s, i);
}

/** An ink overflow rect in LU, absolute to the root. */
type InkRect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** One item of a line holding atomic inlines: a text piece (leaf >= 0) or an atomic inline (atom >= 0), with its pen extent. */
type LineItem = { readonly at: number; readonly leaf: number; readonly atom: number; readonly rect: LayoutRect; readonly ascent: number; readonly start: number; readonly end: number };

/**
 * A block's inline content holding atomic inlines: each line of the engine's placeHitLines over its content box (checked against
 * the engine's own fragments), its line node, then its text pieces and atomic inlines in tree order, which is their paint order on
 * the line (the engine refuses an rtl paragraph that would reorder them; the pen check below catches any other reordering).
 */
function inlineAtomicNodes(s: TableState, b: LayoutBox, parent: number, target: number, pe: PointerEvents, atoms: readonly (LayoutBox | ReplacedLeaf)[]): void {
  const zb = zoomedBox(s, b.id);
  const r = rectOf(s, b.id);
  const border = resolveBorder(zb.style, s.ctx.devicePixelRatio);
  const padding = resolvePadding(zb.style, ZERO);
  const left = r.x + border.left + padding.left;
  const top = r.y + border.top + padding.top;
  const width = r.width - border.left - border.right - padding.left - padding.right;
  // Each leaf's and atomic inline's place among b's children, and the zoomed leaves (the engine's inlineLeaves order).
  const leafAt: number[] = [];
  const atomAt: number[] = [];
  const leaves: TextLeaf[] = [];
  for (let k = 0; k < b.children.length; k++) {
    const c = b.children[k];
    if (c === undefined) throw new HitError(`${b.id}: no child ${k}`);
    if (c.kind === 'text') {
      leafAt.push(k);
      leaves.push(c);
    } else if (c.kind === 'box' || c.kind === 'replaced') atomAt.push(k);
  }
  if (atomAt.length !== atoms.length) throw new HitError(`${b.id}: ${atoms.length} atomic inlines but ${atomAt.length} inline-level boxes`);
  const zLeaves: TextLeaf[] = [];
  for (const c of zb.children) {
    if (c.kind === 'text') zLeaves.push(c);
  }
  const pieceCount = new Map<string, number>();
  const full: boolean[] = [];
  for (const leaf of leaves) full.push(inkAbove(leaf));
  const lines: HitLine[] = placeHitLines(s.ctx, zb, fromRaw(width));
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (l === undefined) throw new HitError(`${b.id}: no line ${k}`);
    const items: LineItem[] = [];
    for (const p of l.line.pieces) items.push(pieceItem(s, b, leaves, leafAt, pieceCount, p, left, top));
    for (let m = 0; m < l.atomics.length; m++) {
      const a = l.atomics[m];
      const ar = l.atomicRects[m];
      const ml = l.marginLefts[m];
      const mr = l.marginRights[m];
      if (a === undefined || ar === undefined || ml === undefined || mr === undefined) throw new HitError(`${b.id}: no atomic inline ${m} on line ${k}`);
      const atom = atoms[a];
      const at = atomAt[a];
      if (atom === undefined || at === undefined) throw new HitError(`${b.id}: no atomic inline ${a}`);
      const own = rectOf(s, atom.id);
      if (own.x !== left + ar.x || own.y !== top + ar.y) throw new HitError(`${atom.id} is at ${own.x},${own.y} where its line places it at ${left + ar.x},${top + ar.y}`);
      items.push({ at, leaf: -1, atom: a, rect: own, ascent: 0, start: own.x - ml, end: own.x + own.width + mr });
    }
    const ordered = items.slice(0).sort((p, q) => p.at - q.at);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    if (first === undefined || last === undefined) throw new HitError(`${b.id}: an empty line ${k}`);
    for (let q = 1; q < ordered.length; q++) {
      const prev = ordered[q - 1] as LineItem;
      const cur = ordered[q] as LineItem;
      if (cur.start !== prev.end) throw new HitError(`${b.id}: line ${k} does not paint its items in tree order, which the hit table does not model`);
    }
    pushNode(s, { kind: 'line', parent, target, x: first.start, y: top + l.line.top, width: last.end - first.start, height: l.line.height, clips: false, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0, layer: false, absolute: false, atomic: false, order: 0, layerOrder: 0, line: k, inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: pe }, `${b.id}:hitline${k}`, false);
    for (const it of ordered) {
      if (it.atom >= 0) {
        const c = atoms[it.atom] as LayoutBox | ReplacedLeaf;
        if (c.kind === 'box') boxNodes(s, c, parent, null, target, pe, k);
        else replacedNode(s, c, parent, null, k);
        continue;
      }
      const zl = zLeaves[it.leaf];
      const inks = full[it.leaf];
      if (zl === undefined || inks === undefined) throw new HitError(`${b.id}: no zoomed leaf ${it.leaf}`);
      textNode(s, parent, target, pe, it.rect, it.ascent, zl.font.size, inks, k);
    }
  }
  for (let li = 0; li < leaves.length; li++) {
    const leaf = leaves[li] as TextLeaf;
    const n = pieceCount.get(`${li}`);
    if (hasPartialInk(leaf) && inkAbove(leaf) && n !== undefined && n > 1) throw new HitError(`${leaf.id}: Ahem p glyphs mixed with full glyphs over several lines give each line its own ink, which the hit table does not model`);
  }
}

/** A text piece of a line holding atomic inlines, at the engine's own fragment of it (<leaf>:line<j>), checked against its line. */
function pieceItem(s: TableState, b: LayoutBox, leaves: readonly TextLeaf[], leafAt: readonly number[], pieceCount: Map<string, number>, p: LinePiece, left: number, top: number): LineItem {
  const leaf = leaves[p.leaf];
  const at = leafAt[p.leaf];
  if (leaf === undefined || at === undefined) throw new HitError(`${b.id}: no leaf ${p.leaf}`);
  if (p.truncated || p.shifts.length > 0) throw new HitError(`${leaf.id}: a truncated or justified line beside an atomic inline, which the hit table does not model`);
  const seen = pieceCount.get(`${p.leaf}`);
  const j = seen === undefined ? 0 : seen;
  pieceCount.set(`${p.leaf}`, j + 1);
  const own = rectOf(s, `${leaf.id}:line${j}`);
  if (own.x !== left + p.x || own.y !== top + p.top) throw new HitError(`${leaf.id}:line${j} is at ${own.x},${own.y} where its line places it at ${left + p.x},${top + p.top}`);
  return { at, leaf: p.leaf, atom: -1, rect: own, ascent: p.ascent, start: own.x, end: own.x + own.width };
}

/**
 * An atomic inline's ink overflow, which its line's hit test reads: its border box and, unless it clips, the boxes and text ink of
 * its descendants outside any clipping box or layer below it.
 */
function atomicInk(s: TableState, at: number): void {
  const a = s.nodes[at];
  if (a === undefined) throw new HitError(`no hit node ${at}`);
  let x0 = a.x;
  let y0 = a.y;
  let x1 = a.x + a.width;
  let y1 = a.y + a.height;
  if (!a.clips) {
    for (let d = at + 1; d < s.nodes.length; d++) {
      const n = s.nodes[d] as HitNode;
      if (n.kind === 'box' && n.layer) continue;
      let p = n.parent;
      let inked = true;
      while (p !== at && p >= 0) {
        const q = s.nodes[p] as HitNode;
        if (q.clips || (q.kind === 'box' && q.layer)) inked = false;
        p = q.parent;
      }
      if (!inked || p !== at) continue;
      if (n.x < x0) x0 = n.x;
      if (n.y < y0) y0 = n.y;
      if (n.x + n.width > x1) x1 = n.x + n.width;
      if (n.y + n.height > y1) y1 = n.y + n.height;
      if (n.kind !== 'text') continue;
      if (n.inkLeft < x0) x0 = n.inkLeft;
      if (n.inkTop < y0) y0 = n.inkTop;
      if (n.inkRight > x1) x1 = n.inkRight;
      if (n.inkBottom > y1) y1 = n.inkBottom;
    }
  }
  s.inks.set(`${at}`, { left: x0, top: y0, right: x1, bottom: y1 });
}

/** The node with an atomic inline's ink overflow, when it has one. */
function withInk(s: TableState, n: HitNode, i: number): HitNode {
  const k = s.inks.get(`${i}`);
  if (k === undefined) return n;
  return {
    kind: n.kind, parent: n.parent, target: n.target, x: n.x, y: n.y, width: n.width, height: n.height, clips: n.clips, borderTop: n.borderTop, borderRight: n.borderRight,
    borderBottom: n.borderBottom, borderLeft: n.borderLeft, layer: n.layer, absolute: n.absolute, atomic: n.atomic, order: n.order, layerOrder: n.layerOrder, line: n.line,
    inkLeft: k.left, inkTop: k.top, inkRight: k.right, inkBottom: k.bottom, pointerEvents: n.pointerEvents,
  };
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
function replacedNode(s: TableState, c: ReplacedLeaf, parent: number, orders: Map<string, number> | null, line: number): void {
  const f = s.facts.get(c.id);
  if (f === undefined) throw new HitError(`no hit facts for replaced element ${c.id}`);
  const pe = s.faults.pointerEventsNotInherited && f.inherited ? 'auto' : f.pointerEvents;
  const r = rectOf(s, c.id);
  const style = s.zoomedReplaced.get(c.id);
  if (style === undefined) throw new HitError(`no zoomed replaced element ${c.id}`);
  const border = resolveBorder(style, s.ctx.devicePixelRatio);
  const order = orders === null ? undefined : orders.get(c.id);
  pushNode(s, {
    kind: 'box', parent, target: s.nodes.length, x: r.x, y: r.y, width: r.width, height: r.height, clips: c.style.overflowX === 'hidden',
    borderTop: border.top, borderRight: border.right, borderBottom: border.bottom, borderLeft: border.left, layer: c.style.position !== 'static',
    absolute: c.style.position === 'absolute', atomic: orders !== null || line >= 0, order: order === undefined ? 0 : order,
    layerOrder: orders !== null && c.style.position !== 'absolute' ? c.style.order : 0, line,
    inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: pe,
  }, c.id, f.activation);
  if (line >= 0) atomicInk(s, s.nodes.length - 1);
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

function isAtomicInline(b: LayoutBox | ReplacedLeaf): boolean {
  const d = b.style.display;
  if (b.kind === 'replaced') return d === 'inline' || d === 'inline-block' || d === 'inline-flex';
  return d === 'inline-block' || d === 'inline-flex' || d === 'inline-grid';
}

function fixedRefusal(id: string, position: string): string {
  const pkg = position === 'fixed' ? 'POSX-f' : 'POSX-s';
  return `${id} is position: ${position}, a stacking context placed against the viewport, which the hit table does not model yet (${pkg}; no Chrome hit capture)`;
}

function floatRefusal(id: string): string {
  return `${id} is a float, which the hit table does not model yet (FLT; no Chrome hit capture)`;
}

function percentPadded(style: LayoutStyle): boolean {
  return hasPercent(style.paddingTop) || hasPercent(style.paddingRight) || hasPercent(style.paddingBottom) || hasPercent(style.paddingLeft);
}

/** inlineAtomicNodes places a block's lines over its content box, which it does not resolve percentage padding for. */
function paddingRefusal(id: string): string {
  return `${id} has percentage padding around atomic inlines, whose lines the hit table does not place yet (INL2a)`;
}

/** An atomic inline outside an inline formatting context (which the compiler never builds) has no line to paint on. */
function atomicRefusal(id: string): string {
  return `${id} is an atomic inline outside an inline formatting context, which the hit table does not model (INL2a)`;
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
  for (const c of b.children) {
    if (c.kind === 'inline' || c.kind === 'br') return inlineRefusal(c.id, c.kind);
    if (c.kind === 'control') return controlRefusal(c.id);
    if ((c.kind === 'replaced' || c.kind === 'box') && isAtomicInline(c) && b.strut !== null && percentPadded(b.style)) return paddingRefusal(b.id);
    if (c.kind === 'replaced' && isAtomicInline(c) && b.strut === null) return atomicRefusal(c.id);
    if ((c.kind === 'box' || c.kind === 'replaced') && (c.style.position === 'fixed' || c.style.position === 'sticky')) return fixedRefusal(c.id, c.style.position);
    if ((c.kind === 'box' || c.kind === 'replaced') && c.style.float !== 'none' && c.style.position !== 'absolute' && c.style.position !== 'fixed' && (b.style.display === 'block' || b.style.display === 'inline-block')) return floatRefusal(c.id);
    if (c.kind === 'box') {
      if (c.style.lineClamp > 0) return clampRefusal(c.id);
      if (isAtomicInline(c) && b.strut === null) return atomicRefusal(c.id);
      const r = boxHitRefusal(c);
      if (r !== null) return r;
    }
  }
  return null;
}

/**
 * Why hitTableOf refuses an engine input, or null when it models it: an inline box or a <br> (INL1a), an atomic inline (INL2a), a
 * line-clamp container (TXT2-g) and a form control (FORM-a) have no hit model yet.
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
  const s: TableState = { nodes: [], ids: [], activation: [], abs: absoluteRects(out.boxes), boxes: out.boxes, zoomed: zmap, zoomedReplaced: rmap, inks: new Map<string, InkRect>(), ctx: { measurer, devicePixelRatio: zoomed.devicePixelRatio, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS }, facts, faults };
  boxNodes(s, input.root, -1, null, -1, 'auto', -1);
  const nodes: HitNode[] = [];
  for (let i = 0; i < s.nodes.length; i++) nodes.push(withInk(s, s.nodes[i] as HitNode, i));
  return { nodes, ids: s.ids, activation: s.activation };
}

// ---------------------------------------------------------------------------------------------------------------------
// The derived grid and the encoded answers (the host lane, the vectors and the device-hit lane all read these).

/** One grid point in LU. */
export type HitPoint = { readonly x: number; readonly y: number };

function addAxis(out: number[], a: number, b: number): void {
  const values = [a - LU_PX - 1, a - LU_PX, a - LU_PX + 1, a - LU_PX / 2, a + LU_PX / 2, floorOf((a + b) / 2), b - LU_PX / 2, b - 1, b, b + LU_PX / 2, b + 1];
  for (const v of values) out.push(v);
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

/**
 * The derived grid of a table in LU, inside a viewport of width x height LU: for each rect, around each edge's exclusive boundary
 * (a point p hits [a, b) when a - 1 px < p < b) and inclusive boundary, half a pixel either side of each edge and the centre,
 * crossed per rect; for text the snapped rect too, and for a line the block's snapped border box at the line. Sorted by y then x,
 * without repeats.
 */
export function hitGrid(t: HitTable, width: number, height: number): HitPoint[] {
  const all: HitPoint[] = [];
  t.nodes.forEach((n, i) => {
    if (n.width <= 0 && n.height <= 0 && n.kind !== 'line') return;
    const xs: number[] = [];
    const ys: number[] = [];
    addAxis(xs, n.x, n.x + n.width);
    addAxis(ys, n.y, n.y + n.height);
    cross(all, xs, ys, width, height);
    if (n.kind === 'text') {
      const sx: number[] = [];
      const sy: number[] = [];
      addAxis(sx, roundPx(n.x), roundPx(n.x + n.width));
      addAxis(sy, roundPx(n.y), roundPx(n.y + n.height));
      cross(all, sx, sy, width, height);
    }
    if (n.kind === 'line') {
      const block = t.nodes[n.parent];
      if (block === undefined) throw new HitError(`line ${i} has no block`);
      const lx: number[] = [];
      const ly: number[] = [];
      addAxis(lx, roundPx(n.x), roundPx(n.x + block.width));
      addAxis(ly, roundPx(n.y), roundPx(n.y + block.height));
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
