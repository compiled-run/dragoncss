// Inline formatting (CSS2 §9.4.2, §10.8; css-text-3 §4.1.2, §5, §7.1) of a block container whose children are inline-level: Ahem
// text leaves, inline boxes and line breaks. The content is flattened into items (characters, open and close tags, <br>), broken
// at UAX #14 opportunities as Blink's break iterator applies them (linebreak.ts) and at every <br>, fitted with Blink's fit test
// (linefit.ts), and each line box is sized from the strut and every inline box on it, aligned at their baselines (CSS2 §10.8.1).
// Rounding follows Blink 145 as INL-P measured it (docs/research/inline-spike/blink-notes.md §4, §5).
import type { FontSpec, InlineBox, InlineChild, LayoutBox, LineBreak, LineHeightValue, MarginValue, NormalValue, NumberValue, PaddingValue, Px, TextFont, TextLeaf } from './input.ts';
import type { LU } from './units.ts';
import { add, divInt, floorToWholePx, fromFloatRound, fromRaw, lineHeightFromNumber, max, min, sub, toPx, ZERO } from './units.ts';
import type { Frag, Placed, Point } from './box.ts';
import { resolveBorder } from './box.ts';
import type { Ctx } from './block.ts';
import { directionOf } from './block.ts';
import type { LineBreakFaults } from './linebreak.ts';
import { asciiPairBreaks } from './linebreak.ts';
import { AHEM_FACE_ID, coveredIndex } from './text.ts';
import { scriptCode, scriptExtensions, USCRIPT_COMMON, USCRIPT_INHERITED, USCRIPT_LATIN } from './script-data.ts';
import type { BreakItem, BreakResult, BrokenLine } from './shaping.ts';
import { breakItemLines } from './shaping.ts';
import type { FitFaults } from './linefit.ts';
import { fitsAvailable, isHangingSpace } from './linefit.ts';
import { unsupported } from './unsupported.ts';

const SPACE = 0x20;
const ZWSP = 0x200b;
const HYPHEN_MINUS = 0x2d;
const SOLIDUS = 0x2f;

/**
 * One item of the formatting context in tree order: a code point of a leaf, the open or close tag of an inline box, or a <br>.
 * box is the innermost inline box holding the item (-1 for the root), or for a tag the box it opens or closes.
 */
type Item = { readonly kind: 'char' | 'open' | 'close' | 'br'; readonly leaf: number; readonly at: number; readonly ch: string; readonly cp: number; readonly box: number; readonly br: number };

/** The ascent and descent a box or the strut adds around the baseline with its half-leadings (CSS2 §10.8.1), and its font's A and D. */
type BoxMetrics = { readonly above: LU; readonly below: LU; readonly ascent: LU; readonly descent: LU };

/** A place a line may start: an item index, and whether the line before it ends there by force (after a <br>). */
type Boundary = { readonly at: number; readonly forced: boolean };

export type Ifc = {
  readonly leaves: readonly TextLeaf[];
  readonly boxes: readonly InlineBox[];
  /** The index of each box's parent box, or -1 for the root. */
  readonly boxParent: readonly number[];
  readonly brs: readonly LineBreak[];
  readonly items: readonly Item[];
  readonly boundaries: readonly Boundary[];
  readonly strut: BoxMetrics;
  readonly boxMetrics: readonly BoxMetrics[];
  /** Each box's first and last item index holding its visible content or a <br>, or -1 when it holds none. */
  readonly firstContent: readonly number[];
  readonly lastContent: readonly number[];
  readonly openAt: readonly number[];
  readonly closeAt: readonly number[];
  /** Whether a leaf names a face other than Ahem: real-font lines come from LineBreaker (shaping.ts breakItemLines). */
  readonly shaped: boolean;
  /** For real-font text: the char items a line may start at (soft wrap opportunities), ascending. */
  readonly opportunityItems: readonly number[];
};

/**
 * One text result of a real-font line: the char items [from, to) of one leaf, its inline size, and its inline size without a
 * trailing space that hangs at the line end (visibleTo is where that space starts, else to).
 */
type ShapedPiece = { readonly from: number; readonly to: number; readonly visibleTo: number; readonly width: LU; readonly visibleWidth: LU };

/**
 * A line: items [start, end); the characters before visibleEnd show, and the ones after it (spaces) hang. A real-font line also
 * carries its text results (pieces), whose inline sizes the line's widths sum; an Ahem line has none and is measured by width.
 */
type Line = { readonly start: number; readonly end: number; readonly visibleEnd: number; readonly pieces: readonly ShapedPiece[] };

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

/** A rectangle in LU from the content-box top-left. */
type Rect = { readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

/**
 * One line box: its top and height and its baseline, all from the content-box top, the leaf pieces on it in order (their leaf
 * indices are into inlineLeaves), and the inline box fragments and <br>s on it, by index into inlineBoxes and inlineBreaks.
 */
export type PlacedLine = {
  readonly top: LU;
  readonly height: LU;
  readonly baseline: LU;
  readonly pieces: readonly LinePiece[];
  readonly boxes: readonly number[];
  readonly boxRects: readonly Rect[];
  readonly breaks: readonly number[];
  readonly breakRects: readonly Rect[];
};

/** UAX #9: in an rtl paragraph these code points keep logical order without reordering (strong L letters, space, U+200B). */
export function isRtlSafe(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    const letter = (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
    if (!letter && cp !== SPACE && cp !== ZWSP) return false;
  }
  return true;
}

// UAX #9 with css-writing-modes-4 §2.4: in an rtl paragraph, strong-L letters with the spaces and U+200B between them form one
// left-to-right run, so every line keeps logical order. Digits, punctuation and other neutrals would be reordered (W and N rules),
// and U+200B ending the paragraph takes the paragraph level (L1) and moves to the line-left end as its own fragment (measured,
// notes/T035-slice-4a.md). Both are refused rather than laid out as ltr.
function checkRtlText(box: LayoutBox, leaves: readonly TextLeaf[], items: readonly Item[]): void {
  for (const t of leaves) {
    if (!isRtlSafe(t.text)) unsupported('bidi-neutral', t.id, 'UAX #9 W1-W7, N1-N2', `text in the rtl paragraph of ${box.id} holds a character other than A-Z, a-z, space and U+200B`);
  }
  // UAX #9 L1: the whitespace sequence (spaces and U+200B) before a paragraph separator (a <br>, which Blink lays out as U+000A,
  // bidi class B) or at the end of the paragraph takes the paragraph level, so a U+200B in it becomes its own fragment; the leaf
  // holding the first such U+200B is named.
  let zwsp = -1;
  for (const it of items) {
    if (it.kind === 'br') {
      if (zwsp >= 0) unsupported('bidi-neutral', (leaves[zwsp] as TextLeaf).id, 'UAX #9 L1', `U+200B in the whitespace before a <br> in the rtl paragraph of ${box.id} would take the paragraph direction`);
      continue;
    }
    if (it.kind !== 'char') continue;
    if (it.cp === SPACE) continue;
    if (it.cp === ZWSP) {
      if (zwsp < 0) zwsp = it.leaf;
      continue;
    }
    zwsp = -1;
  }
  if (zwsp >= 0) unsupported('bidi-neutral', (leaves[zwsp] as TextLeaf).id, 'UAX #9 L1', `U+200B in the whitespace that ends the rtl paragraph of ${box.id} would take the paragraph direction`);
}

/** The text leaves of a block container's inline formatting context, in tree order (the leaf indices of LinePiece). */
export function inlineLeaves(box: LayoutBox): TextLeaf[] {
  const out: TextLeaf[] = [];
  const walk = (kids: readonly InlineChild[]): void => {
    for (const k of kids) {
      if (k.kind === 'text') out.push(k);
      else if (k.kind === 'inline') walk(k.children);
    }
  };
  walk(inlineChildren(box));
  return out;
}

/** The inline boxes of a block container's inline formatting context, in tree order (the box indices of PlacedLine). */
export function inlineBoxes(box: LayoutBox): InlineBox[] {
  const out: InlineBox[] = [];
  const walk = (kids: readonly InlineChild[]): void => {
    for (const k of kids) {
      if (k.kind === 'inline') {
        out.push(k);
        walk(k.children);
      }
    }
  };
  walk(inlineChildren(box));
  return out;
}

/** The <br>s of a block container's inline formatting context, in tree order (the break indices of PlacedLine). */
export function inlineBreaks(box: LayoutBox): LineBreak[] {
  const out: LineBreak[] = [];
  const walk = (kids: readonly InlineChild[]): void => {
    for (const k of kids) {
      if (k.kind === 'br') out.push(k);
      else if (k.kind === 'inline') walk(k.children);
    }
  };
  walk(inlineChildren(box));
  return out;
}

/** A block container's children as inline content; validateLayoutInput rejects boxes beside inline content. */
function inlineChildren(box: LayoutBox): InlineChild[] {
  const out: InlineChild[] = [];
  for (const c of box.children) {
    if (c.kind === 'box' || c.kind === 'replaced') throw new Error(`${box.id} mixes boxes and inline content; validateLayoutInput rejects this input`);
    out.push(c);
  }
  return out;
}

/** A font as the measurer reads it: the family and the computed size the environment pass wrote (environment.ts). */
function fontOf(f: FontSpec): TextFont {
  return { family: f.family, size: f.size };
}

/** A line height after the environment pass, which resolves percentages and calculations to px. */
function resolvedLineHeight(id: string, lh: LineHeightValue): NormalValue | NumberValue | Px {
  if (lh.kind === 'percent' || lh.kind === 'calc') throw new Error(`${id}: a ${lh.kind} line height reached layout; the environment pass resolves it`);
  return lh;
}

// CSS2 §10.8.1 (Blink InlineBoxState::ComputeTextMetrics): the font's rounded ascent and descent, and the line height's leading
// split around them. normal uses the font's ascent + descent + line gap; numbers multiply the font size. Blink
// CalculateLeadingSpace floors the ascent-side half-leading to a whole px, so a line-height below the glyphs gives negative
// leading, and the descent side takes the rest. The planted spec reading of deviation half-leading-floor keeps the exact half,
// and planted fault halfLeadingUnflooredPerBox keeps it for inline boxes only.
function metricsOf(ctx: Ctx, id: string, font: FontSpec, lineHeight: LineHeightValue, inlineBox: boolean): BoxMetrics {
  const m = ctx.measurer.metrics(fontOf(font));
  const glyphHeight = add(add(m.ascent, m.descent), m.lineGap);
  const lh = resolvedLineHeight(id, lineHeight);
  const height = lh.kind === 'normal' ? glyphHeight : lh.kind === 'number' ? lineHeightFromNumber(font.size, lh.value) : fromFloatRound(lh.value);
  const exact = ctx.faults.halfLeadingSpec || (inlineBox && ctx.faults.halfLeadingUnflooredPerBox);
  const half = exact ? divInt(sub(height, glyphHeight), 2) : floorToWholePx(divInt(sub(height, glyphHeight), 2));
  const above = add(m.ascent, half);
  return { above, below: sub(height, above), ascent: m.ascent, descent: m.descent };
}

/** Whether a margin or padding is zero: a zero px or percentage (a calculation counts as a decoration). */
function isZeroLength(kind: string, value: number): boolean {
  return (kind === 'px' || kind === 'percent') && value === 0;
}

function lengthValue(v: MarginValue | PaddingValue): number {
  return v.kind === 'px' || v.kind === 'percent' ? v.value : 1;
}

function zeroEdge(v: MarginValue | PaddingValue): boolean {
  return isZeroLength(v.kind, lengthValue(v));
}

// INL1a scope: inline box margins, borders and padding (INL1b), vertical-align other than baseline (INL2) and a relatively
// positioned inline box are refused with typed codes rather than laid out approximately. Block-axis margins do not apply to
// inline boxes (CSS2 §10.6.1), so they are ignored.
function checkInlineBox(ctx: Ctx, b: InlineBox): void {
  const s = b.style;
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const decorated = !zeroEdge(s.marginLeft) || !zeroEdge(s.marginRight) || !zeroEdge(s.paddingTop) || !zeroEdge(s.paddingRight) || !zeroEdge(s.paddingBottom)
    || !zeroEdge(s.paddingLeft) || bor.top !== 0 || bor.right !== 0 || bor.bottom !== 0 || bor.left !== 0;
  if (decorated) unsupported('inline-box-decoration', b.id, 'CSS2 §10.8, css-break-3 §5.4', `inline box ${b.id} has an inline margin, a border or padding (INL1b)`);
  const va = s.verticalAlign;
  if (va.kind !== 'keyword' || va.value !== 'baseline') unsupported('vertical-align', b.id, 'CSS2 §10.8.1', `vertical-align other than baseline on ${b.id} (INL2)`);
  if (s.position !== 'static') unsupported('inline-box-position', b.id, 'CSS2 §9.4.3', `a ${s.position} inline box ${b.id}`);
}

/** Collects the formatting context's leaves, boxes (with their parents), <br>s and items in tree order. */
type Flat = { readonly leaves: TextLeaf[]; readonly boxes: InlineBox[]; readonly boxParent: number[]; readonly brs: LineBreak[]; readonly items: Item[] };

function flatten(ctx: Ctx, kids: readonly InlineChild[], parent: number, out: Flat): void {
  for (const k of kids) {
    if (k.kind === 'text') {
      const leaf = out.leaves.length;
      out.leaves.push(k);
      let at = 0;
      for (const ch of k.text) out.items.push({ kind: 'char', leaf, at: at++, ch, cp: ch.codePointAt(0) as number, box: parent, br: -1 });
    } else if (k.kind === 'br') {
      const br = out.brs.length;
      out.brs.push(k);
      out.items.push({ kind: 'br', leaf: -1, at: -1, ch: '', cp: -1, box: parent, br });
    } else {
      checkInlineBox(ctx, k);
      const b = out.boxes.length;
      out.boxes.push(k);
      out.boxParent.push(parent);
      out.items.push({ kind: 'open', leaf: -1, at: -1, ch: '', cp: -1, box: b, br: -1 });
      flatten(ctx, k.children, b, out);
      out.items.push({ kind: 'close', leaf: -1, at: -1, ch: '', cp: -1, box: b, br: -1 });
    }
  }
}

/** Whether box b is inner or b itself (box indices; -1 is the root). */
function within(boxParent: readonly number[], inner: number, b: number): boolean {
  let at = inner;
  while (at >= 0) {
    if (at === b) return true;
    at = boxParent[at] as number;
  }
  return false;
}

/** Whether an item is content that shows or ends a line: a character that does not hang, or a <br>. */
function isContent(it: Item): boolean {
  return it.kind === 'br' || (it.kind === 'char' && !isHangingSpace(it.cp));
}

/** The first (or, with last, the last) index of an item that is content of box b, or -1. */
function contentIndex(items: readonly Item[], boxParent: readonly number[], b: number, last: boolean): number {
  let found = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Item;
    if (!isContent(it) || !within(boxParent, it.box, b)) continue;
    if (!last) return i;
    found = i;
  }
  return found;
}

/** The index of box b's open (or close) tag. */
function tagIndex(items: readonly Item[], b: number, kind: 'open' | 'close'): number {
  for (let i = 0; i < items.length; i++) if ((items[i] as Item).kind === kind && (items[i] as Item).box === b) return i;
  throw new Error(`no ${kind} tag for inline box ${b}`);
}

/** Flattens the formatting context into items and resolves its boxes' metrics. */
export function buildIfc(ctx: Ctx, box: LayoutBox): Ifc {
  const flat: Flat = { leaves: [], boxes: [], boxParent: [], brs: [], items: [] };
  flatten(ctx, inlineChildren(box), -1, flat);
  const items = flat.items;
  if (directionOf(ctx, box) === 'rtl') checkRtlText(box, flat.leaves, items);
  const first = flat.leaves[0];
  let shaped = false;
  for (const t of flat.leaves) if (t.font.family !== AHEM_FACE_ID) shaped = true;
  if (shaped) checkShapedText(ctx, box, flat.leaves, items);
  for (const t of flat.leaves) {
    const m = ctx.measurer.measure(t.text, fontOf(t.font));
    if (!m.ok) unsupported('text-glyph', t.id, 'css-fonts-4 §5', m.reason);
    if (first !== undefined && t.textWrapMode !== first.textWrapMode) {
      unsupported('mixed-text-wrap-mode', t.id, 'css-text-4 §5.1', `text runs with different text-wrap-mode in one formatting context of ${box.id}`);
    }
  }
  const strut = box.strut;
  if (strut === null) throw new Error(`${box.id} has inline content and no strut; validateLayoutInput rejects this input`);
  const starts: number[] = [];
  const boundaries = boundariesOf(ctx, box, items, first === undefined || first.textWrapMode === 'wrap', shaped, starts);
  return {
    leaves: flat.leaves,
    boxes: flat.boxes,
    boxParent: flat.boxParent,
    brs: flat.brs,
    items,
    boundaries,
    strut: metricsOf(ctx, box.id, strut.font, strut.lineHeight, false),
    boxMetrics: flat.boxes.map((b) => metricsOf(ctx, b.id, b.font, b.lineHeight, true)),
    firstContent: flat.boxes.map((_, b) => contentIndex(items, flat.boxParent, b, false)),
    lastContent: flat.boxes.map((_, b) => contentIndex(items, flat.boxParent, b, true)),
    openAt: flat.boxes.map((_, b) => tagIndex(items, b, 'open')),
    closeAt: flat.boxes.map((_, b) => tagIndex(items, b, 'close')),
    shaped,
    opportunityItems: [...starts].sort((x, y) => x - y),
  };
}

/** Whether every code point is in R4's Latin scope: Script Latin, or Common or Inherited whose Script_Extensions hold Latin. */
function latinScopeRefusal(text: string): string {
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    const sc = scriptCode(cp);
    if (sc === USCRIPT_LATIN) continue;
    const at = `U+${cp.toString(16).toUpperCase()}`;
    if (sc !== USCRIPT_COMMON && sc !== USCRIPT_INHERITED) return `${at} is outside Latin, Common and Inherited`;
    const ext = scriptExtensions(cp);
    let latin = false;
    for (const e of ext) if (e === USCRIPT_LATIN) latin = true;
    const plain = ext.length === 1 && ((ext[0] as number) === USCRIPT_COMMON || (ext[0] as number) === USCRIPT_INHERITED);
    if (!latin && !plain) return `${at} is Common or Inherited, but its Script_Extensions exclude Latin, so Blink shapes it in a run of its own`;
  }
  return '';
}

/**
 * TXT1a-1 scope for real-font text: R4's Latin scope (planted fault latinCheckSkipped skips it), and no two adjacent leaves in one
 * face and size, which Blink shapes as one run (InlineNode::ShapeText) where Dragon shapes each leaf alone.
 */
function checkShapedText(ctx: Ctx, box: LayoutBox, leaves: readonly TextLeaf[], items: readonly Item[]): void {
  if (!ctx.faults.latinCheckSkipped) {
    for (const t of leaves) {
      const r = latinScopeRefusal(t.text);
      if (r !== '') unsupported('text-script', t.id, 'TXT1a R4', `${r}; real-font text is Latin only (TXT1c, TXT2)`);
    }
  }
  let last = -1;
  for (const it of items) {
    if (it.kind === 'br') last = -1;
    if (it.kind !== 'char' || it.leaf === last) continue;
    const prev = last < 0 ? null : (leaves[last] as TextLeaf);
    const t = leaves[it.leaf] as TextLeaf;
    if (prev !== null && prev.font.family === t.font.family && prev.font.size === t.font.size) {
      unsupported('text-shaping-run', t.id, 'css-text-3 §7.3 (boundary shaping)', `${prev.id} and ${t.id} are adjacent text in one face and size, which Blink shapes as one run`);
    }
    last = it.leaf;
  }
}

/** The first item index after item i and the close tags that follow it: where a line that ends at item i ends. */
function afterCloses(items: readonly Item[], i: number): number {
  let at = i + 1;
  while (at < items.length && (items[at] as Item).kind === 'close') at++;
  return at;
}

/** Adds the soft boundaries of one run of text (the item indices of its characters) to out. */
function addSoftBoundaries(ctx: Ctx, box: LayoutBox, items: readonly Item[], run: readonly number[], wrap: boolean, shaped: boolean, out: Boundary[], starts: number[]): void {
  for (const p of opportunities(ctx, box, run.map((i) => (items[i] as Item).cp), wrap, shaped)) {
    out.push({ at: afterCloses(items, run[p - 1] as number), forced: false });
    starts.push(run[p] as number);
  }
}

/**
 * Where lines may start (css-text-3 §5.1). Soft wrap opportunities come from Blink's break iterator over the text between <br>s
 * (ahemOpportunities; a <br> is class BK, a mandatory break, and no pair spans it), with the initial word-break, overflow-wrap,
 * line-break and hyphens and the leaves' text-wrap-mode. Tags add no characters, so box boundaries are transparent: an
 * opportunity between two characters becomes a boundary after the close tags that follow the first (Blink moves a break before a
 * close tag after it) and before any open tag. A <br> forces a boundary after it and the close tags that follow it.
 */
function boundariesOf(ctx: Ctx, box: LayoutBox, items: readonly Item[], wrap: boolean, shaped: boolean, starts: number[]): Boundary[] {
  const out: Boundary[] = [];
  let run: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Item;
    if (it.kind === 'char') run.push(i);
    else if (it.kind === 'br' && !ctx.faults.brIgnored) {
      addSoftBoundaries(ctx, box, items, run, wrap, shaped, out, starts);
      run = [];
      out.push({ at: afterCloses(items, i), forced: true });
    } else if (ctx.faults.breakAtBoxBoundary && wrap && run.length > 0 && (it.kind === 'open' || it.kind === 'close')) {
      // Planted fault breakAtBoxBoundary: a soft wrap opportunity at every box boundary inside text.
      addSoftBoundaries(ctx, box, items, run, wrap, shaped, out, starts);
      run = [];
      out.push({ at: it.kind === 'open' ? i : afterCloses(items, i), forced: false });
    }
  }
  addSoftBoundaries(ctx, box, items, run, wrap, shaped, out, starts);
  // One boundary per place, in item order; a forced one wins over a soft one at the same place.
  const ordered = [...out].sort((x, y) => (x.at !== y.at ? x.at - y.at : x.forced === y.forced ? 0 : x.forced ? -1 : 1));
  const sorted: Boundary[] = [];
  let lastAt = 0;
  for (const b of ordered) {
    if (b.at <= lastAt || b.at >= items.length) continue;
    sorted.push(b);
    lastAt = b.at;
  }
  return sorted;
}

/** The soft wrap opportunities of one run of text: code point positions where a line may start (ahemOpportunities). */
function opportunities(ctx: Ctx, box: LayoutBox, cps: readonly number[], wrap: boolean, shaped: boolean): number[] {
  const out: number[] = [];
  if (cps.length === 0) return out;
  if (ctx.faults.spaceOnlyBreaks) {
    // Planted fault spaceOnlyBreaks: the pre-UAX #14 rule, an opportunity only after a space or U+200B (after any spaces that follow).
    if (!wrap) return out;
    for (let i = 0; i + 1 < cps.length; i++) {
      const here = cps[i] as number;
      if ((here === SPACE || here === ZWSP) && (cps[i + 1] as number) !== SPACE) out.push(i + 1);
    }
    return out;
  }
  const faults: LineBreakFaults = { breakAfterSolidus: ctx.faults.breakAfterSolidus, noHyphenDigitBreak: ctx.faults.noHyphenDigitBreak };
  return shaped ? latinOpportunities(box, cps, wrap, faults) : ahemOpportunities(box, cps, wrap, faults);
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

// ---------------------------------------------------------------------------------------------------------------------------
// R4 (TXT1a-1): soft wrap opportunities of real-font Latin text. linebreak-data.ts stays out of the translated engine (its tables do
// not fit one JVM class initializer), so the classes of the Latin code points Dragon breaks are listed here and the UAX #14 rules
// that reach them are applied; test/inline-latin.test.ts proves this equal to lineBreakOpportunitiesWith (linebreak.ts) on every
// pair and triple of these code points and on generated runs. Any other code point is refused.

const LC_AL = 0;
const LC_SP = 1;
const LC_EX = 2;
const LC_QU = 3;
const LC_QU_PI = 4;
const LC_QU_PF = 5;
const LC_PR = 6;
const LC_PO = 7;
const LC_OP = 8;
const LC_CP = 9;
const LC_CL = 10;
const LC_IS = 11;
const LC_HY = 12;
const LC_SY = 13;
const LC_NU = 14;
const LC_BA = 15;
const LC_BB = 16;
const LC_GL = 17;
const LC_B2 = 18;
const LC_IN = 19;
const LC_ZW = 20;

/** Line_Break of U+0020..U+007E (UCD 16.0.0, AI resolved to AL by LB1). */
const ASCII_CLASSES: readonly number[] = [
  LC_SP, LC_EX, LC_QU, LC_AL, LC_PR, LC_PO, LC_AL, LC_QU, LC_OP, LC_CP, LC_AL, LC_PR, LC_IS, LC_HY, LC_IS, LC_SY,
  LC_NU, LC_NU, LC_NU, LC_NU, LC_NU, LC_NU, LC_NU, LC_NU, LC_NU, LC_NU, LC_IS, LC_IS, LC_AL, LC_AL, LC_AL, LC_EX,
  LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL,
  LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_OP, LC_PR, LC_CP, LC_AL, LC_AL,
  LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL,
  LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_OP, LC_BA, LC_CL, LC_AL,
];

/** Line_Break of U+00A0..U+00FF (AI resolved to AL). */
const LATIN1_CLASSES: readonly number[] = [
  LC_GL, LC_OP, LC_PO, LC_PR, LC_PR, LC_PR, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_QU_PI, LC_AL, LC_BA, LC_AL, LC_AL,
  LC_PO, LC_PR, LC_AL, LC_AL, LC_BB, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_QU_PF, LC_AL, LC_AL, LC_AL, LC_OP,
  LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL,
  LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL,
  LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL,
  LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL, LC_AL,
];

/** The resolved Line_Break class of a code point Dragon breaks in real-font text, or -1 when it is outside that set. */
export function latinBreakClass(cp: number): number {
  if (cp >= 0x20 && cp <= 0x7e) return ASCII_CLASSES[cp - 0x20] as number;
  if (cp >= 0xa0 && cp <= 0xff) return LATIN1_CLASSES[cp - 0xa0] as number;
  if (cp === 0x2010 || cp === 0x2012 || cp === 0x2013) return LC_BA;
  if (cp === 0x2011) return LC_GL;
  if (cp === 0x2014) return LC_B2;
  if (cp === 0x2018 || cp === 0x201c) return LC_QU_PI;
  if (cp === 0x2019 || cp === 0x201d) return LC_QU_PF;
  if (cp === 0x2026) return LC_IN;
  if (cp === ZWSP) return LC_ZW;
  return -1;
}

function isQuote(c: number): boolean {
  return c === LC_QU || c === LC_QU_PI || c === LC_QU_PF;
}

function latinClassAt(cls: readonly number[], k: number): number {
  return k >= 0 && k < cls.length ? (cls[k] as number) : -1;
}

function spacesBack(cls: readonly number[], k: number): number {
  let j = k;
  while (j >= 0 && (cls[j] as number) === LC_SP) j--;
  return j;
}

/**
 * UAX #14 (revision 53) before unit k of the classes, restricted to the classes latinBreakClass gives: none of them is East Asian
 * wide, combining, ideographic, Hangul, regional, emoji or Brahmic, so those rules never apply (linebreak.ts unitBreak).
 */
function latinUnitBreak(cls: readonly number[], cps: readonly number[], k: number): boolean {
  const p = latinClassAt(cls, k - 1);
  const c = latinClassAt(cls, k);
  const n = latinClassAt(cls, k + 1);
  // LB7
  if (c === LC_SP || c === LC_ZW) return false;
  // LB8
  const beforeSpaces = spacesBack(cls, k - 1);
  if (latinClassAt(cls, beforeSpaces) === LC_ZW) return true;
  // LB12, LB12a
  if (p === LC_GL) return false;
  if (c === LC_GL && p !== LC_SP && p !== LC_BA && p !== LC_HY) return false;
  // LB13
  if (c === LC_CL || c === LC_CP || c === LC_EX || c === LC_SY) return false;
  // LB14
  if (latinClassAt(cls, beforeSpaces) === LC_OP) return false;
  // LB15a
  if (latinClassAt(cls, beforeSpaces) === LC_QU_PI) {
    const b = latinClassAt(cls, beforeSpaces - 1);
    if (beforeSpaces === 0 || b === LC_OP || isQuote(b) || b === LC_GL || b === LC_SP || b === LC_ZW) return false;
  }
  // LB15b
  if (c === LC_QU_PF) {
    if (k + 1 >= cls.length) return false;
    if (n === LC_SP || n === LC_GL || n === LC_CL || isQuote(n) || n === LC_CP || n === LC_EX || n === LC_IS || n === LC_SY || n === LC_ZW) return false;
  }
  // LB15c, LB15d
  if (p === LC_SP && c === LC_IS && n === LC_NU) return true;
  if (c === LC_IS) return false;
  // LB17
  if (c === LC_B2 && latinClassAt(cls, beforeSpaces) === LC_B2) return false;
  // LB18
  if (p === LC_SP) return true;
  // LB19, LB19a (no Latin quote neighbour is East Asian)
  if (isQuote(c) || isQuote(p)) return false;
  // LB20a
  if ((p === LC_HY || (cps[k - 1] as number) === 0x2010) && c === LC_AL) {
    const b = latinClassAt(cls, k - 2);
    if (k - 2 < 0 || b === LC_SP || b === LC_ZW || b === LC_GL) return false;
  }
  // LB21
  if (c === LC_BA || c === LC_HY || p === LC_BB) return false;
  // LB22
  if (c === LC_IN) return false;
  // LB23
  if (p === LC_AL && c === LC_NU) return false;
  if (p === LC_NU && c === LC_AL) return false;
  // LB24
  if ((p === LC_PR || p === LC_PO) && c === LC_AL) return false;
  if (p === LC_AL && (c === LC_PR || c === LC_PO)) return false;
  // LB25
  if (c === LC_PO || c === LC_PR) {
    let j = k - 1;
    if (latinClassAt(cls, j) === LC_CL || latinClassAt(cls, j) === LC_CP) j--;
    while (latinClassAt(cls, j) === LC_SY || latinClassAt(cls, j) === LC_IS) j--;
    if (latinClassAt(cls, j) === LC_NU) return false;
  }
  if (p === LC_PO || p === LC_PR) {
    if (c === LC_NU) return false;
    if (c === LC_OP && n === LC_NU) return false;
    if (c === LC_OP && n === LC_IS && latinClassAt(cls, k + 2) === LC_NU) return false;
  }
  if ((p === LC_HY || p === LC_IS) && c === LC_NU) return false;
  if (c === LC_NU) {
    let j = k - 1;
    while (latinClassAt(cls, j) === LC_SY || latinClassAt(cls, j) === LC_IS) j--;
    if (latinClassAt(cls, j) === LC_NU) return false;
  }
  // LB28
  if (p === LC_AL && c === LC_AL) return false;
  // LB29
  if (p === LC_IS && c === LC_AL) return false;
  // LB30
  if ((p === LC_AL || p === LC_NU) && c === LC_OP) return false;
  if (p === LC_CP && (c === LC_AL || c === LC_NU)) return false;
  // LB31
  return true;
}

/** UAX #14 break permission before every unit of the run (index 0 never), as uax14BreakAllowed gives it. */
function latinBreaksAllowed(cps: readonly number[]): boolean[] {
  const cls: number[] = [];
  for (const cp of cps) cls.push(latinBreakClass(cp));
  const out: boolean[] = [];
  for (let i = 0; i < cps.length; i++) out.push(i > 0 && latinUnitBreak(cls, cps, i));
  return out;
}

/**
 * lineBreakOpportunitiesWith (linebreak.ts) on the code points latinBreakClass covers: a space run breaks after its end; ASCII
 * pairs read Blink's ASCII table with the hyphen-before-digit rule; Latin-1 pairs read ICU's rule on the pair alone
 * (LineBreakData::FillFromIcu); any other pair reads UAX #14 over the whole run. Returns code point positions where a line may
 * start; a code point outside the set is refused.
 */
export function latinOpportunities(box: LayoutBox, cps: readonly number[], wrap: boolean, faults: LineBreakFaults): number[] {
  const out: number[] = [];
  for (const cp of cps) if (latinBreakClass(cp) < 0) unsupported('line-break', box.id, 'css-text-3 §5', `U+${cp.toString(16).toUpperCase()} is outside the code points the line breaker decides`);
  if (!wrap) return out;
  let full: boolean[] = [];
  let haveFull = false;
  for (let i = 1; i < cps.length; i++) {
    const cur = cps[i] as number;
    const last = cps[i - 1] as number;
    if (cur === SPACE) continue;
    if (last === SPACE) {
      out.push(i);
      continue;
    }
    let decided = false;
    let breaks = false;
    if (last >= 0x21 && cur >= 0x21) {
      if (last === HYPHEN_MINUS && cur <= 0x7f && cur >= 0x30 && cur <= 0x39) {
        decided = true;
        breaks = !faults.noHyphenDigitBreak && i >= 2 && isAsciiAlphanumeric(cps[i - 2] as number);
      } else if (last === HYPHEN_MINUS && cur > 0x7f) {
        decided = false;
      } else if (last <= 0xff && cur <= 0xff) {
        decided = true;
        if (last <= 0x7f && cur <= 0x7f) breaks = faults.breakAfterSolidus && last === SOLIDUS && isAsciiAlphanumeric(cur) ? true : asciiPairBreaks(last, cur);
        else breaks = latinBreaksAllowed([last, cur])[1] as boolean;
      }
    } else {
      decided = true;
      breaks = false;
    }
    if (!decided) {
      if (!haveFull) {
        full = latinBreaksAllowed(cps);
        haveFull = true;
      }
      breaks = full[i] as boolean;
    }
    if (breaks) out.push(i);
  }
  return out;
}

function isAsciiAlphanumeric(cp: number): boolean {
  return (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

/**
 * The end of what items [start, end) show: after the last character that does not hang (css-text-3 §4.1.3). Spaces before a <br>
 * hang like spaces before a soft wrap (INL-P f2-after-space), and a <br> advances nothing.
 */
function visibleEndOf(ifc: Ifc, start: number, end: number): number {
  for (let i = end - 1; i >= start; i--) {
    const it = ifc.items[i] as Item;
    if (it.kind === 'char' && !isHangingSpace(it.cp)) return i + 1;
  }
  return start;
}

/** The advance of the characters in items [start, end): each leaf's piece is measured as one run (Blink shapes per text item). */
function width(ctx: Ctx, ifc: Ifc, start: number, end: number): LU {
  let total = ZERO;
  let i = start;
  while (i < end) {
    const it = ifc.items[i] as Item;
    if (it.kind !== 'char') {
      i++;
      continue;
    }
    let text = '';
    while (i < end && (ifc.items[i] as Item).kind === 'char' && (ifc.items[i] as Item).leaf === it.leaf) text += (ifc.items[i++] as Item).ch;
    const t = ifc.leaves[it.leaf] as TextLeaf;
    const m = ctx.measurer.measure(text, fontOf(t.font));
    if (!m.ok) unsupported('text-glyph', t.id, 'css-fonts-4 §5', m.reason);
    total = add(total, m.measure.width);
  }
  return total;
}

/**
 * R4: the min-content advance of the characters in items [start, end), as Blink's fast min-content path measures it
 * (line_breaker.cc HandleTextForFastMinContent): each leaf is one text item, and each leaf's piece is ShapeResult::CachedWidth of
 * its range in the leaf, the difference of the item's ceiled character positions.
 */
function cachedWidth(ctx: Ctx, ifc: Ifc, start: number, end: number): LU {
  let total = ZERO;
  let i = start;
  while (i < end) {
    const first = ifc.items[i] as Item;
    if (first.kind !== 'char') {
      i++;
      continue;
    }
    let last = first;
    while (i < end && (ifc.items[i] as Item).kind === 'char' && (ifc.items[i] as Item).leaf === first.leaf) last = ifc.items[i++] as Item;
    const t = ifc.leaves[first.leaf] as TextLeaf;
    const m = ctx.measurer.measureRange(t.text, first.at, last.at + 1, fontOf(t.font));
    if (!m.ok) unsupported('text-glyph', t.id, 'css-fonts-4 §5', m.reason);
    total = add(total, m.measure.width);
  }
  return total;
}

/** Whether items [start, end) hold a character or a <br>: a line without either is empty and makes no line box (Blink IsEmptyLine). */
function hasContent(ifc: Ifc, start: number, end: number): boolean {
  for (let i = start; i < end; i++) if ((ifc.items[i] as Item).kind === 'char' || (ifc.items[i] as Item).kind === 'br') return true;
  return false;
}

/** The boundaries, then the end of the items as a final forced one. */
function endsOf(ifc: Ifc): Boundary[] {
  const out: Boundary[] = [];
  for (const b of ifc.boundaries) out.push(b);
  out.push({ at: ifc.items.length, forced: true });
  return out;
}

// css-text-3 §5: greedy line breaking. A line takes segments between boundaries while they fit, and always its first; a forced
// boundary ends it. A line fits when its width without the hanging spaces passes Blink's fit test (linefit.ts fitsAvailable: at
// most the available width plus one LayoutUnit); the planted fault fitWithoutEpsilon drops that LayoutUnit. Items after the last
// <br> without a character make no line (Blink IsEmptyLine); an inline box that would start there is refused, as where Blink
// puts it is not measured. A context without any character or <br> has no line at all (INL-P f1-empty-root).
function breakLines(ctx: Ctx, ifc: Ifc, available: LU): Line[] {
  // Planted fault breakOffByOne: a line accepts one more glyph advance than fits, so breaks land one glyph late.
  const firstLeaf = ifc.leaves[0];
  let slack = ZERO;
  if (ctx.faults.breakOffByOne && firstLeaf !== undefined) {
    const glyph = ctx.measurer.measure('X', fontOf(firstLeaf.font));
    if (glyph.ok) slack = glyph.measure.width;
  }
  const fit: FitFaults = { noEpsilon: ctx.faults.fitWithoutEpsilon, breakInsideWord: false };
  const ends = endsOf(ifc);
  const lines: Line[] = [];
  let start = 0;
  let k = 0;
  while (start < ifc.items.length) {
    if (!hasContent(ifc, start, ifc.items.length)) {
      for (let i = start; i < ifc.items.length && lines.length > 0; i++) {
        const it = ifc.items[i] as Item;
        if (it.kind === 'open') unsupported('inline-empty-line', (ifc.boxes[it.box] as InlineBox).id, 'CSS2 §9.4.2', `inline box ${(ifc.boxes[it.box] as InlineBox).id} starts on an empty line after the last line break`);
      }
      break;
    }
    let end = (ends[k] as Boundary).at;
    let forced = (ends[k] as Boundary).forced;
    k++;
    while (!forced && k < ends.length) {
      const next = ends[k] as Boundary;
      if (!fitsAvailable(toPx(width(ctx, ifc, start, visibleEndOf(ifc, start, next.at))), add(available, slack), fit)) break;
      end = next.at;
      forced = next.forced;
      k++;
    }
    lines.push({ start, end, visibleEnd: visibleEndOf(ifc, start, end), pieces: [] });
    start = end;
  }
  return lines;
}

/** Whether ShapeLine must reshape a line end at a space (LineInfo::ComputeNeedsAccurateEndPosition): text-align off the start side. */
function needsAccurateEnd(ctx: Ctx, box: LayoutBox): boolean {
  const a = box.style.textAlign;
  const rtl = directionOf(ctx, box) === 'rtl';
  return a === 'end' || a === 'center' || a === 'justify' || (a === 'left' && rtl) || (a === 'right' && !rtl);
}

/** The next char after item i (skipping tags), or -1 at a <br> or the end. */
function nextCharAfter(ifc: Ifc, i: number): number {
  for (let j = i + 1; j < ifc.items.length; j++) {
    const it = ifc.items[j] as Item;
    if (it.kind === 'char') return j;
    if (it.kind === 'br') return -1;
  }
  return -1;
}

function prevCharBefore(ifc: Ifc, i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    const it = ifc.items[j] as Item;
    if (it.kind === 'char') return j;
    if (it.kind === 'br') return -1;
  }
  return -1;
}

function opportunityAt(ifc: Ifc, i: number): boolean {
  for (const o of ifc.opportunityItems) if (o === i) return true;
  return false;
}

/** The formatting context as LineBreaker items (shaping.ts BreakItem): one text item per leaf, its tags and <br>s; and their first item indices. */
type ShapedItems = { readonly items: readonly BreakItem[]; readonly firstItem: readonly number[] };

function shapedItemsOf(ctx: Ctx, ifc: Ifc): ShapedItems {
  const items: BreakItem[] = [];
  const firstItem: number[] = [];
  let offset = 0;
  let i = 0;
  while (i < ifc.items.length) {
    const it = ifc.items[i] as Item;
    if (it.kind === 'char') {
      const first = i;
      while (i < ifc.items.length && (ifc.items[i] as Item).kind === 'char' && (ifc.items[i] as Item).leaf === it.leaf) i++;
      const t = ifc.leaves[it.leaf] as TextLeaf;
      const s = ctx.measurer.shaped(t.text, fontOf(t.font));
      if (!s.ok) unsupported('text-glyph', t.id, 'css-fonts-4 §5', s.reason);
      if (s.result.end !== i - first) unsupported('text-glyph', t.id, 'css-fonts-4 §5', `${t.id} holds a code point outside the Basic Multilingual Plane`);
      const opps: number[] = [];
      for (let o = 1; o < i - first; o++) if (opportunityAt(ifc, first + o)) opps.push(o);
      // CanBreakAfter: an opportunity before the next char; none before a <br> (UAX #14 LB6); the end of the text is one.
      const next = nextCharAfter(ifc, i - 1);
      let atEnd = next >= 0 ? opportunityAt(ifc, next) : true;
      if (next < 0) for (let j = i; j < ifc.items.length && (ifc.items[j] as Item).kind !== 'char'; j++) if ((ifc.items[j] as Item).kind === 'br') atEnd = false;
      items.push({ kind: 'text', item: s.item, result: s.result, opportunities: opps, atEnd, offset });
      firstItem.push(first);
      offset = offset + (i - first);
      continue;
    }
    if (it.kind === 'open') items.push({ kind: 'open', offset });
    else if (it.kind === 'close') {
      const before = prevCharBefore(ifc, i);
      const after = nextCharAfter(ifc, i);
      items.push({ kind: 'close', offset, spaceBefore: before >= 0 && (ifc.items[before] as Item).cp === SPACE, spaceAfter: after >= 0 && (ifc.items[after] as Item).cp === SPACE });
    } else {
      items.push({ kind: 'br', offset });
      offset++;
    }
    firstItem.push(i);
    i++;
  }
  return { items, firstItem };
}

/** The item index of a LineBreaker position. */
function itemIndexOf(ifc: Ifc, s: ShapedItems, index: number, offset: number): number {
  if (index >= s.items.length) return ifc.items.length;
  return (s.firstItem[index] as number) + ((s.items[index] as BreakItem).kind === 'text' ? offset : 0);
}

// css-text-3 §5 for real-font text: Blink's LineBreaker over the shaped leaves (shaping.ts breakItemLines), with its fit test
// (one LayoutUnit of epsilon; planted fault fitWithoutEpsilon drops it) and ShapeLine's reshaping at line edges. A line's text
// results keep their inline sizes, which place the pieces.
function breakShapedLines(ctx: Ctx, box: LayoutBox, ifc: Ifc, available: LU): Line[] {
  const firstLeaf = ifc.leaves[0];
  let slack = ZERO;
  if (ctx.faults.breakOffByOne && firstLeaf !== undefined) {
    const glyph = ctx.measurer.measure('X', fontOf(firstLeaf.font));
    if (glyph.ok) slack = glyph.measure.width;
  }
  const s = shapedItemsOf(ctx, ifc);
  const wrap = firstLeaf === undefined || firstLeaf.textWrapMode === 'wrap';
  const r = breakItemLines(s.items, add(available, slack), wrap, needsAccurateEnd(ctx, box), !ctx.faults.fitWithoutEpsilon);
  if (!r.ok) unsupported('line-break', box.id, 'css-text-3 §5', r.reason);
  const lines: Line[] = [];
  let start = 0;
  for (const bl of r.lines) {
    if (!hasContent(ifc, start, ifc.items.length)) break;
    const end = itemIndexOf(ifc, s, bl.nextItem, bl.nextOffset);
    lines.push({ start, end, visibleEnd: visibleEndOf(ifc, start, end), pieces: piecesOf(ifc, s, bl) });
    start = end;
  }
  for (let i = start; i < ifc.items.length && lines.length > 0; i++) {
    const it = ifc.items[i] as Item;
    if (it.kind === 'open') unsupported('inline-empty-line', (ifc.boxes[it.box] as InlineBox).id, 'CSS2 §9.4.2', `inline box ${(ifc.boxes[it.box] as InlineBox).id} starts on an empty line after the last line break`);
  }
  return lines;
}

function piecesOf(ifc: Ifc, s: ShapedItems, bl: BrokenLine): ShapedPiece[] {
  const out: ShapedPiece[] = [];
  for (let k = 0; k < bl.results.length; k++) {
    const res = bl.results[k] as BreakResult;
    const it = s.items[res.index] as BreakItem;
    if (it.kind !== 'text' || res.end === res.start) continue;
    const from = (s.firstItem[res.index] as number) + res.start;
    const to = (s.firstItem[res.index] as number) + res.end;
    const visibleWidth = bl.visibleWidths[k] as LU;
    const hangs = visibleWidth !== res.width && (ifc.items[to - 1] as Item).cp === SPACE;
    out.push({ from, to, visibleTo: hangs ? to - 1 : to, width: res.width, visibleWidth });
  }
  return out;
}

/**
 * The advance of items [start, end) of a line: an Ahem line measures its leaf pieces (width); a real-font line sums the inline
 * sizes of its text results there, a result cut at its hanging trailing space taking its size without it.
 */
function spanWidth(ctx: Ctx, ifc: Ifc, line: Line, start: number, end: number): LU {
  if (!ifc.shaped) return width(ctx, ifc, start, end);
  let total = ZERO;
  for (const p of line.pieces) {
    if (p.from < start || p.from >= end) continue;
    if (end >= p.to) total = add(total, p.width);
    else if (end >= p.visibleTo) total = add(total, p.visibleWidth);
    else throw new Error(`a span of items [${start}, ${end}) cuts the text result [${p.from}, ${p.to})`);
  }
  return total;
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
 * Whether box b is on a line of items [start, end): it holds visible content or a <br> there, or it holds none anywhere and opens
 * there (an empty box, INL-P f1-empty-box). A box whose line holds only its open tag and hanging spaces is on the next line
 * instead (Blink RewindTrailingOpenTags, INL-P f3-box-space-inside).
 */
function boxOnLine(ifc: Ifc, b: number, start: number, end: number): boolean {
  const first = ifc.firstContent[b] as number;
  if (first < 0) return (ifc.openAt[b] as number) >= start && (ifc.openAt[b] as number) < end;
  return first < end && (ifc.lastContent[b] as number) >= start;
}

/** The x of the pen before item i of a line, from the content-box left: tags and hanging spaces advance nothing. */
function penAt(ctx: Ctx, ifc: Ifc, line: Line, offset: LU, i: number): LU {
  return add(offset, spanWidth(ctx, ifc, line, line.start, i < line.visibleEnd ? i : line.visibleEnd));
}

/**
 * The x of a <br> at item i: after the line's content, at the paragraph level, so in rtl at the line-left end of the content
 * (UAX #9 L1, INL-P f2-*).
 */
function breakX(ctx: Ctx, ifc: Ifc, line: Line, offset: LU, rtl: boolean, i: number): LU {
  return rtl ? offset : penAt(ctx, ifc, line, offset, i);
}

/** The first <br> inside box b (between its tags) within items [start, end), or -1 when a visible character comes first or there is none. */
function onlyBreakIn(ifc: Ifc, b: number, start: number, end: number): number {
  const open = ifc.openAt[b] as number;
  const close = ifc.closeAt[b] as number;
  let br = -1;
  for (let i = open + 1 > start ? open + 1 : start; i < close && i < end; i++) {
    const it = ifc.items[i] as Item;
    if (it.kind === 'br' && br < 0) br = i;
    else if (it.kind === 'char' && !isHangingSpace(it.cp)) return -1;
  }
  return br;
}

/**
 * The line boxes of a block container's inline formatting context (CSS2 §10.8, css-text-3 §5 and §7.1), stacked by their own
 * heights from the content-box top. This is the one source of lines: layout, the native runtime, the break vectors and the
 * line-break reference all read it. A leaf that shows nothing on a line has no piece there.
 */
export function placeLines(ctx: Ctx, box: LayoutBox, available: LU): PlacedLine[] {
  return placeIfcLines(ctx, box, buildIfc(ctx, box), available);
}

export function placeIfcLines(ctx: Ctx, box: LayoutBox, ifc: Ifc, available: LU): PlacedLine[] {
  const lines = ifc.shaped ? breakShapedLines(ctx, box, ifc, available) : breakLines(ctx, ifc, available);
  const rtl = directionOf(ctx, box) === 'rtl';
  const out: PlacedLine[] = [];
  let top = ZERO;
  for (const line of lines) {
    const offset = alignOffset(ctx, box, sub(available, spanWidth(ctx, ifc, line, line.start, line.visibleEnd)));
    const on: number[] = [];
    for (let b = 0; b < ifc.boxes.length; b++) if (boxOnLine(ifc, b, line.start, line.end)) on.push(b);
    // CSS2 §10.8.1 with baseline alignment: the strut and every inline box on the line add their ascent and descent with their
    // half-leadings around one baseline (planted fault lineHeightIgnoresInlineBoxes keeps the strut's only).
    let above = ifc.strut.above;
    let below = ifc.strut.below;
    if (!ctx.faults.lineHeightIgnoresInlineBoxes) {
      for (const b of on) {
        above = max(above, (ifc.boxMetrics[b] as BoxMetrics).above);
        below = max(below, (ifc.boxMetrics[b] as BoxMetrics).below);
      }
    }
    const baseline = add(top, above);
    const height = add(above, below);
    const endX = penAt(ctx, ifc, line, offset, line.visibleEnd);
    const pieces: LinePiece[] = [];
    let i = line.start;
    while (i < line.visibleEnd) {
      const it = ifc.items[i] as Item;
      if (it.kind !== 'char') {
        i++;
        continue;
      }
      const from = i;
      while (i < line.visibleEnd && (ifc.items[i] as Item).kind === 'char' && (ifc.items[i] as Item).leaf === it.leaf) i++;
      let through = i;
      while (through < line.end && (ifc.items[through] as Item).kind === 'char' && (ifc.items[through] as Item).leaf === it.leaf) through++;
      const t = ifc.leaves[it.leaf] as TextLeaf;
      const m = ctx.measurer.metrics(fontOf(t.font));
      // Planted fault fragmentFromLineTop: the leaf's content area starts at the line top instead of its baseline minus its ascent.
      const pieceTop = ctx.faults.fragmentFromLineTop ? top : sub(baseline, m.ascent);
      pieces.push({ leaf: it.leaf, start: it.at, visibleEnd: it.at + (i - from), end: it.at + (through - from), x: penAt(ctx, ifc, line, offset, from), width: spanWidth(ctx, ifc, line, from, i), top: pieceTop, ascent: m.ascent, descent: m.descent });
    }
    // A <br>'s content area is its parent box's (Blink places the control item with the parent's text top and height).
    const breaks: number[] = [];
    const breakRects: Rect[] = [];
    for (let j = line.start; j < line.end; j++) {
      const it = ifc.items[j] as Item;
      if (it.kind !== 'br') continue;
      const p = it.box < 0 ? ifc.strut : (ifc.boxMetrics[it.box] as BoxMetrics);
      breaks.push(it.br);
      breakRects.push({ x: breakX(ctx, ifc, line, offset, rtl, j), y: sub(baseline, p.ascent), width: ZERO, height: add(p.ascent, p.descent) });
    }
    // An inline box's fragment spans its content on the line over its own content area (INL-P f1-*): from its open tag, or the
    // line start when it continues, to its close tag, or the end of the line's content when it continues. A box whose only
    // content on the line is a <br> sits at the <br>.
    const boxRects: Rect[] = [];
    for (const b of on) {
      const bm = ifc.boxMetrics[b] as BoxMetrics;
      const open = ifc.openAt[b] as number;
      const close = ifc.closeAt[b] as number;
      let left = open >= line.start ? penAt(ctx, ifc, line, offset, open) : offset;
      let right = close < line.end ? penAt(ctx, ifc, line, offset, close) : endX;
      const br = onlyBreakIn(ifc, b, line.start, line.end);
      if (br >= 0) {
        left = breakX(ctx, ifc, line, offset, rtl, br);
        right = left;
      }
      boxRects.push({ x: left, y: sub(baseline, bm.ascent), width: sub(right, left), height: add(bm.ascent, bm.descent) });
    }
    out.push({ top, height, baseline, pieces, boxes: on, boxRects, breaks, breakRects });
    top = add(top, height);
  }
  return out;
}

/** firstBaseline: the first line box's baseline from the content-box top (CSS2 §10.8.1), or null with no line boxes. */
export type InlineResult = { readonly height: LU; readonly placed: readonly Placed[]; readonly firstBaseline: LU | null; readonly lines: number };

/** Chrome's getBoundingClientRect of a list of rects (gfx::RectF::Union): an empty accumulation takes the next rect, an empty rect adds nothing. */
function boundingOf(rects: readonly Rect[]): Rect {
  let r = rects[0] as Rect;
  for (let i = 1; i < rects.length; i++) {
    const n = rects[i] as Rect;
    if (r.width === 0 || r.height === 0) r = n;
    else if (n.width !== 0 && n.height !== 0) {
      const left = min(r.x, n.x);
      const top = min(r.y, n.y);
      r = { x: left, y: top, width: sub(max(add(r.x, r.width), add(n.x, n.width)), left), height: sub(max(add(r.y, r.height), add(n.y, n.height)), top) };
    }
  }
  return r;
}

/** A fragment for id holding its per-line rects as <id>:line<j> children, placed at its bounding rect. */
function fragmentOf(id: string, rects: readonly Rect[], origin: Point, bounding: Rect): Placed {
  const children: Placed[] = rects.map((p, j): Placed => ({ frag: { id: `${id}:line${j}`, width: p.width, height: p.height, baseline: null, children: [], outOfFlow: [] }, x: sub(p.x, bounding.x), y: sub(p.y, bounding.y) }));
  const frag: Frag = { id, width: bounding.width, height: bounding.height, baseline: null, children, outOfFlow: [] };
  return { frag, x: add(origin.x, bounding.x), y: add(origin.y, bounding.y) };
}

/** The union of a leaf's piece rects (CSSOM View getBoundingClientRect of a Range: the smallest rectangle containing them). */
function unionOf(rects: readonly Rect[]): Rect {
  const r0 = rects[0] as Rect;
  let left = r0.x;
  let top = r0.y;
  let right = add(r0.x, r0.width);
  let bottom = add(r0.y, r0.height);
  for (const p of rects) {
    left = min(left, p.x);
    top = min(top, p.y);
    right = max(right, add(p.x, p.width));
    bottom = max(bottom, add(p.y, p.height));
  }
  return { x: left, y: top, width: sub(right, left), height: sub(bottom, top) };
}

/** The fragments of the formatting context, keyed by id, in the order placeFragments reads them. */
type Fragments = { readonly placed: Map<string, Placed> };

/** Adds each leaf's, box's and <br>'s fragment of the lines to out, keyed by id. */
function collectFragments(ifc: Ifc, lines: readonly PlacedLine[], origin: Point, startX: LU, out: Fragments): void {
  ifc.leaves.forEach((t, li) => {
    const rects: Rect[] = [];
    for (const line of lines) for (const p of line.pieces) if (p.leaf === li) rects.push({ x: p.x, y: p.top, width: p.width, height: add(p.ascent, p.descent) });
    if (rects.length > 0) out.placed.set(t.id, fragmentOf(t.id, rects, origin, unionOf(rects)));
  });
  ifc.boxes.forEach((b, bi) => {
    const rects: Rect[] = [];
    for (const line of lines) for (let j = 0; j < line.boxes.length; j++) if ((line.boxes[j] as number) === bi) rects.push(line.boxRects[j] as Rect);
    if (rects.length === 0 && lines.length > 0) throw new Error(`${b.id} is on no line`);
    if (rects.length === 0) rects.push({ x: startX, y: ZERO, width: ZERO, height: ZERO });
    out.placed.set(b.id, fragmentOf(b.id, rects, origin, boundingOf(rects)));
  });
  ifc.brs.forEach((br, ri) => {
    for (const line of lines) {
      for (let j = 0; j < line.breaks.length; j++) {
        if ((line.breaks[j] as number) !== ri) continue;
        const r = line.breakRects[j] as Rect;
        out.placed.set(br.id, { frag: { id: br.id, width: r.width, height: r.height, baseline: null, children: [], outOfFlow: [] }, x: add(origin.x, r.x), y: add(origin.y, r.y) });
      }
    }
    if (!out.placed.has(br.id)) throw new Error(`${br.id} is on no line`);
  });
}

/** The fragments of kids and their descendants in tree order; a leaf with no fragment is skipped. */
function placeFragments(kids: readonly InlineChild[], fragments: Fragments, out: Placed[]): void {
  for (const k of kids) {
    const p = fragments.placed.get(k.id);
    if (p !== undefined) out.push(p);
    if (k.kind === 'inline') placeFragments(k.children, fragments, out);
  }
}

// CSS2 §10.8 and css-text-3 §5: lays out the formatting context in the line boxes of placeLines. Every leaf, inline box and <br>
// becomes a fragment of the container, in tree order: a leaf covers its per-line pieces (<leaf>:line<j>) with their union, and a
// leaf with nothing visible on any line has none; an inline box covers its per-line fragments (<box>:line<j>) with Chrome's
// bounding rect of them; a <br> is a zero-width fragment. With no line box at all, each inline box is an empty fragment at the
// content box's start edge (INL-P f1-empty-root).
export function layoutInline(ctx: Ctx, box: LayoutBox, available: LU, origin: Point): InlineResult {
  const ifc = buildIfc(ctx, box);
  const lines = placeIfcLines(ctx, box, ifc, available);
  const fragments: Fragments = { placed: new Map() };
  collectFragments(ifc, lines, origin, directionOf(ctx, box) === 'rtl' ? available : ZERO, fragments);
  const placed: Placed[] = [];
  placeFragments(inlineChildren(box), fragments, placed);
  const last = lines[lines.length - 1];
  const first = lines[0];
  return { height: last === undefined ? ZERO : add(last.top, last.height), placed, firstBaseline: first === undefined ? null : first.baseline, lines: lines.length };
}

// css-sizing-3 §5.1 with css-text-3 §5: max-content breaks only at <br>s, so it is the widest forced line; min-content takes every
// boundary, so it is the widest segment. Each is measured without its hanging spaces, min-content by cached positions (R4).
export function inlineIntrinsicSize(ctx: Ctx, box: LayoutBox, kind: 'min' | 'max'): LU {
  const ifc = buildIfc(ctx, box);
  if (ifc.shaped) return shapedIntrinsicSize(ctx, box, ifc, kind);
  let widest = ZERO;
  let start = 0;
  for (const b of endsOf(ifc)) {
    if (kind === 'max' && !b.forced) continue;
    const visible = visibleEndOf(ifc, start, b.at);
    widest = max(widest, kind === 'max' ? width(ctx, ifc, start, visible) : cachedWidth(ctx, ifc, start, visible));
    start = b.at;
  }
  return widest;
}

/** LayoutUnit::NearlyMax: the max-content available width (LineBreakerMode::kMaxContent). */
const NEARLY_MAX_RAW = 2147483646;

/**
 * Real-font intrinsic sizes. max-content is LineBreaker's widest line at an unlimited width, so lines end only at <br>s; min-content
 * is the widest segment between soft wrap opportunities by cached positions (HandleTextForFastMinContent), with the generated
 * hyphen of a segment that ends at a soft hyphen.
 */
function shapedIntrinsicSize(ctx: Ctx, box: LayoutBox, ifc: Ifc, kind: 'min' | 'max'): LU {
  let widest = ZERO;
  if (kind === 'max') {
    const lines = breakShapedLines(ctx, box, ifc, fromRaw(NEARLY_MAX_RAW));
    for (const line of lines) widest = max(widest, spanWidth(ctx, ifc, line, line.start, line.visibleEnd));
    return widest;
  }
  let start = 0;
  for (const b of endsOf(ifc)) {
    const visible = visibleEndOf(ifc, start, b.at);
    let w = cachedWidth(ctx, ifc, start, visible);
    const lastChar = visible > start ? (ifc.items[visible - 1] as Item) : null;
    if (lastChar !== null && lastChar.kind === 'char' && lastChar.cp === 0xad && !b.forced && !ctx.faults.softHyphenWidthMissing) {
      const t = ifc.leaves[lastChar.leaf] as TextLeaf;
      const h = ctx.measurer.measure('\u2010', fontOf(t.font));
      const hyphen = h.ok ? h : ctx.measurer.measure('-', fontOf(t.font));
      if (!hyphen.ok) unsupported('text-glyph', t.id, 'css-text-3 §6.1', hyphen.reason);
      w = add(w, hyphen.measure.width);
    }
    widest = max(widest, w);
    start = b.at;
  }
  return widest;
}
