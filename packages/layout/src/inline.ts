// Inline formatting of a block container whose children are Ahem text leaves: line breaking (css-text-3 §5, UAX #14 as Blink's
// break iterator applies it, linebreak.ts), white-space phase II at line ends (css-text-3 §4.1.2), text-align (css-text-3 §7.1) and
// line box heights (CSS2 §10.8). Every leaf shares one font, line-height and text-wrap-mode: without inline elements they all
// inherit from one box.
import type { LayoutBox, NormalValue, NumberValue, Px, TextFont, TextLeaf } from './input.ts';
import type { LU } from './units.ts';
import { add, divInt, floorToWholePx, fromFloatRound, lineHeightFromNumber, max, min, mulInt, sub, toPx, ZERO } from './units.ts';
import type { Frag, Placed, Point } from './box.ts';
import type { Ctx } from './block.ts';
import { directionOf } from './block.ts';
import type { LineBreakFaults } from './linebreak.ts';
import { asciiPairBreaks } from './linebreak.ts';
import { coveredIndex } from './text.ts';
import type { FitFaults } from './linefit.ts';
import { fitsAvailable, isHangingSpace } from './linefit.ts';
import { unsupported } from './unsupported.ts';

const SPACE = 0x20;
const ZWSP = 0x200b;
const HYPHEN_MINUS = 0x2d;
const SOLIDUS = 0x2f;

/** One code point of the formatting context, the leaf it belongs to and its code point index in that leaf. */
type Char = { readonly leaf: number; readonly at: number; readonly ch: string; readonly cp: number };

type Run = {
  readonly leaves: readonly TextLeaf[];
  readonly chars: readonly Char[];
  /** The code point indices where a line may start after a soft wrap, in order (linebreak.ts). */
  readonly opportunities: readonly number[];
  /** The line box height (CSS2 §10.8.1). */
  readonly lineHeight: LU;
  readonly ascent: LU;
  readonly descent: LU;
  /** Top half-leading: Blink floors it to a whole px (Chrome deviation half-leading-floor). */
  readonly halfLeading: LU;
};

/** A line: chars [start, end), where end includes the spaces that end the line; [start, visibleEnd) is what the line shows. */
type Line = { readonly start: number; readonly end: number; readonly visibleEnd: number };

/**
 * What one leaf shows on one line. Code points [start, visibleEnd) of the leaf show; [start, end) adds the leaf's own spaces that
 * hang at the line end. x is the line-left offset from the content-box left after text-align and width the advance, top the top
 * of the leaf's content area (its baseline minus its ascent) from the content-box top, ascent and descent the leaf font's.
 */
export type LinePiece = {
  readonly leaf: number;
  readonly start: number;
  readonly visibleEnd: number;
  readonly end: number;
  readonly x: LU;
  readonly width: LU;
  readonly top: LU;
  readonly ascent: LU;
  readonly descent: LU;
};

/** One line box: its top and height, its baseline, all from the content-box top, and the leaf pieces on it in order. */
export type PlacedLine = { readonly top: LU; readonly height: LU; readonly baseline: LU; readonly pieces: readonly LinePiece[] };

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
    const m = ctx.measurer.measure(t.text, leafFont(t));
    if (!m.ok) unsupported('text-glyph', t.id, 'css-fonts-4 §5', m.reason);
    if (t.font.family !== first.font.family || t.font.size !== first.font.size || !sameLineHeight(t, first) || t.textWrapMode !== first.textWrapMode) {
      unsupported('mixed-inline-font', t.id, 'CSS2 §10.8', `text runs with different fonts, line-heights or text-wrap-mode in one formatting context of ${box.id}`);
    }
  }
  const chars: Char[] = [];
  leaves.forEach((t, leaf) => {
    let at = 0;
    for (const ch of t.text) chars.push({ leaf, at: at++, ch, cp: ch.codePointAt(0) as number });
  });
  const metrics = ctx.measurer.metrics(leafFont(first));
  const glyphHeight = add(add(metrics.ascent, metrics.descent), metrics.lineGap);
  const lineHeight = resolveLineHeight(first, glyphHeight);
  // Blink CalculateLeadingSpace: ((line_height - font height) / 2).Floor(), so a line-height below the glyphs gives negative leading.
  // The planted spec reading of deviation half-leading-floor (CSS2 §10.8.1) keeps the exact half.
  const halfLeading = ctx.faults.halfLeadingSpec ? divInt(sub(lineHeight, glyphHeight), 2) : floorToWholePx(divInt(sub(lineHeight, glyphHeight), 2));
  const opportunities = breakOpportunities(ctx, box, chars, first.textWrapMode === 'wrap');
  return { leaves, chars, opportunities, lineHeight, ascent: metrics.ascent, descent: metrics.descent, halfLeading };
}

/**
 * The soft wrap opportunities of the formatting context's text (css-text-3 §5.1): Blink's break iterator (linebreak.ts
 * lineBreakOpportunitiesWith) with the initial word-break, overflow-wrap, line-break and hyphens and the leaf's text-wrap-mode,
 * over the whole content text. Leaf boundaries add no characters, so they neither make nor block an opportunity.
 */
function breakOpportunities(ctx: Ctx, box: LayoutBox, chars: readonly Char[], wrap: boolean): number[] {
  const out: number[] = [];
  if (ctx.faults.spaceOnlyBreaks) {
    // Planted fault spaceOnlyBreaks: the pre-UAX #14 rule, an opportunity only after a space or U+200B (after any spaces that follow).
    if (!wrap) return out;
    for (let i = 0; i + 1 < chars.length; i++) {
      const here = (chars[i] as Char).cp;
      if ((here === SPACE || here === ZWSP) && (chars[i + 1] as Char).cp !== SPACE) out.push(i + 1);
    }
    return out;
  }
  return ahemOpportunities(box, chars.map((c) => c.cp), wrap, { breakAfterSolidus: ctx.faults.breakAfterSolidus, noHyphenDigitBreak: ctx.faults.noHyphenDigitBreak });
}

/**
 * lineBreakOpportunitiesWith (linebreak.ts) on the code points the Ahem measurer covers: printable ASCII but the apostrophe, and
 * U+200B. Over them Blink's pair rules decide every position: a space run breaks after its end, ASCII pairs read Blink's ASCII
 * table (asciiPairBreaks) with the hyphen-before-digit rule, and a pair with U+200B follows UAX #14 LB7 (no break before ZW) and
 * LB8 (a break after ZW, after any spaces). It never reaches linebreak-data.ts, whose Unicode tables the Kotlin translation cannot
 * hold in one JVM class initializer; test/inline.test.ts proves it equal to lineBreakOpportunitiesWith on every pair and triple
 * of these code points and on generated runs. Any other code point is refused (the measurer refuses it first).
 */
export function ahemOpportunities(box: LayoutBox, cps: readonly number[], wrap: boolean, faults: LineBreakFaults): number[] {
  const out: number[] = [];
  for (const cp of cps) if (coveredIndex(cp) < 0) unsupported('line-break', box.id, 'css-text-3 §5', `U+${cp.toString(16).toUpperCase()} is outside the code points the line breaker decides`);
  if (!wrap) return out;
  for (let i = 1; i < cps.length; i++) {
    const cur = cps[i] as number;
    const last = cps[i - 1] as number;
    // BreakSpaceType::kAfterSpaceRun
    if (cur === SPACE) continue;
    if (last === SPACE) {
      out.push(i);
      continue;
    }
    // UAX #14 LB7 (no break before ZW) comes before LB8 (a break after it).
    if (cur === ZWSP) continue;
    if (last === ZWSP) {
      out.push(i);
      continue;
    }
    // LazyLineBreakIterator::ShouldBreakFast over two ASCII code points.
    let breaks = false;
    if (last === HYPHEN_MINUS && cur >= 0x30 && cur <= 0x39) breaks = !faults.noHyphenDigitBreak && i >= 2 && isAsciiAlphanumeric(cps[i - 2] as number);
    else if (faults.breakAfterSolidus && last === SOLIDUS && isAsciiAlphanumeric(cur)) breaks = true;
    else breaks = asciiPairBreaks(last, cur);
    if (breaks) out.push(i);
  }
  return out;
}

function isAsciiAlphanumeric(cp: number): boolean {
  return (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

/** A leaf's font as the measurer reads it: the family and the computed size the environment pass wrote (environment.ts). */
function leafFont(t: TextLeaf): TextFont {
  return { family: t.font.family, size: t.font.size };
}

/** A leaf's line height after the environment pass, which resolves percentages and calculations to px. */
function leafLineHeight(t: TextLeaf): NormalValue | NumberValue | Px {
  const lh = t.lineHeight;
  if (lh.kind === 'percent' || lh.kind === 'calc') throw new Error(`${t.id}: a ${lh.kind} line height reached layout; the environment pass resolves it`);
  return lh;
}

function sameLineHeight(a: TextLeaf, b: TextLeaf): boolean {
  const x = leafLineHeight(a);
  const y = leafLineHeight(b);
  if (x.kind === 'normal' || y.kind === 'normal') return x.kind === y.kind;
  return x.kind === y.kind && x.value === y.value;
}

// CSS2 §10.8.1: normal uses the font's ascent + descent + line gap; numbers multiply the font size.
function resolveLineHeight(t: TextLeaf, normal: LU): LU {
  const lh = leafLineHeight(t);
  if (lh.kind === 'normal') return normal;
  if (lh.kind === 'number') return lineHeightFromNumber(t.font.size, lh.value);
  return fromFloatRound(lh.value);
}

/** Segments between soft wrap opportunities: [start, end), each ending with the spaces or U+200B that precede its opportunity. */
function segments(run: Run): Segment[] {
  const out: Segment[] = [];
  let start = 0;
  for (const at of run.opportunities) {
    out.push({ start, end: at });
    start = at;
  }
  if (start < run.chars.length) out.push({ start, end: run.chars.length });
  return out;
}

/** css-text-3 §4.1.3: the spaces at the end of a line hang (linefit.ts isHangingSpace), so they neither fit nor show. */
function trimEnd(run: Run, start: number, end: number): number {
  let e = end;
  while (e > start && isHangingSpace((run.chars[e - 1] as Char).cp)) e--;
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
    const m = ctx.measurer.measure(text, leafFont(run.leaves[leaf] as TextLeaf));
    if (!m.ok) unsupported('text-glyph', (run.leaves[leaf] as TextLeaf).id, 'css-fonts-4 §5', m.reason);
    total = add(total, m.measure.width);
  }
  return total;
}

/**
 * R4: the min-content advance of chars [start, end), as Blink's fast min-content path measures it (line_breaker.cc
 * HandleTextForFastMinContent): each leaf is one text item, and each leaf's piece is ShapeResult::CachedWidth of its range in the
 * leaf, the difference of the item's ceiled character positions. A piece that starts at its leaf's start equals width().
 */
function cachedWidth(ctx: Ctx, run: Run, start: number, end: number): LU {
  let total = ZERO;
  let i = start;
  while (i < end) {
    const first = run.chars[i] as Char;
    let last = first;
    while (i < end && (run.chars[i] as Char).leaf === first.leaf) last = run.chars[i++] as Char;
    const t = run.leaves[first.leaf] as TextLeaf;
    const m = ctx.measurer.measureRange(t.text, first.at, last.at + 1, leafFont(t));
    if (!m.ok) unsupported('text-glyph', t.id, 'css-fonts-4 §5', m.reason);
    total = add(total, m.measure.width);
  }
  return total;
}

// css-text-3 §5: greedy line breaking at soft wrap opportunities; a segment wider than the line overflows it alone. A line fits
// when its width without the hanging spaces passes Blink's fit test (linefit.ts fitsAvailable: at most the available width plus
// one LayoutUnit); the planted fault fitWithoutEpsilon drops that LayoutUnit.
function breakLines(ctx: Ctx, run: Run, available: LU): Line[] {
  // Planted fault breakOffByOne: a line accepts one more glyph advance than fits, so breaks land one glyph late.
  const glyph = ctx.measurer.measure('X', leafFont(run.leaves[0] as TextLeaf));
  const slack = ctx.faults.breakOffByOne && glyph.ok ? glyph.measure.width : ZERO;
  const fit: FitFaults = { noEpsilon: ctx.faults.fitWithoutEpsilon, breakInsideWord: false };
  const lines: Line[] = [];
  let start = -1;
  let end = -1;
  for (const seg of segments(run)) {
    if (start < 0) {
      start = seg.start;
      end = seg.end;
      continue;
    }
    if (fitsAvailable(toPx(width(ctx, run, start, trimEnd(run, start, seg.end))), add(available, slack), fit)) {
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

/**
 * The line boxes of an inline formatting context whose content is text leaves (CSS2 §10.8, css-text-3 §5 and §7.1), stacked at k
 * times the line height from the content-box top. This is the one source of lines: layout, the native runtime, the break vectors
 * and the line-break reference all read it. A leaf that shows nothing on a line has no piece there.
 */
export function placeLines(ctx: Ctx, box: LayoutBox, leaves: readonly TextLeaf[], available: LU): PlacedLine[] {
  const run = buildRun(ctx, box, leaves);
  const lines = run.chars.length === 0 ? [] : breakLines(ctx, run, available);
  return lines.map((line, k): PlacedLine => {
    const offset = alignOffset(ctx, box, sub(available, width(ctx, run, line.start, line.visibleEnd)));
    const top = mulInt(run.lineHeight, k);
    const baseline = add(add(top, run.halfLeading), run.ascent);
    const pieces: LinePiece[] = [];
    let i = line.start;
    while (i < line.visibleEnd) {
      const first = run.chars[i] as Char;
      const from = i;
      while (i < line.visibleEnd && (run.chars[i] as Char).leaf === first.leaf) i++;
      let through = i;
      while (through < line.end && (run.chars[through] as Char).leaf === first.leaf) through++;
      pieces.push({
        leaf: first.leaf,
        start: first.at,
        visibleEnd: first.at + (i - from),
        end: first.at + (through - from),
        x: add(offset, width(ctx, run, line.start, from)),
        width: width(ctx, run, from, i),
        top: sub(baseline, run.ascent),
        ascent: run.ascent,
        descent: run.descent,
      });
    }
    return { top, height: run.lineHeight, baseline, pieces };
  });
}

/** firstBaseline: the first line box's baseline from the content-box top (CSS2 §10.8.1), or null with no line boxes. */
export type InlineResult = { readonly height: LU; readonly placed: readonly Placed[]; readonly firstBaseline: LU | null };

type Piece = { readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

// CSS2 §10.8 and css-text-3 §5: lays out the leaves in the line boxes of placeLines. Each leaf becomes a fragment covering its
// per-line pieces (<leaf>:line<j>); a leaf with nothing visible on any line has no fragment.
export function layoutInline(ctx: Ctx, box: LayoutBox, leaves: readonly TextLeaf[], available: LU, origin: Point): InlineResult {
  const lines = placeLines(ctx, box, leaves, available);
  const pieces: Piece[][] = leaves.map((): Piece[] => []);
  for (const line of lines) {
    for (const p of line.pieces) (pieces[p.leaf] as Piece[]).push({ x: p.x, y: p.top, width: p.width, height: add(p.ascent, p.descent) });
  }
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
  const last = lines[lines.length - 1];
  const first = lines[0];
  return { height: last === undefined ? ZERO : add(last.top, last.height), placed, firstBaseline: first === undefined ? null : first.baseline };
}

// css-sizing-3 §5.1 with css-text-3 §5: max-content puts the whole context on one line; min-content takes every soft wrap
// opportunity, so it is the widest segment without its trailing spaces, each measured by its cached positions (R4).
export function inlineIntrinsicSize(ctx: Ctx, box: LayoutBox, leaves: readonly TextLeaf[], kind: 'min' | 'max'): LU {
  const run = buildRun(ctx, box, leaves);
  if (kind === 'max') return width(ctx, run, 0, trimEnd(run, 0, run.chars.length));
  let widest = ZERO;
  for (const seg of segments(run)) widest = max(widest, cachedWidth(ctx, run, seg.start, trimEnd(run, seg.start, seg.end)));
  return widest;
}
