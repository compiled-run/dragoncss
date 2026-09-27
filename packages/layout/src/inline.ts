// Inline formatting of a block container whose children are Ahem text leaves: line breaking (css-text-3 §5, UAX #14 subset),
// white-space phase II at line ends (css-text-3 §4.1.2), text-align (css-text-3 §7.1) and line box heights (CSS2 §10.8).
// Every leaf shares one font, line-height and text-wrap-mode: without inline elements they all inherit from one box.
import type { LayoutBox, TextLeaf } from './input.ts';
import type { LU } from './units.ts';
import { add, divInt, floorToWholePx, fromFloatRound, lineHeightFromNumber, max, min, mulInt, sub, ZERO } from './units.ts';
import type { Frag, Placed, Point } from './box.ts';
import type { Ctx } from './block.ts';
import { directionOf } from './block.ts';
import { unsupported } from './unsupported.ts';

const SPACE = 0x20;
const ZWSP = 0x200b;

/** One code point of the formatting context and the leaf it belongs to. */
type Char = { readonly leaf: number; readonly ch: string; readonly cp: number };

type Run = {
  readonly leaves: readonly TextLeaf[];
  readonly chars: readonly Char[];
  readonly wrap: boolean;
  /** The line box height (CSS2 §10.8.1). */
  readonly lineHeight: LU;
  readonly ascent: LU;
  readonly descent: LU;
  /** Top half-leading: Blink floors it to a whole px (Chrome deviation half-leading-floor). */
  readonly halfLeading: LU;
};

/** A line: chars [start, end), where end includes the spaces that end the line; [start, visibleEnd) is what the line shows. */
type Line = { readonly start: number; readonly end: number; readonly visibleEnd: number };

/** UAX #9: in an rtl paragraph these code points keep logical order without reordering (strong L letters, space, U+200B). */
export function isRtlSafe(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    const letter = (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
    if (!letter && cp !== SPACE && cp !== ZWSP) return false;
  }
  return true;
}

/** One code point of an rtl paragraph and the leaf it belongs to. */
type LeafChar = { readonly id: string; readonly ch: string };

/** Chars [start, end) between two soft wrap opportunities. */
type Segment = { readonly start: number; readonly end: number };

// UAX #9 with css-writing-modes-4 §2.4: in an rtl paragraph, strong-L letters with the spaces and U+200B between them form one
// left-to-right run, so every line keeps logical order. Digits, punctuation and other neutrals would be reordered (W and N rules),
// and U+200B ending the paragraph takes the paragraph level (L1) and moves to the line-left end as its own fragment (measured,
// notes/T035-slice-4a.md). Both are refused rather than laid out as ltr.
function checkRtlText(box: LayoutBox, leaves: readonly TextLeaf[]): void {
  for (const t of leaves) {
    if (!isRtlSafe(t.text)) unsupported('bidi-neutral', t.id, 'UAX #9 W1-W7, N1-N2', `text in the rtl paragraph of ${box.id} holds a character other than A-Z, a-z, space and U+200B`);
  }
  // UAX #9 L1: the whitespace sequence ending the paragraph (spaces and U+200B) takes the paragraph level, so a U+200B in it
  // becomes its own fragment; the leaf holding the first such U+200B is named.
  const chars = leaves.flatMap((t) => [...t.text].map((ch): LeafChar => ({ id: t.id, ch })));
  let k = chars.length;
  while (k > 0 && ((chars[k - 1] as LeafChar).ch === ' ' || (chars[k - 1] as LeafChar).ch === '\u200b')) k--;
  const zwsp = chars.slice(k).find((c) => c.ch === '\u200b');
  if (zwsp !== undefined) unsupported('bidi-neutral', zwsp.id, 'UAX #9 L1', `U+200B in the whitespace that ends the rtl paragraph of ${box.id} would take the paragraph direction`);
}

// CSS2 §10.8: the leaves of one inline formatting context must share their font and line-height (no inline elements yet).
function buildRun(ctx: Ctx, box: LayoutBox, leaves: readonly TextLeaf[]): Run {
  const first = leaves[0] as TextLeaf;
  if (directionOf(ctx, box) === 'rtl') checkRtlText(box, leaves);
  for (const t of leaves) {
    const m = ctx.measurer.measure(t.text, t.font);
    if (!m.ok) unsupported('text-glyph', t.id, 'css-fonts-4 §5', m.reason);
    if (t.font.family !== first.font.family || t.font.size !== first.font.size || !sameLineHeight(t, first) || t.textWrapMode !== first.textWrapMode) {
      unsupported('mixed-inline-font', t.id, 'CSS2 §10.8', `text runs with different fonts, line-heights or text-wrap-mode in one formatting context of ${box.id}`);
    }
  }
  const chars: Char[] = [];
  leaves.forEach((t, leaf) => {
    for (const ch of t.text) chars.push({ leaf, ch, cp: ch.codePointAt(0) as number });
  });
  const metrics = ctx.measurer.metrics(first.font);
  const glyphHeight = add(add(metrics.ascent, metrics.descent), metrics.lineGap);
  const lineHeight = resolveLineHeight(first, glyphHeight);
  // Blink CalculateLeadingSpace: ((line_height - font height) / 2).Floor(), so a line-height below the glyphs gives negative leading.
  // The planted spec reading of deviation half-leading-floor (CSS2 §10.8.1) keeps the exact half.
  const halfLeading = ctx.faults.halfLeadingSpec ? divInt(sub(lineHeight, glyphHeight), 2) : floorToWholePx(divInt(sub(lineHeight, glyphHeight), 2));
  return { leaves, chars, wrap: first.textWrapMode === 'wrap', lineHeight, ascent: metrics.ascent, descent: metrics.descent, halfLeading };
}

function sameLineHeight(a: TextLeaf, b: TextLeaf): boolean {
  const x = a.lineHeight;
  const y = b.lineHeight;
  if (x.kind === 'normal' || y.kind === 'normal') return x.kind === y.kind;
  return x.kind === y.kind && x.value === y.value;
}

// CSS2 §10.8.1: normal uses the font's ascent + descent + line gap; numbers multiply the font size.
function resolveLineHeight(t: TextLeaf, normal: LU): LU {
  const lh = t.lineHeight;
  if (lh.kind === 'normal') return normal;
  if (lh.kind === 'number') return lineHeightFromNumber(t.font.size, lh.value);
  return fromFloatRound(lh.value);
}

// css-text-3 §5.1 with UAX #14 LB8 and LB18: a soft wrap opportunity follows a space or U+200B (after any spaces that follow it).
// text-wrap-mode: nowrap suppresses every opportunity (css-text-4 §5.1).
function breaksAfter(run: Run, i: number): boolean {
  if (!run.wrap) return false;
  const here = run.chars[i] as Char;
  const next = run.chars[i + 1];
  if (next === undefined) return false;
  return (here.cp === SPACE || here.cp === ZWSP) && next.cp !== SPACE;
}

/** Segments between soft wrap opportunities: [start, end), each ending with the spaces or U+200B that precede its opportunity. */
function segments(run: Run): Segment[] {
  const out: Segment[] = [];
  let start = 0;
  for (let i = 0; i < run.chars.length; i++) {
    if (breaksAfter(run, i)) {
      out.push({ start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < run.chars.length) out.push({ start, end: run.chars.length });
  return out;
}

/** css-text-3 §4.1.2: collapsible spaces at the end of a line are removed, so they neither fit nor show. */
function trimEnd(run: Run, start: number, end: number): number {
  let e = end;
  while (e > start && (run.chars[e - 1] as Char).cp === SPACE) e--;
  return e;
}

/** The advance of chars [start, end): each leaf's piece is measured as one run (Blink shapes per text item) and summed. */
function width(ctx: Ctx, run: Run, start: number, end: number): LU {
  let total = ZERO;
  let i = start;
  while (i < end) {
    const leaf = (run.chars[i] as Char).leaf;
    let text = '';
    while (i < end && (run.chars[i] as Char).leaf === leaf) text += (run.chars[i++] as Char).ch;
    const m = ctx.measurer.measure(text, (run.leaves[leaf] as TextLeaf).font);
    if (!m.ok) unsupported('text-glyph', (run.leaves[leaf] as TextLeaf).id, 'css-fonts-4 §5', m.reason);
    total = add(total, m.measure.width);
  }
  return total;
}

// css-text-3 §5: greedy line breaking at soft wrap opportunities; a segment wider than the line overflows it alone.
function breakLines(ctx: Ctx, run: Run, available: LU): Line[] {
  // Planted fault breakOffByOne: a line accepts one more glyph advance than fits, so breaks land one glyph late.
  const glyph = ctx.measurer.measure('X', (run.leaves[0] as TextLeaf).font);
  const slack = ctx.faults.breakOffByOne && glyph.ok ? glyph.measure.width : ZERO;
  const lines: Line[] = [];
  let start = -1;
  let end = -1;
  for (const seg of segments(run)) {
    if (start < 0) {
      start = seg.start;
      end = seg.end;
      continue;
    }
    if (width(ctx, run, start, trimEnd(run, start, seg.end)) <= add(available, slack)) {
      end = seg.end;
      continue;
    }
    lines.push({ start, end, visibleEnd: trimEnd(run, start, end) });
    start = seg.start;
    end = seg.end;
  }
  if (start >= 0) lines.push({ start, end, visibleEnd: trimEnd(run, start, end) });
  return lines;
}

// css-text-3 §7.1 (Blink LineOffsetForTextAlign): the line-left offset of a line with free space free. start and end map through
// the box's direction to left and right; center takes LayoutUnit / 2 from the left. A line wider than the box is start-aligned,
// so it overflows to the right in ltr and to the left in rtl.
function alignOffset(ctx: Ctx, box: LayoutBox, free: LU): LU {
  const align = box.style.textAlign;
  if (align === 'justify') unsupported('text-align', box.id, 'css-text-3 §7.3', 'text-align: justify is not yet proven against Chrome');
  const rtl = directionOf(ctx, box) === 'rtl';
  if (free <= 0) return rtl ? free : ZERO;
  const physical = align === 'start' ? (rtl ? 'right' : 'left') : align === 'end' ? (rtl ? 'left' : 'right') : align;
  if (physical === 'left') return ZERO;
  if (physical === 'center') return divInt(free, 2);
  return free;
}

/** firstBaseline: the first line box's baseline from the content-box top (CSS2 §10.8.1), or null with no line boxes. */
export type InlineResult = { readonly height: LU; readonly placed: readonly Placed[]; readonly firstBaseline: LU | null };

type Piece = { readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

// CSS2 §10.8 and css-text-3 §5: lays out the leaves in line boxes stacked at k times the line height. Each leaf becomes a
// fragment covering its per-line pieces (<leaf>:line<j>); a leaf with nothing visible on any line has no fragment.
export function layoutInline(ctx: Ctx, box: LayoutBox, leaves: readonly TextLeaf[], available: LU, origin: Point): InlineResult {
  const run = buildRun(ctx, box, leaves);
  const lines = run.chars.length === 0 ? [] : breakLines(ctx, run, available);
  const pieces: Piece[][] = leaves.map((): Piece[] => []);
  const glyphHeight = add(run.ascent, run.descent);
  lines.forEach((line, k) => {
    const offset = alignOffset(ctx, box, sub(available, width(ctx, run, line.start, line.visibleEnd)));
    const y = add(mulInt(run.lineHeight, k), run.halfLeading);
    let i = line.start;
    while (i < line.visibleEnd) {
      const leaf = (run.chars[i] as Char).leaf;
      const from = i;
      while (i < line.visibleEnd && (run.chars[i] as Char).leaf === leaf) i++;
      (pieces[leaf] as Piece[]).push({ x: add(offset, width(ctx, run, line.start, from)), y, width: width(ctx, run, from, i), height: glyphHeight });
    }
  });
  const placed: Placed[] = [];
  leaves.forEach((t, leaf) => {
    const own = pieces[leaf] as Piece[];
    const firstPiece = own[0];
    if (firstPiece === undefined) return;
    // CSSOM View getBoundingClientRect of a Range: the smallest rectangle containing its client rects.
    let left = firstPiece.x;
    let top = firstPiece.y;
    let right = add(firstPiece.x, firstPiece.width);
    let bottom = add(firstPiece.y, firstPiece.height);
    for (const p of own) {
      left = min(left, p.x);
      top = min(top, p.y);
      right = max(right, add(p.x, p.width));
      bottom = max(bottom, add(p.y, p.height));
    }
    const children: Placed[] = own.map((p, j): Placed => ({ frag: { id: `${t.id}:line${j}`, width: p.width, height: p.height, baseline: null, children: [], outOfFlow: [] }, x: sub(p.x, left), y: sub(p.y, top) }));
    const frag: Frag = { id: t.id, width: sub(right, left), height: sub(bottom, top), baseline: null, children, outOfFlow: [] };
    placed.push({ frag, x: add(origin.x, left), y: add(origin.y, top) });
  });
  return { height: mulInt(run.lineHeight, lines.length), placed, firstBaseline: lines.length === 0 ? null : add(run.halfLeading, run.ascent) };
}

// css-sizing-3 §5.1 with css-text-3 §5: max-content puts the whole context on one line; min-content takes every soft wrap
// opportunity, so it is the widest segment without its trailing spaces.
export function inlineIntrinsicSize(ctx: Ctx, box: LayoutBox, leaves: readonly TextLeaf[], kind: 'min' | 'max'): LU {
  const run = buildRun(ctx, box, leaves);
  if (kind === 'max') return width(ctx, run, 0, trimEnd(run, 0, run.chars.length));
  let widest = ZERO;
  for (const seg of segments(run)) widest = max(widest, width(ctx, run, seg.start, trimEnd(run, seg.start, seg.end)));
  return widest;
}
