// A box that clips its overflow, or clips a background colour to its text (#456), hosts its children in a native clip view over its
// padding box (lower/paint/clip.ts). A text view that clip view leaves no pixel of leaves the native accessibility tree (Android's
// View.isVisibleToUser is false when ViewGroup.getChildVisibleRect is empty, so TalkBack skips it), while Chrome keeps clipped text
// in its accessibility tree. The compiler has no layout (the engine runs on the device, at the device's size), so the native targets
// refuse, from computed values, every text whose first line box the clip view cannot be proven to show part of:
// - the clip box's padding box can be empty: a zero width, height, max-width or max-height, or flex-basis in a flex parent without
//   flex-grow, with no positive px min size or end padding to keep area; or it takes its size from a zero-size ancestor (an auto
//   width of an in-flow block, a percentage size, or an auto size a flex or grid parent stretches or shrinks);
// - its block size is fixed (a height, a max-height, an aspect-ratio, or a flex or grid parent), and the text is not the first
//   content of the clip box with no margin, border or padding above it: later lines and blocks may sit wholly below the clip;
// - the text follows other content on its line and does not wrap (text-wrap-mode: nowrap), so it may sit wholly past the end;
// - its line box can be empty (line-height or font-size 0) with no bottom padding to show the glyphs in;
// - a negative text-indent, one of at least 100%, or one of at least the clip box's px width moves its first line out;
// - a box between them moves it out: fixed positioning, a non-zero absolute inset, a horizontal relative or sticky offset, a negative
//   horizontal margin, a transform other than scales of at least 1 about a point in the box and vertical translations, or vertical
//   offsets, translations and negative margins (all of the clip box's) that add up to the text's line height or more (a fixed block
//   size allows no downward one). On an axis a scroll container scrolls, what lies past the end is reachable, so only the
//   start side is judged there (zero size, negative indents, upward moves). A line box is at least the line height tall: a px line-height, a number times the font size, and
//   for normal half the font size (Chrome's normal line height is the face's ascent plus descent plus line gap).
import type { Longhand } from '../../css/properties.ts';
import { SIDES } from '../../css/properties.ts';
import { TRANSFORM_LIST_TYPE, TRANSFORM_ORIGIN_TYPE, transformFunctionsOf, transformOriginOf } from '../../css/properties/transform.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import { valueToString } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { textClipFillOf } from './gradient.ts';

type Value = ResolvedValue['value'];
type Axis = 'width' | 'height';

const valueOf = (el: ResolvedElement, p: string): Value | undefined => el.props.get(p as Longhand)?.value;
const keywordOf = (el: ResolvedElement, p: string): string => {
  const v = valueOf(el, p);
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};
const text = (v: Value | undefined): string => (v === undefined ? '' : valueToString(v));
const pxOf = (v: Value | undefined): number | null => (v !== undefined && v.kind === 'length' && v.unit === 'px' ? v.value : null);
const isZero = (v: Value | undefined): boolean => v !== undefined && (v.kind === 'length' || v.kind === 'percentage') && v.value === 0;
const isAuto = (v: Value | undefined): boolean => v === undefined || (v.kind === 'keyword' && (v.value === 'auto' || v.value === 'none'));
const hasPercent = (v: Value | undefined): boolean => v !== undefined && (v.kind === 'percentage' || (v.kind === 'other' && v.text.includes('%')));
/** A value that can be negative: a negative length or percentage, or a calculation with a subtraction or a negative term. */
const mayBeNegative = (v: Value | undefined): boolean => v !== undefined && ((v.kind === 'length' || v.kind === 'percentage' || v.kind === 'number') ? v.value < 0 : v.kind === 'other' && v.text.includes('-'));
const FLEX = ['flex', 'inline-flex'];
const GRID = ['grid', 'inline-grid'];
const ATOMIC = ['inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'table', 'table-cell'];

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

/** Whether a box keeps a padding box with area in an axis whatever its size resolves to: a positive px min size, or end padding. */
function keepsArea(e: ResolvedElement, ax: Axis): boolean {
  if ((pxOf(valueOf(e, `min-${ax}`)) ?? 0) > 0) return true;
  // Text starts at the start edge of the content box, so the padding after it (either side, for either direction) shows it.
  if (ax === 'width') return (pxOf(valueOf(e, 'padding-left')) ?? 0) > 0 && (pxOf(valueOf(e, 'padding-right')) ?? 0) > 0;
  return (pxOf(valueOf(e, 'padding-bottom')) ?? 0) > 0;
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

/** The height a line box of text in e is at least, in px; 0 when it is not known to be more. */
function lineFloor(e: ResolvedElement): number {
  const size = pxOf(valueOf(e, 'font-size')) ?? 0;
  const lh = valueOf(e, 'line-height');
  if (lh === undefined) return 0;
  if (lh.kind === 'keyword' && lh.value === 'normal') return size / 2;
  if (lh.kind === 'number') return Math.max(0, lh.value * size);
  return Math.max(0, pxOf(lh) ?? 0);
}

/** Whether e's subtree, in flow order, starts with content (text or a box) before the child `upTo`; display: none and out-of-flow boxes take no place. */
function contentBefore(e: ResolvedElement, upTo: ResolvedElement['children'][number]): boolean {
  for (const c of e.children) {
    if (c === upTo) return false;
    if (c.kind === 'text') return true;
    if (keywordOf(c, 'display') === 'none') continue;
    const position = keywordOf(c, 'position');
    if (position === 'absolute' || position === 'fixed') continue;
    return true;
  }
  return false;
}

/** The space above e's content box (margin-top, border-top, padding-top) when it may not be zero, as text; null when it is zero. */
function spaceAbove(e: ResolvedElement): string | null {
  for (const p of ['margin-top', 'padding-top']) {
    // A negative margin moves the text up, which the pull-up budget judges.
    const v = valueOf(e, p);
    if (!isZero(v) && !isAuto(v) && !((v?.kind === 'length' || v?.kind === 'percentage') && v.value < 0)) return `${p} ${text(v)}`;
  }
  if (!['none', 'hidden'].includes(keywordOf(e, 'border-top-style')) && !isZero(valueOf(e, 'border-top-width'))) return `border-top-width ${text(valueOf(e, 'border-top-width'))}`;
  return null;
}

/** The vertical translation of a transform in px, or a reason it can move the box out of sight. */
function transformShift(e: ResolvedElement): { readonly dy: number } | { readonly why: string } {
  const v = valueOf(e, 'transform');
  if (v === undefined || (v.kind === 'keyword' && v.value === 'none')) return { dy: 0 };
  const why = { why: `${e.element.address} has transform ${text(v)}, which can move it out of the clip` };
  if (v.kind !== 'other' || v.type !== TRANSFORM_LIST_TYPE) return why;
  const origin = valueOf(e, 'transform-origin');
  const o = origin !== undefined && origin.kind === 'other' && origin.type === TRANSFORM_ORIGIN_TYPE ? transformOriginOf(origin.text) : null;
  const inside = o !== null && [o.x, o.y].every((l) => l.unit === '%' && l.value >= 0 && l.value <= 100);
  let dy = 0;
  for (const f of transformFunctionsOf(v.text)) {
    // A scale of at least 1 about a point in the box covers the box it scales; anything else may leave it.
    if (f.kind === 'scale' && f.sx >= 1 && f.sy >= 1 && inside) continue;
    if (f.kind === 'rotate' && f.deg % 360 === 0) continue;
    if (f.kind === 'translate' && f.x.value === 0 && f.y.unit === 'px') {
      dy += Math.abs(f.y.value);
      continue;
    }
    return why;
  }
  return { dy };
}

/** The first text in a clip box that a native clip view over its padding box may not show any of, and why; null when every text shows. */
export function clipViewHidesText(el: ResolvedElement, parent: ResolvedElement): { readonly text: string; readonly why: string } | null {
  for (const ax of ['width', 'height'] as const) {
    const zero = ownZero(el, parent, ax);
    if (zero === null) continue;
    const t = firstText(el);
    if (t !== null) return { text: t, why: `its ${zero} can leave its padding box no area` };
  }
  const pd = keywordOf(parent, 'display');
  // A scroll container's user scrolls to what lies past its end on a scrolling axis, so only the start side is judged there.
  const scrolls = (p: string): boolean => ['auto', 'scroll'].includes(keywordOf(el, p));
  const [scrollsX, scrollsY] = [scrolls('overflow-x'), scrolls('overflow-y')];
  const fixedBlock = !scrollsY && (!isAuto(valueOf(el, 'height')) || !isAuto(valueOf(el, 'max-height')) || !isAuto(valueOf(el, 'aspect-ratio')) || FLEX.includes(pd) || GRID.includes(pd));
  const fixedReason = !isAuto(valueOf(el, 'height')) ? `height ${text(valueOf(el, 'height'))}` : !isAuto(valueOf(el, 'max-height')) ? `max-height ${text(valueOf(el, 'max-height'))}` : !isAuto(valueOf(el, 'aspect-ratio')) ? `aspect-ratio ${text(valueOf(el, 'aspect-ratio'))}` : `the ${pd} container ${parent.element.address}, which sizes it`;
  const width = pxOf(valueOf(el, 'width'));
  // Text starts at the content box's start edge; an indent of the content width plus the end padding puts it past the padding box.
  const reach = width === null ? null : width + Math.min(pxOf(valueOf(el, 'padding-left')) ?? 0, pxOf(valueOf(el, 'padding-right')) ?? 0);
  // Negative vertical margins anywhere in the clip box pull what follows them up; a negative horizontal one moves content sideways.
  let pullUp = 0;
  let sideways: string | null = null;
  const margins = (e: ResolvedElement, root: boolean): void => {
    if (keywordOf(e, 'display') === 'none') return;
    if (!root) {
      for (const s of SIDES) {
        const m = valueOf(e, `margin-${s}`);
        if (!mayBeNegative(m)) continue;
        const px = pxOf(m);
        if ((s === 'top' || s === 'bottom') && px !== null) pullUp += -px;
        else sideways ??= `${e.element.address} has margin-${s} ${text(m)}, which can move content out of the clip`;
      }
    }
    for (const c of e.children) if (c.kind === 'element') margins(c, false);
  };
  margins(el, true);
  type Found = { readonly text: string; readonly why: string } | null;
  // path: the boxes from the clip box down to the text's parent; first: whether the text is the first content of the clip box.
  const visit = (e: ResolvedElement, inner: boolean, first: boolean, lineStart: boolean, down: number, up: number, shifted: string | null): Found => {
    if (keywordOf(e, 'display') === 'none') return null;
    let why = shifted;
    let [d, u] = [down, up];
    const at = inner ? e.element.address : 'it';
    const indent = valueOf(e, 'text-indent');
    if (why === null && indent !== undefined) {
      if (mayBeNegative(indent)) why = `${at} has text-indent ${text(indent)}, which can move its first line out of the clip`;
      else if (indent.kind === 'percentage' && indent.value >= 100) why = `${at} has text-indent ${text(indent)}, at least its width`;
      else if (!scrollsX && reach !== null && (pxOf(indent) ?? 0) > 0 && (pxOf(indent) ?? 0) >= reach) why = `${at} has text-indent ${text(indent)}, at least the clip box's width and end padding, ${reach}px`;
    }
    if (why === null && inner) {
      const position = keywordOf(e, 'position');
      const inset = (s: string): Value | undefined => (isAuto(valueOf(e, s)) || isZero(valueOf(e, s)) ? undefined : valueOf(e, s));
      if (position === 'fixed') why = `${e.element.address} is position: fixed, placed against the viewport, which can be outside the clip`;
      else if (position === 'absolute' && SIDES.some((s) => inset(s) !== undefined)) why = `${e.element.address} is position: absolute with a non-zero inset, which can place it outside the clip`;
      else if (position === 'relative' || position === 'sticky') {
        const side = (['left', 'right'] as const).find((s) => inset(s) !== undefined);
        if (side !== undefined) why = `${e.element.address} is offset by ${side}: ${text(inset(side))}, which can move it out of the clip`;
        for (const s of ['top', 'bottom'] as const) {
          const v = inset(s);
          if (v === undefined || why !== null) continue;
          const px = pxOf(v);
          if (px === null) why = `${e.element.address} is offset by ${s}: ${text(v)}, which can move it out of the clip`;
          else if ((s === 'top') === px > 0) d += Math.abs(px);
          else u += Math.abs(px);
        }
      }
      if (why === null) {
        const t = transformShift(e);
        if ('why' in t) why = t.why;
        else d += t.dy;
      }
      if (why === null && fixedBlock && first && spaceAbove(e) !== null) why = `its block size is fixed by ${fixedReason}, and ${e.element.address} has ${spaceAbove(e)} above its text`;
    }
    const inline = keywordOf(e, 'display') === 'inline';
    let prev: ResolvedElement['children'][number] | null = null;
    for (const c of e.children) {
      const firstHere = first && !contentBefore(e, c);
      // Whether c starts a line: the first content of a block, or after a <br> or a block-level box.
      const startsLine = prev === null ? (!inline || lineStart) : prev.kind === 'element' && (prev.element.tag === 'br' || !keywordOf(prev, 'display').startsWith('inline'));
      if (c.kind === 'text' || (keywordOf(c, 'display') !== 'none' && !['absolute', 'fixed'].includes(keywordOf(c, 'position')))) prev = c;
      if (c.kind === 'element') {
        const found = visit(c, true, firstHere, startsLine, d, u, why);
        if (found !== null) return found;
        continue;
      }
      const id = c.node.address;
      const floor = lineFloor(e);
      const reason = why
        ?? sideways
        ?? (floor === 0 && !keepsArea(el, 'height') ? `${at === 'it' ? 'its' : `${at}'s`} line box can be empty (line-height ${text(valueOf(e, 'line-height'))}, font-size ${text(valueOf(e, 'font-size'))})` : null)
        ?? (fixedBlock && !firstHere ? `its block size is fixed by ${fixedReason}, and the text is not its first content, so it can sit wholly below the clip` : null)
        ?? (fixedBlock && d > 0 ? `its block size is fixed by ${fixedReason}, and the text is moved down ${d}px` : null)
        ?? (!scrollsX && !startsLine && keywordOf(e, 'text-wrap-mode') === 'nowrap' ? `the text does not wrap (text-wrap-mode: nowrap) and follows other content on its line, so it can sit wholly past its end` : null)
        ?? ((scrollsY ? 0 : d) + u + pullUp > 0 && (scrollsY ? 0 : d) + u + pullUp >= floor ? `the text is moved ${(scrollsY ? 0 : d) + u + pullUp}px by offsets, translations and negative margins, at least its line box's ${floor}px` : null);
      if (reason !== null) return { text: id, why: reason };
    }
    return null;
  };
  return visit(el, false, true, true, 0, 0, null);
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
    const manual = `Keep every text of ${at} where its padding box shows part of it whatever the layout (its first content, with nothing moving it out), or clip a box without text.`;
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
