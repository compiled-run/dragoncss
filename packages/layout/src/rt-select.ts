// Dragon's text selection model (notes/T154-user-select-spec.md slice 2a; P6c, T077) against Chrome 145: a point maps to a caret
// as Chrome's mouse selection places its anchor and focus, a caret has the collapsed-range rect native draws its handle at, and a
// pair of carets selects the text Selection.toString returns. Every length is in LU (1/64 px), absolute to the root, from the
// engine's own layout.
//
// Point to caret is measured against Chrome drags over Ahem text, not ported:
// - A point picks a block as LayoutBlock::PositionForPoint does: among block children, the first whose border box ends below the
//   point, else the last; among a block's lines, the first whose line box ends below the point. A point above a block's first line
//   (its padding, or the margin gap before it) is the block's start, one below its last line is the block's end, whatever x, and
//   one in a block with no text is that block's own position.
// - On a line, a point on or before a glyph's midpoint is the caret before the glyph, past it the caret after; a point past the
//   line's last visible glyph is the caret before the line's hanging space.
// - user-select none (css-ui-4 §6.1): a press on an element whose used value is none starts no selection; a caret that lands in
//   such a subtree moves to the first selectable caret after it, else the last one before it, in either drag direction.
// The selected text is ported from third_party/blink/renderer/core/editing/iterators/text_iterator.cc (Chromium BSD) over the
// block elements and text nodes the table holds: TextIteratorAlgorithm::Advance's depth-first walk, which exits a parent only as
// it climbs out of its last child, RepresentNodeOffsetZero and ShouldRepresentNodeOffsetZero (a newline entering a block), ExitNode
// (a newline leaving one, two leaving a p, ShouldEmitExtraNewlineForNode), and ShouldEmitNewlineAfterNode (none after the last
// node).
//
// Not modelled yet, and refused by name (selectionRefusal, or selectionTableOf for what only layout or the facts show): what the
// hit table refuses (inline boxes, <br>, atomic inlines, line-clamp), flex, grid and positioned boxes, replaced elements, rtl,
// justified and truncated lines, preserved white space, percentage padding, content that overflows its block's border box, boxes
// whose visibility is hidden or collapse, and any face but Ahem (a real face needs grapheme clusters and ligature carets). The compiler gives the
// elements whose used user-select is none (SelectFacts); text, and none below it, is all native compiles (slice 1).
import type { Ctx as EngineCtx } from './block.ts';
import { NO_ENGINE_FAULTS } from './block.ts';
import { hasPercent, resolveBorder, resolvePadding } from './box.ts';
import { NO_GRID_FAULTS } from './grid.ts';
import { leafFontOf, placeLines } from './inline.ts';
import type { LayoutBox, LayoutInput, TextLeaf } from './input.ts';
import type { LayoutRect } from './layout.ts';
import { absoluteRects, layout, resolvedInput } from './layout.ts';
import { floorOf } from './rt-easing.ts';
import { hitRefusal } from './rt-hit.ts';
import { AHEM_FACE_ID } from './text.ts';
import type { TextMeasurer } from './text.ts';
import type { LU } from './units.ts';
import { add, sub, ZERO } from './units.ts';
import { UnsupportedSignal } from './unsupported.ts';

export class SelectError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`selection: ${detail}`);
    this.detail = detail;
  }
}

/**
 * What the compiler knows of the elements that layout does not: the body's id, the ids of the p elements, the ids of the
 * elements whose used user-select is none (css-ui-4 §6.1; on native, everything under such an element is none too), and the ids
 * of the elements whose used visibility is hidden or collapse (their visibility writes), whose text Chrome neither hits nor
 * copies, which the model refuses.
 */
export type SelectFacts = { readonly body: string; readonly paragraphs: readonly string[]; readonly unselectable: readonly string[]; readonly hidden: readonly string[] };

/**
 * A DOM node the selected text walks, in tree order: a block element or a text node. A text node's text is its leaf's, after
 * white-space phase I, and it shows code points from (its first line's start) to to (its last line's visible end).
 */
export type SelectNode = {
  readonly kind: 'element' | 'text';
  readonly id: string;
  /** The parent element's index; -1 for the root. */
  readonly parent: number;
  /** The index past the node's subtree. */
  readonly end: number;
  /** A block other than the body: entering and leaving it emit newlines. */
  readonly block: boolean;
  readonly paragraph: boolean;
  /** Its used user-select (a text node's is its parent's) is not none. */
  readonly selectable: boolean;
  readonly text: string;
  readonly from: number;
  readonly to: number;
};

/** A block box (an element's, or an anonymous one around text): its border box's vertical extent and its place in the layout tree. */
export type SelectBlock = {
  /** The element's node; -1 for an anonymous box. */
  readonly node: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /** The block children, in tree order; empty for a block of lines or an empty block. */
  readonly children: readonly number[];
  /** The block's lines, firstLine to lastLine in the table; -1 for a block of block children or an empty block. */
  readonly firstLine: number;
  readonly lastLine: number;
};

/** A text node's piece of a line: code points start to end (its visible end), each caret's x, and its content area (the caret's rect). */
export type SelectPiece = {
  readonly node: number;
  readonly start: number;
  readonly end: number;
  /** The x of the caret before each code point of [start, end] (end + 1 - start carets). */
  readonly carets: readonly number[];
  readonly textTop: number;
  readonly textHeight: number;
};

/** One line box: its vertical extent and its pieces in order. */
export type SelectLine = { readonly top: number; readonly bottom: number; readonly pieces: readonly SelectPiece[] };

/** Lines in document order, which is also top to bottom; blocks[0] is the root's. */
export type SelectTable = { readonly nodes: readonly SelectNode[]; readonly blocks: readonly SelectBlock[]; readonly lines: readonly SelectLine[] };

/** A caret: before code point offset of a text node, or (offset 0) in a block element with no text. */
export type Caret = { readonly node: number; readonly offset: number };

/** A caret's rect: its x and its line's content area, as Chrome's collapsed Range.getBoundingClientRect has them. */
export type CaretRect = { readonly x: number; readonly y: number; readonly height: number };

const LU_PX = 64;

/** A node while the walk builds it: its subtree's end, its shown code points and its pieces so far are learnt after it is pushed. */
type NodeDraft = {
  readonly kind: 'element' | 'text';
  readonly id: string;
  readonly parent: number;
  end: number;
  readonly block: boolean;
  readonly paragraph: boolean;
  readonly selectable: boolean;
  readonly text: string;
  from: number;
  to: number;
  pieces: number;
};

/** A block while the walk builds it: its children and lines are learnt after it is pushed, so the root stays blocks[0]. */
type BlockDraft = { readonly node: number; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; children: number[]; firstLine: number; lastLine: number };

type SelectState = {
  readonly nodes: NodeDraft[];
  readonly blocks: BlockDraft[];
  readonly lines: SelectLine[];
  readonly abs: Map<string, LayoutRect>;
  readonly zoomed: Map<string, LayoutBox>;
  readonly ctx: EngineCtx;
  readonly facts: SelectFacts;
};

function rectOf(s: SelectState, id: string): LayoutRect {
  const r = s.abs.get(id);
  if (r === undefined) throw new SelectError(`the engine laid out no ${id}`);
  return r;
}

function zoomedBox(s: SelectState, id: string): LayoutBox {
  const b = s.zoomed.get(id);
  if (b === undefined) throw new SelectError(`no zoomed box ${id}`);
  return b;
}

function indexZoomed(m: Map<string, LayoutBox>, b: LayoutBox): void {
  m.set(b.id, b);
  for (const c of b.children) if (c.kind === 'box') indexZoomed(m, c);
}

function listed(ids: readonly string[], id: string): boolean {
  for (const p of ids) if (p === id) return true;
  return false;
}

/** Whether a node under parent is selectable; an element listed selectable under an unselectable parent is refused (slice 1). */
function selectableUnder(s: SelectState, parent: number, id: string, element: boolean): boolean {
  const inherited = parent < 0 || (s.nodes[parent] as NodeDraft).selectable;
  if (!element) return inherited;
  const own = !listed(s.facts.unselectable, id);
  if (own && !inherited) throw new SelectError(`${id} is selectable under an element whose used user-select is none, which native refuses`);
  return own;
}

/** The carets of a piece: its x, then after each code point the measured width of the leaf's text from the piece start (R4). */
function caretsOf(s: SelectState, leaf: TextLeaf, start: number, end: number, x: LU): number[] {
  const out: number[] = [x];
  const font = leafFontOf(leaf);
  for (let k = start + 1; k <= end; k++) {
    const m = s.ctx.measurer.measureRange(leaf.text, start, k, font);
    if (!m.ok) throw new SelectError(`${leaf.id}: ${m.reason}`);
    out.push(add(x, m.measure.width));
  }
  return out;
}

/** A block of lines: its text nodes, then the engine's placeLines over its content box, placed at the content-box origin its layout gives. */
function lineBlock(s: SelectState, b: LayoutBox, parent: number): void {
  const zb = zoomedBox(s, b.id);
  const r = rectOf(s, b.id);
  const border = resolveBorder(zb.style, s.ctx.devicePixelRatio);
  const padding = resolvePadding(zb.style, ZERO);
  const left = add(add(r.x, border.left), padding.left);
  const top = add(add(r.y, border.top), padding.top);
  const width = sub(sub(sub(sub(r.width, border.left), border.right), padding.left), padding.right);
  const zLeaves: TextLeaf[] = [];
  const first = s.nodes.length;
  for (const c of zb.children) {
    if (c.kind !== 'text') continue;
    zLeaves.push(c);
    s.nodes.push({ kind: 'text', id: c.id, parent, end: s.nodes.length + 1, block: false, paragraph: false, selectable: selectableUnder(s, parent, c.id, false), text: c.text, from: -1, to: -1, pieces: 0 });
  }
  for (const line of placeLines(s.ctx, zb, width)) {
    const pieces: SelectPiece[] = [];
    for (const p of line.pieces) {
      const leaf = zLeaves[p.leaf];
      if (leaf === undefined) throw new SelectError(`${b.id}: no leaf ${p.leaf}`);
      if (p.truncated || p.shifts.length > 0) throw new SelectError(`${leaf.id}: a truncated or justified line, which the selection model does not measure yet`);
      // The engine's own fragment of the piece (<leaf>:line<j>) must sit where the content-box origin puts it.
      const n = s.nodes[first + p.leaf] as NodeDraft;
      const j = n.pieces;
      n.pieces = j + 1;
      const own = rectOf(s, `${leaf.id}:line${j}`);
      const x = add(left, p.x);
      const y = add(top, p.top);
      if (own.x !== x || own.y !== y) throw new SelectError(`${leaf.id}:line${j} is at ${own.x},${own.y} where the line places it at ${x},${y}`);
      pieces.push({ node: first + p.leaf, start: p.start, end: p.visibleEnd, carets: caretsOf(s, leaf, p.start, p.visibleEnd, x), textTop: y, textHeight: add(p.ascent, p.descent) });
      if (n.from < 0) n.from = p.start;
      n.to = p.visibleEnd;
    }
    s.lines.push({ top: add(top, line.top), bottom: add(add(top, line.top), line.height), pieces });
  }
  for (let i = first; i < s.nodes.length; i++) if ((s.nodes[i] as NodeDraft).from < 0) throw new SelectError(`${(s.nodes[i] as NodeDraft).id} shows nothing`);
}

/** The block of b and its subtree; parent is the nearest element's node. */
function blockOf(s: SelectState, b: LayoutBox, parent: number): number {
  let node = -1;
  if (b.boxType === 'element') {
    if (listed(s.facts.hidden, b.id)) throw new SelectError(`${b.id} has visibility hidden or collapse, whose text the selection model does not skip yet`);
    node = s.nodes.length;
    s.nodes.push({ kind: 'element', id: b.id, parent, end: -1, block: b.id !== s.facts.body, paragraph: listed(s.facts.paragraphs, b.id), selectable: selectableUnder(s, parent, b.id, true), text: '', from: 0, to: 0, pieces: 0 });
  }
  const within = node >= 0 ? node : parent;
  const index = s.blocks.length;
  const r = rectOf(s, b.id);
  const blk: BlockDraft = { node, left: r.x, right: add(r.x, r.width), top: r.y, bottom: add(r.y, r.height), children: [], firstLine: -1, lastLine: -1 };
  s.blocks.push(blk);
  let leaves = false;
  for (const c of b.children) if (c.kind === 'text') leaves = true;
  if (leaves) {
    blk.firstLine = s.lines.length;
    lineBlock(s, b, within);
    blk.lastLine = s.lines.length - 1;
  } else {
    for (const c of b.children) if (c.kind === 'box') blk.children.push(blockOf(s, c, within));
  }
  // A point picks a block child by its border box's bottom, so content below its own (a fixed height) could never be reached.
  let reach = blk.bottom;
  if (blk.firstLine >= 0) reach = (s.lines[blk.lastLine] as SelectLine).bottom;
  else if (blk.children.length > 0) reach = (s.blocks[blk.children[blk.children.length - 1] as number] as BlockDraft).bottom;
  if (reach > blk.bottom) throw new SelectError(`${b.id}'s content overflows its border box, whose selection the model does not measure yet`);
  if (node >= 0) (s.nodes[node] as NodeDraft).end = s.nodes.length;
  return index;
}

function boxRefusal(b: LayoutBox): string | null {
  const st = b.style;
  if (st.display !== 'block') return `${b.id} is display ${st.display}, whose selection the model does not measure yet`;
  if (st.position !== 'static') return `${b.id} is position ${st.position}, whose selection the model does not measure yet`;
  if (st.direction !== 'ltr') return `${b.id} is rtl, whose carets the model does not measure yet`;
  if (st.textAlign === 'justify') return `${b.id} justifies its lines, whose carets the model does not measure yet`;
  if (hasPercent(st.paddingTop) || hasPercent(st.paddingRight) || hasPercent(st.paddingBottom) || hasPercent(st.paddingLeft)) return `${b.id} has percentage padding, which the selection model does not resolve yet`;
  for (const c of b.children) {
    if (c.kind === 'replaced') return `${c.id} is a replaced element, whose selection the model does not measure yet`;
    if (c.kind === 'text') {
      if (c.whiteSpaceCollapse !== 'collapse') return `${c.id} preserves white space, whose selected text the model does not measure yet`;
      if (c.font.family !== AHEM_FACE_ID) return `${c.id} is in ${c.font.family}; the selection model measures carets in Ahem only (a real face needs grapheme clusters and ligature carets)`;
    }
    if (c.kind === 'box') {
      const r = boxRefusal(c);
      if (r !== null) return r;
    }
  }
  return null;
}

/** Why selectionTableOf refuses an engine input, or null when it models it. */
export function selectionRefusal(input: LayoutInput): string | null {
  const hit = hitRefusal(input);
  if (hit !== null) return hit;
  return boxRefusal(input.root);
}

/** The selection table of an engine input, from the engine's own layout of it and the compiler's element facts. */
export function selectionTableOf(input: LayoutInput, measurer: TextMeasurer, facts: SelectFacts): SelectTable {
  const refused = selectionRefusal(input);
  if (refused !== null) throw new SelectError(refused);
  const out = layout(input, measurer);
  if (out.kind !== 'ok') throw new SelectError(`the engine refused the input (${out.unsupported.code} at ${out.unsupported.nodeId})`);
  let zoomed: LayoutInput;
  try {
    zoomed = resolvedInput(input, measurer, NO_ENGINE_FAULTS);
  } catch (e) {
    if (e instanceof UnsupportedSignal) throw new SelectError(`the engine refused the input (${e.unsupported.code} at ${e.unsupported.nodeId})`);
    throw e;
  }
  const zmap = new Map<string, LayoutBox>();
  indexZoomed(zmap, zoomed.root);
  const s: SelectState = { nodes: [], blocks: [], lines: [], abs: absoluteRects(out.boxes), zoomed: zmap, ctx: { measurer, devicePixelRatio: zoomed.devicePixelRatio, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS }, facts };
  blockOf(s, input.root, -1);
  const nodes: SelectNode[] = [];
  for (const n of s.nodes) nodes.push({ kind: n.kind, id: n.id, parent: n.parent, end: n.end, block: n.block, paragraph: n.paragraph, selectable: n.selectable, text: n.text, from: n.from, to: n.to });
  const blocks: SelectBlock[] = [];
  for (const b of s.blocks) blocks.push({ node: b.node, left: b.left, right: b.right, top: b.top, bottom: b.bottom, children: b.children, firstLine: b.firstLine, lastLine: b.lastLine });
  return { nodes, blocks, lines: s.lines };
}

// ---------------------------------------------------------------------------------------------------------------------
// Point to caret, caret to rect, carets to text: what the native selection gestures and copy read.

function lineStart(line: SelectLine): Caret {
  const p = line.pieces[0];
  if (p === undefined) throw new SelectError('an empty line');
  return { node: p.node, offset: p.start };
}

function lineEnd(line: SelectLine): Caret {
  const p = line.pieces[line.pieces.length - 1];
  if (p === undefined) throw new SelectError('an empty line');
  return { node: p.node, offset: p.end };
}

/** The caret of x on a line: before the first glyph whose midpoint x is not right of, else the line's visible end. */
function caretOnLine(line: SelectLine, x: number): Caret {
  for (const p of line.pieces) {
    for (let k = 0; k < p.end - p.start; k++) {
      const a = p.carets[k] as number;
      const b = p.carets[k + 1] as number;
      if (x * 2 <= a + b) return { node: p.node, offset: p.start + k };
    }
  }
  return lineEnd(line);
}

/** The caret a point in LU picks (mouse down for the anchor, the drag's point for the focus); null when the root has no box to pick. */
export function caretAt(t: SelectTable, x: number, y: number): Caret | null {
  if (t.blocks.length === 0) return null;
  let b = 0;
  for (;;) {
    const blk = t.blocks[b] as SelectBlock;
    if (blk.firstLine >= 0) {
      const first = t.lines[blk.firstLine] as SelectLine;
      if (y < first.top) return lineStart(first);
      for (let i = blk.firstLine; i <= blk.lastLine; i++) {
        const line = t.lines[i] as SelectLine;
        if (y < line.bottom) return caretOnLine(line, x);
      }
      return lineEnd(t.lines[blk.lastLine] as SelectLine);
    }
    if (blk.children.length === 0) return blk.node < 0 ? null : { node: blk.node, offset: 0 };
    let next = blk.children[blk.children.length - 1] as number;
    for (const c of blk.children) {
      if (y < (t.blocks[c] as SelectBlock).bottom) {
        next = c;
        break;
      }
    }
    b = next;
  }
}

/** The first selectable caret at or after node i: a text node's first shown code point, or an empty block's own position. */
function selectableFrom(t: SelectTable, i: number): Caret | null {
  for (let k = i; k < t.nodes.length; k++) {
    const n = t.nodes[k] as SelectNode;
    if (!n.selectable) continue;
    if (n.kind === 'text') return { node: k, offset: n.from };
    if (n.end === k + 1) return { node: k, offset: 0 };
  }
  return null;
}

/** The last selectable caret before node i: a text node's last shown code point's end, or an empty block's own position. */
function selectableBefore(t: SelectTable, i: number): Caret | null {
  for (let k = i - 1; k >= 0; k--) {
    const n = t.nodes[k] as SelectNode;
    if (!n.selectable) continue;
    if (n.kind === 'text') return { node: k, offset: n.to };
    if (n.end === k + 1) return { node: k, offset: 0 };
  }
  return null;
}

/** The element a point in LU hits: the deepest block whose border box holds it (in normal flow no two siblings overlap), or the root. */
function hitElement(t: SelectTable, x: number, y: number): number {
  let b = 0;
  let node = (t.blocks[0] as SelectBlock).node;
  for (;;) {
    let next = -1;
    for (const c of (t.blocks[b] as SelectBlock).children) {
      const k = t.blocks[c] as SelectBlock;
      if (x >= k.left && x < k.right && y >= k.top && y < k.bottom) next = c;
    }
    if (next < 0) return node;
    b = next;
    const k = t.blocks[b] as SelectBlock;
    if (k.node >= 0) node = k.node;
  }
}

/**
 * The focus a drag to a point in LU moves to: its caret, or, in a subtree whose used user-select is none, the first selectable
 * caret after that subtree, else the last one before it (measured: Chrome picks the one after in either drag direction).
 */
export function focusAt(t: SelectTable, x: number, y: number): Caret | null {
  const c = caretAt(t, x, y);
  if (c === null || (t.nodes[c.node] as SelectNode).selectable) return c;
  let top = c.node;
  let p = (t.nodes[top] as SelectNode).parent;
  while (p >= 0 && !(t.nodes[p] as SelectNode).selectable) {
    top = p;
    p = (t.nodes[p] as SelectNode).parent;
  }
  const after = selectableFrom(t, (t.nodes[top] as SelectNode).end);
  if (after !== null) return after;
  return selectableBefore(t, top);
}

/**
 * The anchor a press at a point in LU places: null when the element it hits has used user-select none, where Chrome's mouse down
 * starts no selection; else the caret a drag there would focus (a press beside unselectable text can still land after it).
 */
export function anchorAt(t: SelectTable, x: number, y: number): Caret | null {
  if (t.blocks.length === 0) return null;
  const hit = hitElement(t, x, y);
  if (hit >= 0 && !(t.nodes[hit] as SelectNode).selectable) return null;
  return focusAt(t, x, y);
}

/** A point in CSS px floored to LU, as Chrome floors a hit point. */
export function pxToLu(v: number): number {
  return floorOf(v * LU_PX);
}

/** The rect native draws a text caret or handle at: the first piece of its node that holds its offset. */
export function caretRect(t: SelectTable, c: Caret): CaretRect {
  for (const line of t.lines) {
    for (const p of line.pieces) {
      if (p.node === c.node && c.offset >= p.start && c.offset <= p.end) return { x: p.carets[c.offset - p.start] as number, y: p.textTop, height: p.textHeight };
    }
  }
  throw new SelectError(`no line holds offset ${c.offset} of node ${c.node}`);
}

function before(a: Caret, b: Caret): boolean {
  return a.node < b.node || (a.node === b.node && a.offset <= b.offset);
}

/** Code points [from, to) of text. */
function codePoints(text: string, from: number, to: number): string {
  let out = '';
  let k = 0;
  for (const ch of text) {
    if (k >= from && k < to) out += ch;
    k++;
  }
  return out;
}

/** The text iterator's state: what it has emitted, whether any (has_emitted), whether its last character is a newline, and whether it has handled a text node (last_text_node_). */
type Walk = { out: string; emitted: boolean; newline: boolean; text: boolean };

function emitNewlines(w: Walk, n: string): void {
  w.out += n;
  w.emitted = true;
  w.newline = true;
}

/** TextIteratorAlgorithm::ShouldRepresentNodeOffsetZero for a block entered from start s (an element start is an empty block). */
function representsOffsetZero(t: SelectTable, w: Walk, s: Caret, e: number): boolean {
  if (w.newline) return false;
  if (w.emitted) return true;
  if (e === s.node) return false;
  const sn = t.nodes[s.node] as SelectNode;
  return !(e > s.node && e < sn.end);
}

/** RepresentNodeOffsetZero: a newline before a block, when the walk has reason to place it. */
function enter(t: SelectTable, w: Walk, s: Caret, e: number): void {
  if ((t.nodes[e] as SelectNode).block && representsOffsetZero(t, w, s, e)) emitNewlines(w, '\n');
}

/** ExitNode: leaving a block after a text node emits a newline (two for a p) unless nothing follows it in the document. */
function exit(t: SelectTable, w: Walk, e: number): void {
  if (!w.emitted) return;
  const n = t.nodes[e] as SelectNode;
  if (!w.text || !n.block || n.end >= t.nodes.length) return;
  // The extra newline of a p (needs_another_newline_) is emitted at the next step, before anything else.
  if (!w.newline) emitNewlines(w, n.paragraph ? '\n\n' : '\n');
  else if (n.paragraph) emitNewlines(w, '\n');
}

/** The text a selection between two carets copies (Selection.toString), in document order whichever caret is the anchor. */
export function selectedText(t: SelectTable, anchor: Caret, focus: Caret): string {
  const s = before(anchor, focus) ? anchor : focus;
  const e = before(anchor, focus) ? focus : anchor;
  const w: Walk = { out: '', emitted: false, newline: false, text: false };
  let i = s.node;
  for (;;) {
    const n = t.nodes[i] as SelectNode;
    if (!n.selectable) {
      // TextIterator skips what cannot be selected (SkipsUnselectableContent); its exits still run.
    } else if (n.kind === 'element') {
      enter(t, w, s, i);
      // A range that ends at offset 0 of an element represents its position, not its content.
      if (i === e.node) return w.out;
    } else {
      w.text = true;
      // Collapsed text holds no newline, so any code point emitted ends the run of newlines.
      const lo = i === s.node ? s.offset : n.from;
      const hi = i === e.node ? e.offset : n.to;
      if (hi > lo) {
        w.out += codePoints(n.text, lo, hi);
        w.emitted = true;
        w.newline = false;
      }
      if (i === e.node) return w.out;
    }
    const next = i + 1;
    if (next >= t.nodes.length) return w.out;
    // Climbing out of i exits each ancestor whose subtree ends here; i itself is never exited.
    let p = next < n.end ? -1 : n.parent;
    while (p >= 0 && next >= (t.nodes[p] as SelectNode).end) {
      exit(t, w, p);
      p = (t.nodes[p] as SelectNode).parent;
    }
    i = next;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The encoded answers (the translate corpus's select suite and the device lane read these).

function caretCode(c: Caret | null): string {
  if (c === null) return '-';
  return `${c.node.toString(16)}.${c.offset.toString(16)}`;
}

/** The number of code points in text. */
function codePointCount(text: string): number {
  let n = 0;
  for (const ch of text) if ((ch.codePointAt(0) as number) >= 0) n++;
  return n;
}

/**
 * The answers to a list of points and drags, all in LU: for each point (x, y pairs) its anchor and focus carets, with the anchor's
 * rect when it is in text; then for each drag (anchor x, y, focus x, y) the selected text, prefixed by its code point count.
 */
export function selectAnswers(t: SelectTable, points: readonly number[], drags: readonly number[]): string {
  let out = '';
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i] as number;
    const y = points[i + 1] as number;
    const a = anchorAt(t, x, y);
    out = `${out}${caretCode(a)} ${caretCode(focusAt(t, x, y))}`;
    if (a !== null && (t.nodes[a.node] as SelectNode).kind === 'text') {
      const r = caretRect(t, a);
      out = `${out} ${r.x.toString(16)},${r.y.toString(16)},${r.height.toString(16)}`;
    }
    out = `${out};`;
  }
  for (let i = 0; i + 3 < drags.length; i += 4) {
    const a = anchorAt(t, drags[i] as number, drags[i + 1] as number);
    const f = focusAt(t, drags[i + 2] as number, drags[i + 3] as number);
    const text = a === null || f === null ? '' : selectedText(t, a, f);
    out = `${out}${codePointCount(text).toString(16)}:${text};`;
  }
  return out;
}
