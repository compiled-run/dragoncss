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
import { resolveBorder } from './box.ts';
import { placeLines } from './inline.ts';
import { fromRaw } from './units.ts';
import type { LayoutBox, LayoutInput, LayoutStyle, ReplacedLeaf, TextLeaf } from './input.ts';
import type { LayoutRect } from './layout.ts';
import { absoluteRects, layout, zoomInput } from './layout.ts';
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
      if (k.layer) continue;
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
 * first, against their pixel-snapped rects exclusively (HitTestTextItem); then the line itself, exclusively against the line rect
 * and inclusively against the block's border box placed at the line's offset and pixel-snapped (HitTestClippedOutByBorder).
 */
function lineHit(ctx: HitCtx, block: HitNode, line: HitNode, at: number): number {
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
  if (!intersects(ctx.px, ctx.py, x0, y0, x1 - x0, y1 - y0)) return -1;
  for (const t of texts) {
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
  /** For each line node, the text pieces of its block on that line, in its block's reverse paint order; empty for other nodes. */
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
    if ((c.kind === 'box' || c.kind === 'replaced') && c.style.position !== 'absolute') inFlow.set(c.id, true);
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
  const placed = placeLines(s.ctx, zb, zLeaves, LINE_PROBE_WIDTH);
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
  for (const p of own) {
    const q = p.rect;
    // Ahem's ink: the glyph run's bounds rounded out to whole pixels in the run's own space (from the run origin to n em, and
    // from 0.8 em above the baseline to 0.2 em below), placed at the text's origin and ascent; measured against Chrome.
    const baseline = q.y + run.ascent;
    const glyphs = roundOf(q.width / (em * LU_PX));
    const above = p.full ? floorOf(-0.8 * em) : 0;
    pushNode(s, {
      kind: 'text', parent, target, x: q.x, y: q.y, width: q.width, height: q.height, clips: false, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
      layer: false, absolute: false, atomic: false, order: 0, layerOrder: 0, line: k, inkLeft: q.x, inkTop: baseline + above * LU_PX, inkRight: q.x - floorOf(-(glyphs * em)) * LU_PX,
      inkBottom: baseline - floorOf(-0.2 * em) * LU_PX, pointerEvents: pe,
    }, q.id, false);
  }
}

function boxNodes(s: TableState, b: LayoutBox, parent: number, orders: Map<string, number> | null, target: number, inherited: PointerEvents): void {
  const i = s.nodes.length;
  let pe = inherited;
  let own = target;
  let act = false;
  if (b.boxType === 'element') {
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
    kind: 'box', parent, target: own, x: r.x, y: r.y, width: r.width, height: r.height, clips: b.style.overflowX === 'hidden',
    borderTop: border.top, borderRight: border.right, borderBottom: border.bottom, borderLeft: border.left, layer: b.style.position !== 'static',
    absolute: b.style.position === 'absolute', atomic: orders !== null, order: order === undefined ? 0 : order,
    layerOrder: orders !== null && b.style.position !== 'absolute' ? b.style.order : 0, line: -1,
    inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: pe,
  }, b.id, act);
  const leaves: TextLeaf[] = [];
  let kids = 0;
  for (const c of b.children) {
    if (c.kind === 'text') leaves.push(c);
    else kids++;
  }
  if (leaves.length > 0 && kids > 0) throw new HitError(`${b.id} mixes text and boxes; the compiler wraps text in anonymous boxes`);
  if (leaves.length > 0) inlineNodes(s, b, i, own, pe, leaves);
  const childOrders = b.style.display === 'flex' ? fragmentOrders(s, b) : null;
  for (const c of b.children) {
    if (c.kind === 'box') boxNodes(s, c, i, childOrders, own, pe);
    else if (c.kind === 'replaced') replacedNode(s, c, i, childOrders);
  }
}

/**
 * A replaced element (img, iframe; REPL-a): a box with no descendants, hit on its border box. Blink hit-tests a block-level
 * replaced box like any block child (BoxFragmentPainter::HitTestBlockChildren; a flex item is painted atomically), and a point
 * inside an iframe's content box returns the iframe element itself to the outer document's elementFromPoint.
 */
function replacedNode(s: TableState, c: ReplacedLeaf, parent: number, orders: Map<string, number> | null): void {
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
    absolute: c.style.position === 'absolute', atomic: orders !== null, order: order === undefined ? 0 : order,
    layerOrder: orders !== null && c.style.position !== 'absolute' ? c.style.order : 0, line: -1,
    inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: pe,
  }, c.id, f.activation);
}

/** The hit table of an engine input at its device scale, from the engine's own layout of it and the compiler's hit facts. */
export function hitTableOf(input: LayoutInput, measurer: TextMeasurer, facts: ReadonlyMap<string, HitFact>, faults: HitTableFaults): HitTable {
  const out = layout(input, measurer);
  if (out.kind !== 'ok') throw new HitError(`the engine refused the input (${out.unsupported.code} at ${out.unsupported.nodeId})`);
  const zoomed = zoomInput(input, NO_ENGINE_FAULTS);
  const zmap = new Map<string, LayoutBox>();
  const rmap = new Map<string, LayoutStyle>();
  indexZoomed(zmap, rmap, zoomed.root);
  const s: TableState = { nodes: [], ids: [], activation: [], abs: absoluteRects(out.boxes), boxes: out.boxes, zoomed: zmap, zoomedReplaced: rmap, ctx: { measurer, devicePixelRatio: zoomed.devicePixelRatio, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS }, facts, faults };
  boxNodes(s, input.root, -1, null, -1, 'auto');
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
