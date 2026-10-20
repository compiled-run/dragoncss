// A box that clips its overflow, or clips a background colour to its text (#456), hosts its children in a native clip view over its
// padding box (lower/paint/clip.ts). A text view that clip view leaves no pixel of leaves the native accessibility tree (Android's
// View.isVisibleToUser is false when ViewGroup.getChildVisibleRect is empty, so TalkBack skips it), while Chrome keeps clipped text
// in its accessibility tree. The compiler has no layout (the engine runs on the device, at the device's size), so the native targets
// refuse, from computed values, only text the clip view hides whole for certain:
// - its padding box has no area: a zero width, height, max-width or max-height, or flex-basis along a flex parent's main axis
//   without flex-grow, with no positive min size or end padding; or a zero-size ancestor it takes its size from (an auto width
//   of an in-flow block, a percentage size, or an auto size a flex or grid parent stretches or shrinks);
// - the text's line box is empty (line-height or font-size 0) with no bottom padding, or a scale(0) leaves its box no area;
// - the text starts at or past the padding box's end: a lower bound of its start, summed from px margins, borders, paddings, offsets,
//   translations and text-indents on the way down, the px sizes of non-shrinking flex items and of grid tracks before it, and of
//   inline-blocks before it on a line that does not wrap, is at least an upper bound of the clip box's size (its px size, or
//   SCREEN_BOUND for a size that is not px) plus its end padding;
// - or it ends before the padding box's start: the same sum, exact when nothing precedes the text, plus an upper bound of its
//   length (its characters times the font size in Ahem, else SCREEN_BOUND), is at most minus the start padding.
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
const inFlow = (c: Child): boolean => c.kind === 'text' || (keywordOf(c, 'display') !== 'none' && !outOfFlow(c));
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

/** Whether e takes its size in ax from its parent, so that a zero-size parent leaves it zero-size too. */
function inheritsZero(e: ResolvedElement, parent: ResolvedElement, ax: Axis): boolean {
  if (keepsArea(e, ax)) return false;
  if (hasPercent(valueOf(e, ax)) || hasPercent(valueOf(e, `max-${ax}`))) return true;
  if (!isAuto(valueOf(e, ax))) return false;
  const position = keywordOf(e, 'position');
  if (position === 'absolute' || position === 'fixed') return false;
  // A flex or grid parent stretches or shrinks an auto size (a clip box's automatic minimum size is 0).
  const pd = keywordOf(parent, 'display');
  if (FLEX.includes(pd) || GRID.includes(pd)) return true;
  // An auto height is its content's; a float or an atomic inline shrinks to fit its content.
  if (ax === 'height' || keywordOf(e, 'float') !== 'none' || ATOMIC.includes(keywordOf(e, 'display'))) return false;
  return true;
}

/** Whether a line box of text in e can have height: 0 for a zero line-height or font size, else positive (1 for normal). */
function lineFloor(e: ResolvedElement): number {
  const size = pxOf(valueOf(e, 'font-size')) ?? 0;
  const lh = valueOf(e, 'line-height');
  if (lh === undefined || size === 0) return 0;
  if (lh.kind === 'keyword') return lh.value === 'normal' ? 1 : 0;
  if (lh.kind === 'number') return Math.max(0, lh.value * size);
  return Math.max(0, pxOf(lh) ?? 1);
}

/** An upper bound of a box's content size in ax: its px size within its px max and min sizes, else SCREEN_BOUND. */
function sizeBound(e: ResolvedElement, parent: ResolvedElement, ax: Axis): number {
  const pd = keywordOf(parent, 'display');
  const main: Axis = keywordOf(parent, 'flex-direction').startsWith('column') ? 'height' : 'width';
  const grow = valueOf(e, 'flex-grow');
  // A flex item that grows, or one whose flex-basis sets its main size, is not held to its width or height.
  if (FLEX.includes(pd) && main === ax && ((grow?.kind === 'number' && grow.value > 0) || !isAuto(valueOf(e, 'flex-basis')))) return SCREEN_BOUND;
  const size = pxOf(valueOf(e, ax));
  const max = pxOf(valueOf(e, `max-${ax}`));
  const upper = size === null ? max : max === null ? size : Math.min(size, max);
  if (upper === null) return SCREEN_BOUND;
  const [a, b] = sidesOf(ax, false);
  const inner = keywordOf(e, 'box-sizing') === 'border-box' ? px0(e, `padding-${a}`) + px0(e, `padding-${b}`) + px0(e, `border-${a}-width`) + px0(e, `border-${b}-width`) : 0;
  return Math.max(pxOf(valueOf(e, `min-${ax}`)) ?? 0, upper) - inner;
}

/** A lower bound of a box's outer size in ax (margin box), from px sizes: its size within its min and max, padding, border and margins. */
function outerFloor(e: ResolvedElement, ax: Axis, shrinks: boolean, basis: Value | undefined = valueOf(e, ax)): number {
  const [a, b] = sidesOf(ax, false);
  const edges = px0(e, `padding-${a}`) + px0(e, `padding-${b}`) + px0(e, `border-${a}-width`) + px0(e, `border-${b}-width`);
  const size = shrinks ? null : pxOf(basis);
  const max = pxOf(valueOf(e, `max-${ax}`));
  const min = pxOf(valueOf(e, `min-${ax}`)) ?? 0;
  const content = Math.max(min, size === null ? 0 : max === null ? size : Math.min(size, max));
  const box = keywordOf(e, 'box-sizing') === 'border-box' ? Math.max(content, edges) : content + edges;
  // Margins do not collapse along a flex or inline line; a negative one counts.
  return box + (pxOf(valueOf(e, `margin-${a}`)) ?? 0) + (pxOf(valueOf(e, `margin-${b}`)) ?? 0);
}

/** The px widths of a grid's explicit columns (px lengths and repeat() of them), or null for any other track list. */
function pxTracks(e: ResolvedElement): number[] | null {
  const v = valueOf(e, 'grid-template-columns');
  if (v === undefined) return null;
  const out: number[] = [];
  const src = valueToString(v).replace(/repeat\(\s*(\d+)\s*,([^()]*)\)/g, (_, n: string, list: string) => Array.from({ length: Number(n) }, () => list.trim()).join(' '));
  for (const t of src.trim().split(/\s+/)) {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(t);
    if (m === null) return null;
    out.push(Number(m[1]));
  }
  return out.length === 0 ? null : out;
}

/** An upper bound of a text's advance in px: its collapsed characters times the font size in Ahem (every glyph 1em), else SCREEN_BOUND. */
function advanceBound(e: ResolvedElement, value: string): number {
  const size = pxOf(valueOf(e, 'font-size'));
  const spaced = ['letter-spacing', 'word-spacing'].some((p) => { const v = valueOf(e, p); return !(v === undefined || isZero(v) || (v.kind === 'keyword' && v.value === 'normal')); });
  if (size === null || spaced || text(valueOf(e, 'font-family')) !== 'Ahem') return SCREEN_BOUND;
  return value.replace(/\s+/g, ' ').trim().length * size;
}

/** Where a text starts, relative to the clip box's content box start corner, in the inline (x) and block (y) axes. */
type Start = {
  /** Lower bounds, or null once something unknown (a rotation, a percentage offset, fixed positioning) can have moved it anywhere. */
  readonly x: number | null;
  readonly y: number | null;
  /** Whether x and y are exact too: nothing of unknown size precedes the text and every term is a px value. */
  readonly exactX: boolean;
  readonly exactY: boolean;
  /** The last margin-top counted in a run of margins that collapse together (a first child's with its parent's). */
  readonly margin: number;
};
const add = (v: number | null, d: number | null): number | null => (v === null || d === null ? null : v + d);

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
  // A percentage padding resolves against a width no larger than SCREEN_BOUND.
  const padBound = (p: string): number => { const v = valueOf(el, p); return v?.kind === 'percentage' ? Math.max(0, v.value / 100) * SCREEN_BOUND : px0(el, p); };
  const reachX = sizeBound(el, parent, 'width') + padBound(`padding-${endX}`);
  const reachY = sizeBound(el, parent, 'height') + padBound('padding-bottom');
  const [padStartX, padTop] = [px0(el, `padding-${startX}`), px0(el, 'padding-top')];
  const positioned = keywordOf(el, 'position') !== 'static';
  type Found = { readonly text: string; readonly why: string } | null;

  /** A path box's own move: margins, border, padding, its position offsets and its transform. */
  const own = (e: ResolvedElement, st: Start, collapses: boolean, cbIsClip: boolean): Start | string => {
    let { x, y, exactX, exactY, margin } = st;
    const position = keywordOf(e, 'position');
    if (position === 'fixed' || position === 'sticky') return { x: null, y: null, exactX: false, exactY: false, margin: 0 };
    if (position === 'absolute') {
      if (!cbIsClip) return { x: null, y: null, exactX: false, exactY: false, margin: 0 };
      // Against the clip box's padding box: an inset in px places it there; an auto inset keeps its static position.
      const sx = valueOf(e, startX);
      const sy = valueOf(e, 'top');
      if (!isAuto(sx)) [x, exactX] = pxOf(sx) === null ? [null, false] : [(pxOf(sx) as number) - padStartX, true];
      else if (!isAuto(valueOf(e, endX))) [x, exactX] = [null, false];
      if (!isAuto(sy)) [y, exactY] = pxOf(sy) === null ? [null, false] : [(pxOf(sy) as number) - padTop, true];
      else if (!isAuto(valueOf(e, 'bottom'))) [y, exactY] = [null, false];
    }
    if (position === 'relative') {
      const offset = (a: string, b: string): number | null => {
        const [va, vb] = [valueOf(e, a), valueOf(e, b)];
        if (!isAuto(va)) return pxOf(va);
        if (!isAuto(vb)) return pxOf(vb) === null ? null : -(pxOf(vb) as number);
        return 0;
      };
      x = add(x, offset(startX, endX));
      y = add(y, offset('top', 'bottom'));
    }
    const tf = valueOf(e, 'transform');
    if (tf !== undefined && tf.kind === 'other' && tf.type === TRANSFORM_LIST_TYPE) {
      for (const f of transformFunctionsOf(tf.text)) {
        if (f.kind === 'scale' && (f.sx === 0 || f.sy === 0)) return `${e.element.address} has transform ${text(tf)}, which leaves it no area`;
        if (f.kind === 'translate') {
          const tx = f.x.unit === 'px' ? (rtl ? -f.x.value : f.x.value) : null;
          x = add(x, tx);
          y = add(y, f.y.unit === 'px' ? f.y.value : null);
        } else if (!(f.kind === 'rotate' && f.deg % 360 === 0) && !(f.kind === 'scale' && f.sx === 1 && f.sy === 1)) [x, y, exactX, exactY] = [null, null, false, false];
      }
    } else if (tf !== undefined && !(tf.kind === 'keyword' && tf.value === 'none')) [x, y, exactX, exactY] = [null, null, false, false];
    const term = (p: string, exact: boolean): [number, boolean] => {
      const v = valueOf(e, p);
      // A border width counts only under a drawn style; its keywords are Chrome's 1, 3 and 5 px.
      if (p.startsWith('border-')) {
        if (['none', 'hidden'].includes(keywordOf(e, p.replace('-width', '-style')))) return [0, exact];
        const named = { thin: 1, medium: 3, thick: 5 }[v?.kind === 'keyword' ? v.value : ''];
        if (named !== undefined) return [named, exact];
      }
      if (pxOf(v) !== null) return [pxOf(v) as number, exact];
      return [0, exact && (v === undefined || isZero(v))];
    };
    let d: number;
    [d, exactX] = term(`margin-${startX}`, exactX);
    x = add(x, d);
    for (const p of [`border-${startX}-width`, `padding-${startX}`]) { [d, exactX] = term(p, exactX); x = add(x, Math.max(0, d)); }
    // A margin-top that collapses with its parent's adds only what it exceeds the run by.
    const [mt, mtExact] = term('margin-top', exactY);
    exactY = mtExact && !(collapses && mt < 0);
    y = add(y, collapses ? Math.max(0, mt - margin) : mt);
    margin = collapses ? Math.max(margin, mt) : mt;
    for (const p of ['border-top-width', 'padding-top']) {
      [d, exactY] = term(p, exactY);
      y = add(y, Math.max(0, d));
      if (d > 0) margin = 0;
    }
    return { x, y, exactX, exactY, margin };
  };

  /** What the content of e before its child c adds to where c starts. */
  const before = (e: ResolvedElement, c: Child, st: Start): Start => {
    const prior = e.children.slice(0, e.children.indexOf(c)).filter(inFlow);
    if (prior.length === 0) return st;
    let { x, y } = st;
    const d = keywordOf(e, 'display');
    const dir = keywordOf(e, 'flex-direction');
    const ordered = e.children.every((k) => k.kind === 'text' || text(valueOf(k, 'order')) === '0');
    const elements = prior.filter((k): k is ResolvedElement => k.kind === 'element');
    if (FLEX.includes(d) && keywordOf(e, 'flex-wrap') === 'nowrap' && START_JUSTIFY.includes(keywordOf(e, 'justify-content')) && ordered && (dir === 'row' || dir === 'column')) {
      const ax: Axis = dir === 'row' ? 'width' : 'height';
      const gap = pxOf(valueOf(e, ax === 'width' ? 'column-gap' : 'row-gap')) ?? 0;
      const sum = elements.reduce((n, k) => {
        const basis = isAuto(valueOf(k, 'flex-basis')) ? valueOf(k, ax) : valueOf(k, 'flex-basis');
        const shrink = valueOf(k, 'flex-shrink');
        return n + outerFloor(k, ax, !(shrink?.kind === 'number' && shrink.value === 0), basis);
      }, 0) + gap * prior.length;
      if (ax === 'width') x = add(x, sum);
      else y = add(y, sum);
    } else if (GRID.includes(d)) {
      const tracks = pxTracks(e);
      const placed = keywordOf(e, 'grid-auto-flow') === 'row' && ordered && e.children.every((k) => k.kind === 'text' || ['grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end'].every((p) => keywordOf(k, p) === 'auto'));
      if (tracks !== null && placed && START_JUSTIFY.includes(keywordOf(e, 'justify-content')) && c.kind === 'element') {
        const col = prior.length % tracks.length;
        x = add(x, tracks.slice(0, col).reduce((n, t) => n + t, 0) + col * (pxOf(valueOf(e, 'column-gap')) ?? 0));
      }
    } else if (!FLEX.includes(d)) {
      // Block flow: block-level boxes before c stack above it; inline-blocks before it on a line that does not wrap sit beside it.
      const line = prior.slice(prior.findLastIndex((k) => k.kind === 'element' && (k.element.tag === 'br' || !isInlineLevel(k))) + 1);
      const blocks = elements.filter((k) => !isInlineLevel(k) && keywordOf(k, 'float') === 'none');
      if (c.kind === 'text' || isInlineLevel(c)) {
        if (keywordOf(e, 'text-wrap-mode') === 'nowrap') x = add(x, line.reduce((n, k) => n + (k.kind === 'element' && ATOMIC.includes(keywordOf(k, 'display')) ? outerFloor(k, 'width', false) : 0), 0));
      }
      y = add(y, blocks.reduce((n, k) => n + outerFloor(k, 'height', false) - (pxOf(valueOf(k, 'margin-top')) ?? 0) - (pxOf(valueOf(k, 'margin-bottom')) ?? 0), 0));
    }
    return { x, y, exactX: false, exactY: false, margin: 0 };
  };

  const judge = (e: ResolvedElement, value: string, id: string, st: Start, lead: boolean, inner: boolean): Found => {
    const at = inner ? e.element.address : 'it';
    if (lineFloor(e) === 0 && !keepsArea(el, 'height')) return { text: id, why: `${at === 'it' ? 'its' : `${at}'s`} line box is empty (line-height ${text(valueOf(e, 'line-height'))}, font-size ${text(valueOf(e, 'font-size'))})` };
    let { x, exactX } = st;
    const indent = valueOf(e, 'text-indent');
    // A text-indent moves the first line of its block container, which a text that is its block's first content starts.
    if (lead && !isInlineLevel(e) && indent !== undefined && !isZero(indent)) {
      if (pxOf(indent) !== null) x = add(x, pxOf(indent));
      else if (indent.kind === 'percentage' && !inner && indent.value >= 100 && px0(el, `padding-${endX}`) === 0) return { text: id, why: `it has text-indent ${text(indent)}, which starts the text at its content box's end` };
      else [x, exactX] = [indent.kind === 'percentage' && indent.value > 0 ? x : null, false];
    }
    const moved = text(indent) !== '' && lead && !isInlineLevel(e) && !isZero(indent) ? ` (text-indent ${text(indent)} included)` : '';
    if (x !== null && !scrollsX && x >= reachX) return { text: id, why: `the text starts at least ${x}px from its content box's start${moved}, at or past its padding box's end (${reachX >= SCREEN_BOUND ? `wider than any screen, ${SCREEN_BOUND}px` : `${reachX}px`})` };
    if (st.y !== null && !scrollsY && st.y >= reachY) return { text: id, why: `the text starts at least ${st.y}px below its content box's top, at or past its padding box's bottom (${reachY >= SCREEN_BOUND ? `taller than any screen, ${SCREEN_BOUND}px` : `${reachY}px`})` };
    if (x !== null && exactX && x + advanceBound(e, value) <= -padStartX) return { text: id, why: `the text starts ${x}px from its content box's start${moved} and ends before its padding box's start` };
    if (st.y !== null && st.exactY && st.y + SCREEN_BOUND <= -padTop) return { text: id, why: `the text starts ${st.y}px above its content box's top, more than any screen's height above its padding box` };
    return null;
  };

  const visit = (e: ResolvedElement, st0: Start, first: boolean, inner: boolean, cbIsClip: boolean, collapses: boolean): Found => {
    if (keywordOf(e, 'display') === 'none') return null;
    let st = st0;
    if (inner) {
      const moved = own(e, st, collapses, cbIsClip);
      if (typeof moved === 'string') { const t = firstText(e); return t === null ? null : { text: t, why: moved }; }
      st = moved;
    }
    const d = keywordOf(e, 'display');
    const flow = !FLEX.includes(d) && !GRID.includes(d) && !isInlineLevel(e);
    const sealed = !inner || px0(e, 'padding-top') > 0 || (px0(e, 'border-top-width') > 0 && !['none', 'hidden'].includes(keywordOf(e, 'border-top-style')));
    for (const c of e.children) {
      if (c.kind === 'element' && keywordOf(c, 'display') === 'none') continue;
      const lead = e.children.filter(inFlow)[0] === c;
      const here = before(e, c, st);
      const found = c.kind === 'text'
        ? judge(e, c.text, c.node.address, here, lead, inner)
        : visit(c, here, first && lead, true, inner ? cbIsClip && keywordOf(e, 'position') === 'static' : positioned, flow && lead && !sealed);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(el, { x: 0, y: 0, exactX: true, exactY: true, margin: 0 }, true, false, positioned, false);
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
  for (const c of parent.children) {
    if (c.kind !== 'element' || keywordOf(c, 'display') === 'none') continue;
    const host = clipViewCause(c, propagated);
    const hidden = host === null ? null : clipViewHidesText(c, parent);
    if (host !== null && hidden !== null) refuse(c, host, hidden, targets, diagnostics, reported);
    for (const ax of ['width', 'height'] as const) {
      const zero = ownZero(c, parent, ax);
      if (zero === null) continue;
      const why = `its ancestor ${c.element.address} has ${zero}, which can leave it no area too`;
      const visit = (e: ResolvedElement): void => {
        for (const d of e.children) {
          if (d.kind !== 'element' || keywordOf(d, 'display') === 'none' || !inheritsZero(d, e, ax)) continue;
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
