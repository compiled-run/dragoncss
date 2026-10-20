// A box that clips its overflow, or clips a background colour to its text (#456), hosts its children in a native clip view over its
// padding box (lower/paint/clip.ts). A text view that clip view leaves no pixel of leaves the native accessibility tree (Android's
// View.isVisibleToUser is false when ViewGroup.getChildVisibleRect is empty, so TalkBack skips it), while Chrome keeps clipped text
// in its accessibility tree. The compiler has no layout (the engine runs on the device, at the device's size), so the native targets
// refuse, from computed values, only text the clip view hides whole for certain:
// - its padding box has no area: a zero width, height, max-width or max-height, or a zero flex-basis along a flex parent's main axis
//   without flex-grow, with no positive min size or end padding; or a zero-size ancestor it takes its size from (an auto width of
//   an in-flow block, a percentage size against a definite zero, an auto size a flex parent shrinks or stretches);
// - the text's line box is empty (a zero line-height or font size) with no bottom padding, or a scale(0) leaves its box no area;
// - the text starts at or past the padding box's end, for every width the clip box can take: a lower bound of its start, summed from
//   px (and, against a known width, percentage) margins, borders, paddings, offsets, insets, translations and the first line's
//   text-indent on the way down, and from the flex items, grid tracks, blocks and nowrap inline-blocks before it, is at least an
//   upper bound of the clip box's size plus its end padding. That bound is a px size within px min and max sizes, a percentage of
//   a bounded containing block, or, for an auto width that content cannot widen, its containing block's; an auto height, and any
//   size content can grow, has none;
// - or it ends before the padding box's start: the same sum, exact when nothing precedes the text and its line is start-aligned,
//   plus an upper bound of its extent (its characters times the font size in Ahem, else times 4em; its lines times a known line
//   height), is at most minus the start padding.
// On an axis a scroll container scrolls, what lies past the end is scrolled to, so only the start side is judged there. Whether
// text fits under an auto or flex size is left to layout, which the compiler does not have: a fitting card must never be refused.
import type { Longhand } from '../../css/properties.ts';
import { TRANSFORM_LIST_TYPE, transformFunctionsOf } from '../../css/properties/transform.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import { valueToString } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { textClipFillOf } from './gradient.ts';

type Value = ResolvedValue['value'];
type Axis = 'width' | 'height';
type Child = ResolvedElement['children'][number];

/** Wider and taller than any device screen in points or dp (the largest tablets are under 3000), so no box sized from the screen reaches it. */
export const SCREEN_BOUND = 4096;

const valueOf = (el: ResolvedElement, p: string): Value | undefined => el.props.get(p as Longhand)?.value;
const keywordOf = (el: ResolvedElement, p: string): string => {
  const v = valueOf(el, p);
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};
const text = (v: Value | undefined): string => (v === undefined ? '' : valueToString(v));
const pxOf = (v: Value | undefined): number | null => (v !== undefined && v.kind === 'length' && v.unit === 'px' ? v.value : null);
const px0 = (e: ResolvedElement, p: string): number => Math.max(0, pxOf(valueOf(e, p)) ?? 0);
const isZero = (v: Value | undefined): boolean => v !== undefined && (v.kind === 'length' || v.kind === 'percentage') && v.value === 0;
const isAuto = (v: Value | undefined): boolean => v === undefined || (v.kind === 'keyword' && (v.value === 'auto' || v.value === 'none'));
const hasPercent = (v: Value | undefined): boolean => v !== undefined && (v.kind === 'percentage' || (v.kind === 'other' && v.text.includes('%')));
const FLEX = ['flex', 'inline-flex'];
const GRID = ['grid', 'inline-grid'];
const ATOMIC = ['inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'table', 'table-cell'];
const START_JUSTIFY = ['normal', 'flex-start', 'start', 'stretch'];

const outOfFlow = (e: ResolvedElement): boolean => ['absolute', 'fixed'].includes(keywordOf(e, 'position'));
/** Collapsible white space alone (between inline-blocks, say), which lays out as nothing. */
const isSpace = (c: Child): boolean => {
  if (c.kind !== 'text' || !/^[ \t\n\r\f]*$/.test(c.text)) return false;
  const v = c.props.get('white-space-collapse')?.value;
  return v === undefined || (v.kind === 'keyword' && v.value === 'collapse');
};
const inFlow = (c: Child): boolean => (c.kind === 'text' ? !isSpace(c) : !['none', 'contents'].includes(keywordOf(c, 'display')) && !outOfFlow(c));
const isInlineLevel = (e: ResolvedElement): boolean => keywordOf(e, 'display').startsWith('inline');
/** The physical sides of an axis, start first, in a direction. */
const sidesOf = (ax: Axis, rtl: boolean): readonly [string, string] => (ax === 'height' ? ['top', 'bottom'] : rtl ? ['right', 'left'] : ['left', 'right']);

/**
 * The longhand that makes lower/paint/clip.ts host a clip view over the padding box of el, and how a message names it, or null.
 * propagated is the element whose overflow the viewport takes, which clips nothing itself. A new cause of a padding-box clip view
 * adds its line here, so the refusal below covers it.
 */
export function clipViewCause(el: ResolvedElement, propagated: ResolvedElement | null): { readonly property: Longhand; readonly cause: string } | null {
  const [x, y] = [keywordOf(el, 'overflow-x'), keywordOf(el, 'overflow-y')];
  // Overflow applies to block containers, flex and grid containers and replaced boxes, not to an inline box or display: contents.
  const boxed = !['inline', 'contents', 'none'].includes(keywordOf(el, 'display'));
  if (boxed && el !== propagated && (x !== 'visible' || y !== 'visible')) return { property: el.props.get('overflow-x')?.declaration ? 'overflow-x' : 'overflow-y', cause: `overflow: ${x === y ? x : `${x} ${y}`}` };
  if (textClipFillOf(el) !== null) return { property: 'background-clip', cause: 'background-clip: text' };
  return null;
}

/** Whether a box keeps a padding box with area in an axis whatever its size resolves to: a positive min size, or end padding. */
function keepsArea(e: ResolvedElement, ax: Axis): boolean {
  if ((pxOf(valueOf(e, `min-${ax}`)) ?? 0) > 0) return true;
  const positive = (p: string): boolean => { const v = valueOf(e, p); return (v?.kind === 'length' || v?.kind === 'percentage') && v.value > 0; };
  // Text starts at the start edge of the content box, so the padding after it (either side, for either direction) shows it; a
  // percentage padding (the padding-bottom aspect-ratio idiom) resolves against a width another rule keeps from zero.
  if (ax === 'width') return positive('padding-left') && positive('padding-right');
  return positive('padding-bottom');
}

/** e's own size in ax that is zero (such as "height 0px"), or null. A calculation is taken as non-zero here; under a zero ancestor, one with a percentage is not (inheritsZero). */
function ownZero(e: ResolvedElement, parent: ResolvedElement, ax: Axis): string | null {
  if (keepsArea(e, ax)) return null;
  for (const p of [ax, `max-${ax}`]) if (isZero(valueOf(e, p))) return `${p} ${text(valueOf(e, p))}`;
  if (FLEX.includes(keywordOf(parent, 'display')) && isZero(valueOf(e, 'flex-basis'))) {
    const grow = valueOf(e, 'flex-grow');
    const main: Axis = keywordOf(parent, 'flex-direction').startsWith('column') ? 'height' : 'width';
    if (main === ax && !(grow?.kind === 'number' && grow.value > 0)) return `flex-basis ${text(valueOf(e, 'flex-basis'))} without flex-grow in the flex container ${parent.element.address}`;
  }
  return null;
}

/** Whether a flex item is stretched along the cross axis: align-self auto under align-items normal or stretch, or itself stretch. */
function stretched(e: ResolvedElement, parent: ResolvedElement): boolean {
  const self = keywordOf(e, 'align-self');
  return ['normal', 'stretch'].includes(self === 'auto' || self === '' ? keywordOf(parent, 'align-items') : self);
}

/**
 * Whether e takes its size in ax from its parent, so that a zero-size parent leaves it zero-size too. definite: the parent's zero is
 * a definite size (not only a max or a flex-basis), against which a percentage height resolves.
 */
function inheritsZero(e: ResolvedElement, parent: ResolvedElement, ax: Axis, definite: boolean): boolean {
  if (keepsArea(e, ax) || outOfFlow(e)) return false;
  if (hasPercent(valueOf(e, ax)) || hasPercent(valueOf(e, `max-${ax}`))) return ax === 'width' || definite;
  if (!isAuto(valueOf(e, ax))) return false;
  const pd = keywordOf(parent, 'display');
  if (FLEX.includes(pd)) {
    const main: Axis = keywordOf(parent, 'flex-direction').startsWith('column') ? 'height' : 'width';
    // Along the main axis a shrinking item (a clip box's automatic minimum size is 0) shrinks to the container; across it, a stretched one.
    if (main === ax) { const shrink = valueOf(e, 'flex-shrink'); return !(shrink?.kind === 'number' && shrink.value === 0); }
    return stretched(e, parent) && definite;
  }
  // An auto height is its content's; a float, an atomic inline or a grid item (auto tracks size to content) shrinks to fit its content.
  if (ax === 'height' || GRID.includes(pd) || keywordOf(e, 'float') !== 'none' || ATOMIC.includes(keywordOf(e, 'display'))) return false;
  return true;
}

/** Whether a line box of text in e is empty: a zero line-height or a zero font size (a size with no build-time value is not zero). */
function emptyLine(e: ResolvedElement): boolean {
  const lh = valueOf(e, 'line-height');
  return isZero(valueOf(e, 'font-size')) || isZero(lh) || (lh?.kind === 'number' && lh.value === 0);
}

/** Every box's parent, recorded from the root when the walk reaches it, for containing-block bounds. */
const PARENT = new WeakMap<ResolvedElement, ResolvedElement>();
const INDEXED = new WeakSet<ResolvedElement>();
const INF = Number.POSITIVE_INFINITY;

/** The px widths of e's border and padding along ax, which a border-box size includes (a percentage or keyword padding counts 0). */
function edgesOf(e: ResolvedElement, ax: Axis): number {
  const [a, b] = sidesOf(ax, false);
  const border = (s: string): number => (['none', 'hidden'].includes(keywordOf(e, `border-${s}-style`)) ? 0 : px0(e, `border-${s}-width`));
  return px0(e, `padding-${a}`) + px0(e, `padding-${b}`) + border(a) + border(b);
}

/** A length or percentage against a basis (null: unknown), as px, or null when it cannot be decided. */
const resolve = (v: Value | undefined, basis: number | null): number | null => {
  if (pxOf(v) !== null) return pxOf(v);
  if (v?.kind === 'percentage' && basis !== null && Number.isFinite(basis)) return (v.value / 100) * basis;
  return null;
};

/** An upper bound of a length against a basis: resolve's, or for a viewport unit, its share of SCREEN_BOUND. */
const VIEWPORT = /^[sld]?v(w|h|i|b|min|max)$/;
const upperOf = (v: Value | undefined, basis: number | null): number | null => {
  const r = resolve(v, basis);
  if (r !== null) return r;
  return v?.kind === 'length' && VIEWPORT.test(v.unit) && v.value >= 0 ? (v.value / 100) * SCREEN_BOUND : null;
};

/** An upper bound of e's content width (INF when content can widen it or nothing bounds it). */
function widthBound(e: ResolvedElement): number {
  const parent = PARENT.get(e);
  const cb = parent === undefined ? (e.element.tag === 'html' ? SCREEN_BOUND : INF) : widthBound(parent);
  const inner = keywordOf(e, 'box-sizing') === 'border-box' ? edgesOf(e, 'width') : 0;
  const size = valueOf(e, 'width');
  let upper = isAuto(size) ? autoWidthBound(e, parent, cb) : (upperOf(size, cb) ?? INF) - inner;
  const max = upperOf(valueOf(e, 'max-width'), cb);
  if (max !== null) upper = Math.min(upper, max - inner);
  // A flex item that grows, or whose flex-basis sets its width, is not held to it.
  if (parent !== undefined && FLEX.includes(keywordOf(parent, 'display')) && !keywordOf(parent, 'flex-direction').startsWith('column')) {
    const grow = valueOf(e, 'flex-grow');
    if ((grow?.kind === 'number' && grow.value > 0) || !isAuto(valueOf(e, 'flex-basis'))) upper = max === null ? INF : max - inner;
  }
  return Math.max(upper, (pxOf(valueOf(e, 'min-width')) ?? 0) - inner);
}

/** An upper bound of an auto width: its containing block's less its margins, borders and paddings, for a box content cannot widen. */
function autoWidthBound(e: ResolvedElement, parent: ResolvedElement | undefined, cb: number): number {
  if (parent === undefined) return e.element.tag === 'html' ? SCREEN_BOUND : INF;
  const pd = keywordOf(parent, 'display');
  // Shrink-to-fit boxes (out of flow, floats, atomic inlines, flex rows, grid items) can be as wide as their min-content.
  if (outOfFlow(e) || keywordOf(e, 'float') !== 'none' || isInlineLevel(e) || GRID.includes(pd) || isInlineLevel(parent)) return INF;
  if (FLEX.includes(pd) && !(keywordOf(parent, 'flex-direction').startsWith('column') && stretched(e, parent))) return INF;
  let less = edgesOf(e, 'width');
  for (const s of ['left', 'right']) {
    const m = valueOf(e, `margin-${s}`);
    if (isAuto(m) || isZero(m)) continue;
    const px = resolve(m, cb);
    if (px === null) { if (!(m?.kind === 'percentage' && m.value > 0)) return INF; continue; }
    less += px;
  }
  return cb - less;
}

/** Whether e's content box is exactly as wide as its parent's content box. */
function fillsWidth(e: ResolvedElement, parent: ResolvedElement): boolean {
  const pd = keywordOf(parent, 'display');
  if (outOfFlow(e) || keywordOf(e, 'float') !== 'none' || isInlineLevel(e) || GRID.includes(pd) || isInlineLevel(parent)) return false;
  // A flex row sizes its items to their content; a flex column stretches an auto width.
  const flexRow = FLEX.includes(pd) && !keywordOf(parent, 'flex-direction').startsWith('column');
  const w = valueOf(e, 'width');
  const full = w?.kind === 'percentage' && w.value === 100;
  if (flexRow || (FLEX.includes(pd) && isAuto(w) && !stretched(e, parent))) return false;
  if (!(isAuto(w) || full) || !isAuto(valueOf(e, 'max-width')) || !(isAuto(valueOf(e, 'min-width')) || isZero(valueOf(e, 'min-width')))) return false;
  return ['left', 'right'].every((s) => (isZero(valueOf(e, `margin-${s}`)) || isAuto(valueOf(e, `margin-${s}`))) && isZero(valueOf(e, `padding-${s}`)) && (isZero(valueOf(e, `border-${s}-width`)) || ['none', 'hidden'].includes(keywordOf(e, `border-${s}-style`))));
}

/** e's definite content height (a px height, or a percentage of a definite one; the root's against the screen), or null. */
function definiteHeight(e: ResolvedElement): number | null {
  const parent = PARENT.get(e);
  const cb = parent === undefined ? (e.element.tag === 'html' ? SCREEN_BOUND : null) : definiteHeight(parent);
  const h = resolve(valueOf(e, 'height'), cb);
  return h === null ? null : h - (keywordOf(e, 'box-sizing') === 'border-box' ? edgesOf(e, 'height') : 0);
}

/** An upper bound of e's content height (INF for an auto height, which grows with its content). */
function heightBound(e: ResolvedElement): number {
  const parent = PARENT.get(e);
  if (parent !== undefined && FLEX.includes(keywordOf(parent, 'display')) && keywordOf(parent, 'flex-direction').startsWith('column')) {
    const grow = valueOf(e, 'flex-grow');
    if ((grow?.kind === 'number' && grow.value > 0) || !isAuto(valueOf(e, 'flex-basis'))) return INF;
  }
  const cb = parent === undefined ? SCREEN_BOUND : definiteHeight(parent);
  const inner = keywordOf(e, 'box-sizing') === 'border-box' ? edgesOf(e, 'height') : 0;
  let upper = (upperOf(valueOf(e, 'height'), cb) ?? INF) - inner;
  const max = upperOf(valueOf(e, 'max-height'), cb);
  if (max !== null) upper = Math.min(upper, max - inner);
  return Math.max(upper, (pxOf(valueOf(e, 'min-height')) ?? 0) - inner);
}

/** A lower bound of e's content width: its px width within its min and max (an auto or shrinking one, its px min-width). */
function widthFloor(e: ResolvedElement): number {
  const parent = PARENT.get(e);
  const inner = keywordOf(e, 'box-sizing') === 'border-box' ? edgesOf(e, 'width') : 0;
  const min = (pxOf(valueOf(e, 'min-width')) ?? 0) - inner;
  const shrink = valueOf(e, 'flex-shrink');
  const flexRow = parent !== undefined && FLEX.includes(keywordOf(parent, 'display')) && !keywordOf(parent, 'flex-direction').startsWith('column');
  const w = pxOf(valueOf(e, 'width'));
  if (w === null || (flexRow && !(shrink?.kind === 'number' && shrink.value === 0))) return Math.max(0, min);
  const max = pxOf(valueOf(e, 'max-width'));
  return Math.max(0, min, (max === null ? w : Math.min(w, max)) - inner);
}

/** A length in the inline axis, a + b·W, where W is the clip box's content width; null when undecidable. */
type Lin = { readonly a: number; readonly b: number };
const lin = (a: number, b = 0): Lin => ({ a, b });
const plus = (x: Lin | null, d: Lin | null): Lin | null => (x === null || d === null ? null : { a: x.a + d.a, b: x.b + d.b });
/** What a percentage resolves against: the clip box's content width, a known px width, or nothing known. */
type Basis = 'clip' | number | null;

/** A signed length (a margin, an offset, a gap, a track) against a basis, with whether it is exact; null when undecidable. */
function signed(v: Value | undefined, basis: Basis): { readonly v: Lin; readonly exact: boolean } | null {
  if (v === undefined || isAuto(v) || isZero(v) || (v.kind === 'keyword' && v.value === 'normal')) return { v: lin(0), exact: !(v !== undefined && isAuto(v) && v.kind === 'keyword' && v.value === 'auto') };
  if (pxOf(v) !== null) return { v: lin(pxOf(v) as number), exact: true };
  if (v.kind === 'percentage') {
    if (basis === 'clip') return { v: lin(0, v.value / 100), exact: true };
    if (basis !== null) return { v: lin((v.value / 100) * basis), exact: true };
    // An unknown basis: a positive percentage adds something, a negative one an unknown amount the wrong way.
    return v.value > 0 ? { v: lin(0), exact: false } : null;
  }
  return null;
}

/** A lower bound of a box's outer size along ax in a line (flex or inline): its size (px or percentage) or min size, edges and margins. */
function outerFloor(e: ResolvedElement, ax: Axis, sized: boolean, basis: Basis, size: Value | undefined = valueOf(e, ax), heightBasis: number | null = null): Lin | null {
  const along: Basis = ax === 'width' ? basis : heightBasis;
  const [a, b] = sidesOf(ax, false);
  const edges = edgesOf(e, ax);
  const borderBox = keywordOf(e, 'box-sizing') === 'border-box';
  const min = signed(valueOf(e, `min-${ax}`), along);
  // A max size could cut the size below what it reads, so only the min size counts under one.
  const own = sized && isAuto(valueOf(e, `max-${ax}`)) ? signed(size, along) : null;
  const pick = own !== null && (min === null || min.v.b === 0 && own.v.b === 0 ? true : own.v.b >= min.v.b) ? own.v : (min?.v ?? lin(0));
  const picked = own !== null && min !== null && own.v.b === 0 && min.v.b === 0 ? lin(Math.max(own.v.a, min.v.a)) : pick;
  // An auto height is at least what its blocks stack to.
  const content = ax === 'height' && sized && isAuto(valueOf(e, 'max-height')) && isAuto(size) && picked.b === 0 ? lin(Math.max(picked.a, stackFloor(e))) : picked;
  let out: Lin | null = borderBox ? content : plus(content, lin(edges));
  for (const s of [a, b]) out = plus(out, signed(valueOf(e, `margin-${s}`), ax === 'width' ? basis : null)?.v ?? null);
  return out;
}

/** A floor of the height e's in-flow block children stack to in block flow (0 for a flex or grid container, or an inline box). */
const STACKED = new WeakMap<ResolvedElement, number>();
function stackFloor(e: ResolvedElement): number {
  const known = STACKED.get(e);
  if (known !== undefined) return known;
  const n = stackOf(e);
  STACKED.set(e, n);
  return n;
}
function stackOf(e: ResolvedElement): number {
  const d = keywordOf(e, 'display');
  if (FLEX.includes(d) || GRID.includes(d) || (isInlineLevel(e) && !ATOMIC.includes(d))) return 0;
  let n = 0;
  for (const k of e.children) {
    if (k.kind !== 'element' || !inFlow(k) || isInlineLevel(k) || keywordOf(k, 'float') !== 'none') continue;
    const box = outerFloor(k, 'height', true, null);
    const [mt, mb] = [signed(valueOf(k, 'margin-top'), null), signed(valueOf(k, 'margin-bottom'), null)];
    // A margin with no build-time value could be negative and pull up what follows; margins between blocks collapse, so only
    // their negative parts are sure to count.
    if (box === null || mt === null || mb === null) return 0;
    n += box.a - mt.v.a - mb.v.a + Math.min(0, mt.v.a) + Math.min(0, mb.v.a);
  }
  return Math.max(0, n);
}

/** The sum of the first n tracks of a list repeated as needed. */
function sumTracks(tracks: readonly Lin[], n: number): Lin | null {
  let out: Lin | null = lin(0);
  for (let i = 0; i < n; i += 1) out = plus(out, tracks[i % tracks.length] as Lin);
  return out;
}

/** The widths of a grid's columns in order (px or percentage lengths, and repeat() of them), or null for any other track list. */
function tracksOf(v: Value | undefined, basis: Basis): Lin[] | null {
  if (v === undefined) return null;
  const src = valueToString(v).replace(/repeat\(\s*(\d+)\s*,([^()]*)\)/g, (_, n: string, list: string) => Array.from({ length: Number(n) }, () => list.trim()).join(' '));
  const out: Lin[] = [];
  for (const t of src.trim().split(/\s+/)) {
    const m = /^(\d+(?:\.\d+)?)(px|%)$/.exec(t);
    if (m === null) return null;
    const n = Number(m[1]);
    const w = m[2] === 'px' ? lin(n) : basis === 'clip' ? lin(0, n / 100) : basis === null ? null : lin((n / 100) * basis);
    if (w === null) return null;
    out.push(w);
  }
  return out.length === 0 ? null : out;
}

/** An upper bound of a text's advance in px: its collapsed characters times (the font size, 4 for a face other than Ahem, plus letter-spacing), plus word-spacing. */
function advanceBound(e: ResolvedElement, value: string): number {
  const size = pxOf(valueOf(e, 'font-size'));
  const spacing = (p: string): number | null => { const v = valueOf(e, p); return v === undefined || isZero(v) || (v.kind === 'keyword' && v.value === 'normal') ? 0 : pxOf(v); };
  const [letter, word] = [spacing('letter-spacing'), spacing('word-spacing')];
  if (size === null || letter === null || word === null) return INF;
  const run = value.replace(/\s+/g, ' ').trim();
  // Ahem draws every glyph 1em wide; no glyph of another face is taken to advance more than 4em.
  const em = text(valueOf(e, 'font-family')) === 'Ahem' ? 1 : 4;
  return run.length * (size * em + Math.max(0, letter)) + (run.split(' ').length - 1) * Math.max(0, word);
}

/** An upper bound of a text's ink bottom when it is its block's only content: its lines (one if it does not wrap) times its line
 * height, or its font size where that is larger (a line box shorter than its glyphs centers them, so they overhang it). */
function heightOfText(e: ResolvedElement, value: string, sole: boolean): number {
  const size = pxOf(valueOf(e, 'font-size'));
  const lh = valueOf(e, 'line-height');
  if (!sole || size === null || lh === undefined) return INF;
  const line = lh.kind === 'number' ? lh.value * size : pxOf(lh) ?? (lh.kind === 'keyword' && lh.value === 'normal' && text(valueOf(e, 'font-family')) === 'Ahem' ? size : INF);
  const lines = keywordOf(e, 'text-wrap-mode') === 'nowrap' ? 1 : Math.max(1, value.replace(/\s+/g, ' ').trim().length);
  return lines * Math.max(line, size);
}

/** Whether a block container's lines start at its start edge: text-align start, justify (its last line), or the physical start side. */
function startAligned(e: ResolvedElement, rtl: boolean): boolean {
  const a = keywordOf(e, 'text-align');
  return ['start', 'justify', ''].includes(a) || a === (rtl ? 'right' : 'left');
}

/** Where a text starts, relative to the clip box's content box start corner, in the inline (x) and block (y) axes. */
type Start = {
  /** Lower bounds, or null once something unknown (a rotation, a percentage offset, a fixed box) can have moved it anywhere. */
  readonly x: Lin | null;
  readonly y: number | null;
  /** Whether x and y are exact too: nothing of unknown size precedes the text and every term is decided. */
  readonly exactX: boolean;
  readonly exactY: boolean;
  /** The last margin-top counted in a run of margins that collapse together (a first child's with its parent's). */
  readonly margin: number;
  /** The first line's text-indent counted in x, which a later line does not have. */
  readonly indent: Lin;
};
const addY = (v: number | null, d: number | null): number | null => (v === null || d === null ? null : v + d);
const LOST: Start = { x: null, y: null, exactX: false, exactY: false, margin: 0, indent: lin(0) };

/** The first text in a clip box that a native clip view over its padding box hides whole for certain, and why; null otherwise. */
export function clipViewHidesText(el: ResolvedElement, parent: ResolvedElement): { readonly text: string; readonly why: string } | null {
  for (const ax of ['width', 'height'] as const) {
    const zero = ownZero(el, parent, ax);
    if (zero === null) continue;
    const t = firstText(el);
    if (t !== null) return { text: t, why: `its ${zero} leaves its padding box no area` };
  }
  const rtl = keywordOf(el, 'direction') === 'rtl';
  const scrolls = (p: string): boolean => ['auto', 'scroll'].includes(keywordOf(el, p));
  const [scrollsX, scrollsY] = [scrolls('overflow-x'), scrolls('overflow-y')];
  const [startX, endX] = sidesOf('width', rtl);
  // The clip box's content width W lies in [wLow, wHigh]; its end paddings resolve against its containing block.
  const [wLow, wHigh, hHigh] = [widthFloor(el), widthBound(el), heightBound(el)];
  const cbW = PARENT.has(el) ? widthBound(PARENT.get(el) as ResolvedElement) : INF;
  const padUpper = (p: string): number => { const v = valueOf(el, p); return v?.kind === 'percentage' ? Math.max(0, v.value / 100) * cbW : px0(el, p); };
  const [padEndX, padBottom] = [padUpper(`padding-${endX}`), padUpper('padding-bottom')];
  const [padStartX, padTop] = [px0(el, `padding-${startX}`), px0(el, 'padding-top')];
  const positioned = keywordOf(el, 'position') !== 'static';
  type Found = { readonly text: string; readonly why: string } | null;
  /** The basis of percentages on a box inside e (its containing block's content width). */
  const bases = new Map<ResolvedElement, Basis>();
  const basisIn = (e: ResolvedElement): Basis => {
    if (e === el) return 'clip';
    const known = bases.get(e);
    if (known !== undefined) return known;
    const [lo, hi] = [widthFloor(e), widthBound(e)];
    const parent = PARENT.get(e);
    // An in-flow block as wide as its containing block (an auto or 100% width, no horizontal margin, border or padding, no
    // min or max width) under the clip box carries the clip box's width: the track of a carousel.
    const b: Basis = lo === hi ? lo : parent !== undefined && fillsWidth(e, parent) && basisIn(parent) === 'clip' ? 'clip' : null;
    bases.set(e, b);
    return b;
  };
  /** Whether x ≥ W + end padding for every W the clip box can take. */
  const pastEnd = (x: Lin): boolean => {
    const f = (w: number): number => x.a + (x.b - 1) * w - padEndX;
    return x.b >= 1 ? f(wLow) >= 0 : Number.isFinite(wHigh) && f(wHigh) >= 0;
  };
  const show = (x: Lin): string => (x.b === 0 ? `${x.a}px` : `${x.a === 0 ? '' : `${x.a}px + `}${x.b * 100}% of its width`);

  /** A path box's own move: margins, border, padding, its position offsets and its transform; basis resolves its percentages. */
  const own = (e: ResolvedElement, st: Start, collapses: boolean, cbIsClip: boolean, basis: Basis): Start | string => {
    let { x, y, exactX, exactY, margin } = st;
    const position = keywordOf(e, 'position');
    if (position === 'fixed' || position === 'sticky') return LOST;
    if (position === 'absolute') {
      if (!cbIsClip) return LOST;
      // Against the clip box's padding box: an inset in px places it there; an auto inset keeps its static position.
      const sx = valueOf(e, startX);
      const sy = valueOf(e, 'top');
      if (!isAuto(sx)) [x, exactX] = pxOf(sx) === null ? [null, false] : [lin((pxOf(sx) as number) - padStartX), true];
      else if (!isAuto(valueOf(e, endX))) [x, exactX] = [null, false];
      if (!isAuto(sy)) [y, exactY] = pxOf(sy) === null ? [null, false] : [(pxOf(sy) as number) - padTop, true];
      else if (!isAuto(valueOf(e, 'bottom'))) [y, exactY] = [null, false];
    }
    if (position === 'relative') {
      const offset = (a: string, b: string, bs: Basis): Lin | null => {
        const [va, vb] = [valueOf(e, a), valueOf(e, b)];
        if (!isAuto(va)) return signed(va, bs)?.v ?? null;
        if (!isAuto(vb)) { const o = signed(vb, bs); return o === null ? null : lin(-o.v.a, -o.v.b); }
        return lin(0);
      };
      x = plus(x, offset(startX, endX, basis));
      const dy = offset('top', 'bottom', null);
      y = addY(y, dy === null || dy.b !== 0 ? null : dy.a);
    }
    const tf = valueOf(e, 'transform');
    if (tf !== undefined && tf.kind === 'other' && tf.type === TRANSFORM_LIST_TYPE) {
      for (const f of transformFunctionsOf(tf.text)) {
        if (f.kind === 'scale' && (f.sx === 0 || f.sy === 0)) return `${e.element.address} has transform ${text(tf)}, which leaves it no area`;
        if (f.kind === 'translate') {
          x = plus(x, f.x.unit === 'px' ? lin(rtl ? -f.x.value : f.x.value) : null);
          y = addY(y, f.y.unit === 'px' ? f.y.value : null);
        } else if (!(f.kind === 'rotate' && f.deg % 360 === 0) && !(f.kind === 'scale' && f.sx === 1 && f.sy === 1)) return LOST;
      }
    } else if (tf !== undefined && !(tf.kind === 'keyword' && tf.value === 'none')) return LOST;
    const border = (s: string): number => {
      if (['none', 'hidden'].includes(keywordOf(e, `border-${s}-style`))) return 0;
      const v = valueOf(e, `border-${s}-width`);
      return { thin: 1, medium: 3, thick: 5 }[v?.kind === 'keyword' ? v.value : ''] ?? px0(e, `border-${s}-width`);
    };
    const ms = signed(valueOf(e, `margin-${startX}`), basis);
    const ps = signed(valueOf(e, `padding-${startX}`), basis);
    x = plus(plus(plus(x, ms?.v ?? null), lin(border(startX))), ps === null ? lin(0) : ps.v);
    exactX = exactX && ms !== null && ms.exact && (ps?.exact ?? false);
    // An inline box's block-axis margins, border and padding move no line; a margin-top that collapses with its parent's adds only
    // what it exceeds the run by.
    if (!(isInlineLevel(e) && !ATOMIC.includes(keywordOf(e, 'display')))) {
      const mtv = signed(valueOf(e, 'margin-top'), basis === 'clip' ? (wLow === wHigh ? wLow : null) : basis);
      const mt = mtv === null || mtv.v.b !== 0 ? null : mtv.v.a;
      exactY = exactY && mtv !== null && mtv.exact && !(collapses && (mt ?? 0) < 0);
      y = addY(y, mt === null ? null : collapses ? Math.max(0, mt - margin) : mt);
      margin = collapses ? Math.max(margin, mt ?? 0) : (mt ?? 0);
      const pt = px0(e, 'padding-top') + border('top');
      exactY = exactY && (pxOf(valueOf(e, 'padding-top')) !== null || isZero(valueOf(e, 'padding-top')));
      y = addY(y, pt);
      if (pt > 0) margin = 0;
    }
    return { x, y, exactX, exactY, margin, indent: st.indent };
  };

  /** What the in-flow content before each child of a box adds to where that child starts, in one pass per box (a prefix sum). */
  type Prior = { readonly any: boolean; readonly mode: 'flex-x' | 'flex-y' | 'grid' | 'none'; readonly x: Lin | null; readonly y: number | null; readonly line: Lin | null; readonly blocks: number | null };
  const priors = new Map<ResolvedElement, Prior[]>();
  const priorOf = (e: ResolvedElement): Prior[] => {
    const known = priors.get(e);
    if (known !== undefined) return known;
    const d = keywordOf(e, 'display');
    const dir = keywordOf(e, 'flex-direction');
    const basis = basisIn(e);
    const ordered = e.children.every((k) => k.kind === 'text' || text(valueOf(k, 'order')) === '0');
    const out: Prior[] = [];
    let n = 0;
    // Flex: the items' main sizes and gaps; grid: the tracks before the column; block flow: the stacked blocks and the nowrap
    // inline-blocks since the last line break.
    let flexKind: Axis | null = null;
    let gap: Lin | null = lin(0);
    let flexHBasis: number | null = null;
    if (FLEX.includes(d) && keywordOf(e, 'flex-wrap') === 'nowrap' && START_JUSTIFY.includes(keywordOf(e, 'justify-content')) && ordered && (dir === 'row' || dir === 'column')) {
      flexKind = dir === 'row' ? 'width' : 'height';
      // A column's percentages resolve against its definite height.
      flexHBasis = flexKind === 'height' ? (e === el ? definiteHeight(el) : definiteHeight(e)) : null;
      const g = flexKind === 'width' ? signed(valueOf(e, 'column-gap'), basis) : signed(valueOf(e, 'row-gap'), flexHBasis);
      gap = g === null || (flexKind === 'height' && g.v.b !== 0) ? null : g.v;
    }
    let tracks: Lin[] | null = null;
    let rowFlow = false;
    if (GRID.includes(d)) {
      const flow = keywordOf(e, 'grid-auto-flow');
      const auto = e.children.every((k) => k.kind === 'text' || ['grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end'].every((p) => keywordOf(k, p) === 'auto'));
      if (auto && ordered && START_JUSTIFY.includes(keywordOf(e, 'justify-content'))) {
        const g = signed(valueOf(e, 'column-gap'), basis);
        gap = g === null ? null : g.v;
        const columnFlow = flow === 'column' && isAuto(valueOf(e, 'grid-template-rows')) && isAuto(valueOf(e, 'grid-template-columns'));
        rowFlow = flow === 'row';
        tracks = rowFlow ? tracksOf(valueOf(e, 'grid-template-columns'), basis) : columnFlow ? tracksOf(valueOf(e, 'grid-auto-columns'), basis) : null;
      }
    }
    const nowrap = keywordOf(e, 'text-wrap-mode') === 'nowrap';
    let main: Lin | null = lin(0);
    let columns: Lin | null = lin(0);
    let line: Lin | null = lin(0);
    let blocks: number | null = 0;
    for (const k of e.children) {
      // Grid row flow fills the explicit columns in turn; column flow with no explicit tracks puts each item in a new column.
      const col = tracks === null ? 0 : rowFlow ? n % tracks.length : n;
      const gx = tracks === null ? null : rowFlow ? plus(sumTracks(tracks, col), gap === null ? null : lin(gap.a * col, gap.b * col)) : plus(columns, gap === null ? null : lin(gap.a * col, gap.b * col));
      const flexTotal = plus(main, gap === null ? null : lin(gap.a * n, gap.b * n));
      out.push({
        any: n > 0,
        mode: flexKind === 'width' ? 'flex-x' : flexKind === 'height' ? 'flex-y' : tracks !== null ? 'grid' : 'none',
        x: flexKind === 'width' ? flexTotal : gx,
        y: flexKind === 'height' ? (flexTotal === null || flexTotal.b !== 0 ? null : flexTotal.a) : null,
        line,
        blocks,
      });
      if (!inFlow(k)) continue;
      if (tracks !== null && !rowFlow) columns = plus(columns, tracks[n % tracks.length] as Lin);
      n += 1;
      if (k.kind !== 'element') continue;
      if (flexKind !== null) {
        const fb = valueOf(k, 'flex-basis');
        const fixed = !isAuto(fb) && !(fb?.kind === 'keyword');
        const shrink = valueOf(k, 'flex-shrink');
        const sized = shrink?.kind === 'number' && shrink.value === 0;
        main = plus(main, outerFloor(k, flexKind, sized, basis, fixed ? fb : valueOf(k, flexKind), flexHBasis));
      }
      if (k.element.tag === 'br' || !isInlineLevel(k)) line = lin(0);
      else if (nowrap) line = plus(line, ATOMIC.includes(keywordOf(k, 'display')) ? outerFloor(k, 'width', true, basis) : lin(0));
      if (isInlineLevel(k) || keywordOf(k, 'float') !== 'none') continue;
      const box = outerFloor(k, 'height', true, null, valueOf(k, 'height'));
      const [mt, mb] = [signed(valueOf(k, 'margin-top'), null), signed(valueOf(k, 'margin-bottom'), null)];
      // Margins between blocks collapse, so only their negative parts are sure to count.
      blocks = box === null || mt === null || mb === null ? null : addY(blocks, box.a - mt.v.a - mb.v.a + Math.min(0, mt.v.a) + Math.min(0, mb.v.a));
    }
    priors.set(e, out);
    return out;
  };

  /** What the content of e before its child c (its index i) adds to where c starts. */
  const before = (e: ResolvedElement, c: Child, i: number, st: Start): Start => {
    const pr = priorOf(e)[i] as Prior;
    if (!pr.any) return st;
    let { x, y, indent } = st;
    const d = keywordOf(e, 'display');
    if (FLEX.includes(d) || GRID.includes(d)) {
      if (pr.mode === 'flex-x' || (pr.mode === 'grid' && c.kind === 'element')) x = plus(x, pr.x);
      else if (pr.mode === 'flex-y') y = addY(y, pr.y);
      return { x, y, exactX: false, exactY: false, margin: 0, indent };
    }
    // Block flow: block-level boxes before c stack above it; inline-blocks before it on a line that does not wrap sit beside it.
    if (c.kind === 'text' || isInlineLevel(c)) {
      if (keywordOf(e, 'text-wrap-mode') === 'nowrap') x = plus(x, pr.line);
      // A later line starts at the line start, without the first line's positive indent.
      else if (x !== null) {
        x = { a: x.a - Math.max(0, indent.a), b: x.b - Math.max(0, indent.b) };
        indent = lin(Math.min(0, indent.a), Math.min(0, indent.b));
      }
    }
    y = addY(y, pr.blocks);
    return { x, y, exactX: false, exactY: false, margin: 0, indent };
  };

  const judge = (e: ResolvedElement, value: string, id: string, st: Start, inner: boolean, sole: boolean): Found => {
    const at = inner ? e.element.address : 'it';
    if (emptyLine(e) && !keepsArea(el, 'height')) return { text: id, why: `${at === 'it' ? 'its' : `${at}'s`} line box is empty (line-height ${text(valueOf(e, 'line-height'))}, font-size ${text(valueOf(e, 'font-size'))})` };
    const { x, y } = st;
    const indented = st.indent.a !== 0 || st.indent.b !== 0 ? ` (text-indent ${show(st.indent)} included)` : '';
    // A text that can break puts its later words on later lines, which start without the first line's positive indent.
    const breaks = (keywordOf(e, 'text-wrap-mode') !== 'nowrap' && /\s/.test(value.trim())) || (keywordOf(e, 'white-space-collapse') !== 'collapse' && value.includes('\n'));
    const xEnd = x === null || !breaks ? x : { a: x.a - Math.max(0, st.indent.a), b: x.b - Math.max(0, st.indent.b) };
    if (xEnd !== null && !scrollsX && pastEnd(xEnd)) return { text: id, why: `the text starts at least ${show(xEnd)} from its content box's start${indented}, at or past its padding box's end (${Number.isFinite(wHigh) ? `${wHigh + padEndX}px` : `${show(lin(padEndX, 1))}`})` };
    if (y !== null && !scrollsY && y >= hHigh + padBottom) return { text: id, why: `the text starts at least ${y}px below its content box's top, at or past its padding box's bottom (${hHigh + padBottom}px)` };
    const xs = x === null || !st.exactX ? null : x.b === 0 ? x.a : wLow === wHigh ? x.a + x.b * wLow : null;
    if (xs !== null && xs + advanceBound(e, value) <= -padStartX) return { text: id, why: `the text starts ${xs}px from its content box's start${indented} and ends before its padding box's start` };
    if (y !== null && st.exactY && y + heightOfText(e, value, sole) <= -padTop) return { text: id, why: `the text starts ${y}px above its content box's top and ends above its padding box's top` };
    return null;
  };

  const visit = (e: ResolvedElement, st0: Start, inner: boolean, cbIsClip: boolean, collapses: boolean, basis: Basis): Found => {
    if (keywordOf(e, 'display') === 'none') return null;
    let st = st0;
    if (inner) {
      const moved = own(e, st, collapses, cbIsClip, basis);
      if (typeof moved === 'string') { const t = firstText(e); return t === null ? null : { text: t, why: moved }; }
      st = moved;
    }
    const d = keywordOf(e, 'display');
    const inlineBox = isInlineLevel(e) && !ATOMIC.includes(d);
    const flow = !FLEX.includes(d) && !GRID.includes(d) && !inlineBox;
    // A block container's first line takes its text-indent (percentages against its own width), and its lines its text-align.
    const container = flow;
    const ind = container ? signed(valueOf(e, 'text-indent'), basisIn(e)) : { v: lin(0), exact: true };
    const aligned = !container || startAligned(e, rtl);
    const sealed = !inner || px0(e, 'padding-top') > 0 || (px0(e, 'border-top-width') > 0 && !['none', 'hidden'].includes(keywordOf(e, 'border-top-style')));
    const kids = e.children.filter(inFlow);
    const childBasis = basisIn(e);
    const nextCb = inner ? cbIsClip && keywordOf(e, 'position') === 'static' : positioned;
    for (const [i, c] of e.children.entries()) {
      if (c.kind === 'element' && keywordOf(c, 'display') === 'none') continue;
      if (isSpace(c)) continue;
      const lead = kids[0] === c;
      let here = before(e, c, i, st);
      // Inline content: on a block's first line, its text-indent; off start alignment, the line may move toward the end.
      if (container && (c.kind === 'text' || isInlineLevel(c))) {
        if (lead) here = ind === null ? { ...here, x: null } : { ...here, x: plus(here.x, ind.v), exactX: here.exactX && ind.exact, indent: ind.v };
        if (!aligned) here = { ...here, exactX: false };
      }
      const found = c.kind === 'text'
        ? judge(e, c.text, c.node.address, here, inner, kids.length === 1 && container)
        : visit(c, here, true, nextCb, flow && lead && !sealed, outOfFlow(c) ? null : childBasis);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(el, { x: lin(0), y: 0, exactX: true, exactY: true, margin: 0, indent: lin(0) }, false, positioned, false, 'clip');
}

/** The first text in preorder in the subtree of a box (outside display: none), or null. */
function firstText(el: ResolvedElement): string | null {
  if (keywordOf(el, 'display') === 'none') return null;
  for (const c of el.children) {
    const found = c.kind === 'text' ? c.node.address : firstText(c);
    if (found !== null) return found;
  }
  return null;
}

const A11Y_DROP: { readonly [t: string]: string } = {
  ios: 'VoiceOver is not proven to read a view its clipping ancestor shows no pixel of',
  android: 'View.isVisibleToUser is false when ViewGroup.getChildVisibleRect leaves it nothing, so TalkBack skips it',
};

function refuse(el: ResolvedElement, host: { readonly property: Longhand; readonly cause: string }, hidden: { readonly text: string; readonly why: string }, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const at = el.element.address;
  const declared = el.props.get(host.property)?.declaration ?? null;
  const origin = declared === null ? el.element.node.origin : authored(declared.valueSpan);
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|clip-view-text|${at}`;
    if (reported.has(id)) continue;
    reported.add(id);
    const message = `${at} has ${host.cause}, which ${t} draws as a clip view over its padding box, but ${hidden.why}; its text ${hidden.text} could be clipped out of sight, which Chrome keeps in its accessibility tree and screen readers read, while ${t} would drop it (${A11Y_DROP[t] ?? 'a fully clipped view leaves the native accessibility tree'})`;
    const manual = `Keep every text of ${at} inside its padding box, or clip a box without text.`;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
  }
}

/**
 * The native refusals of text a padding-box clip view could hide, judged at each child of parent (a clip box's parent decides its
 * flex-basis and stretch): the child's own clip view, and, when the child can be zero-size, every clip view that takes its size.
 */
export function checkClipViewText(parent: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, propagated: ResolvedElement | null): void {
  if (!targets.some((t) => t !== 'web')) return;
  // The walk reaches the root first: record every box's parent, for the containing-block bounds above.
  if (parent.element.tag === 'html' && !INDEXED.has(parent)) {
    INDEXED.add(parent);
    const index = (e: ResolvedElement): void => { for (const c of e.children) if (c.kind === 'element') { PARENT.set(c, e); index(c); } };
    index(parent);
  }
  for (const c of parent.children) {
    if (c.kind !== 'element' || keywordOf(c, 'display') === 'none') continue;
    const host = clipViewCause(c, propagated);
    const hidden = host === null ? null : clipViewHidesText(c, parent);
    if (host !== null && hidden !== null) refuse(c, host, hidden, targets, diagnostics, reported);
    for (const ax of ['width', 'height'] as const) {
      const zero = ownZero(c, parent, ax);
      if (zero === null) continue;
      const definite = !zero.startsWith('max-') && !zero.startsWith('flex-basis');
      const why = `its ancestor ${c.element.address} has ${zero}, which can leave it no area too`;
      const visit = (e: ResolvedElement): void => {
        for (const d of e.children) {
          if (d.kind !== 'element' || keywordOf(d, 'display') === 'none' || !inheritsZero(d, e, ax, definite)) continue;
          const h = clipViewCause(d, propagated);
          const t = h === null ? null : firstText(d);
          if (h !== null && t !== null) refuse(d, h, { text: t, why }, targets, diagnostics, reported);
          visit(d);
        }
      };
      visit(c);
    }
  }
}
