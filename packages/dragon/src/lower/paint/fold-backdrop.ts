// PNT1-opacity-b: where a folded fill's backdrop is provably its ancestors' background colours and nothing else, so native may draw
// it as Chrome's opaque bytes over that backdrop (emit/paint/background.ts). A folded box is its own stacking context, painted after
// every in-flow box of the enclosing context, so any other paint its border box can overlap lies beneath it: an ancestor's image,
// border, shadow or text, or a sibling's or cousin's box. Proven without layout: every box on the path from the root is in flow with
// no negative margin or offset, each ancestor paints only a square, unclipped background colour, and every other box beside the
// path either paints nothing or is a bounded leaf or container that flow keeps clear of it. Anything else keeps the platform blend.
import type { ResolvedElement } from '../../analysis/resolve.ts';
import { SIDES } from '../../css/properties.ts';
import { opacityOf } from '../../css/properties/effects.ts';
import { usedColors } from './colors.ts';

/** Longhands whose value other than the listed ones paints outside the border box, layers the box or moves it. */
const PLAIN: readonly (readonly [string, readonly string[]])[] = [
  ['box-shadow', ['none']], ['filter', ['none']], ['backdrop-filter', ['none']], ['mix-blend-mode', ['normal']], ['transform', ['none']],
  ['rotate', ['none']], ['scale', ['none']], ['translate', ['none']], ['perspective', ['none']], ['transform-style', ['flat']],
  ['will-change', ['auto']], ['float', ['none']], ['outline-style', ['none']], ['display', ['block', 'flex']],
];
/** Longhands an ancestor must also leave at these values: its one paint under the path is a square border-box colour. */
const ANCESTOR: readonly (readonly [string, readonly string[]])[] = [
  ['background-image', ['none']], ['border-image-source', ['none']], ['mask-image', ['none']], ['clip-path', ['none']], ['clip', ['auto']],
  ['background-clip', ['border-box']], ['overflow-x', ['visible']], ['overflow-y', ['visible']],
];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
const OFFSETS = ['top', 'right', 'bottom', 'left'] as const;

/** The addresses of the elements whose folded fill has a provable backdrop (see the header), walked from the root. */
export function provableFoldBackdrops(root: ResolvedElement, moving: ReadonlySet<string>): ReadonlySet<string> {
  const out = new Set<string>();
  const visit = (el: ResolvedElement): void => {
    if (!plainBox(el, moving) || !ancestorPaint(el)) return;
    const kids = el.children.filter((c): c is ResolvedElement => c.kind === 'element' && !hidden(c));
    if (el.children.some((c) => c.kind === 'text' && c.text.trim() !== '')) return;
    const across = kw(el, 'display') === 'flex' && !(kw(el, 'flex-direction') ?? 'row').startsWith('column');
    for (const k of kids) {
      const others = kids.filter((o) => o !== k);
      if (k.children.length === 0) {
        // A leaf stays in its own slot of the flow, which no other in-flow box overlaps; in a column the others' content stays
        // in their own bands too, while in a row only leaves and fixed-width boxes their content fits across keep out of the slot.
        if (plainBox(k, moving) && others.every((o) => inert(o) || (across ? keepsSlot(o, moving) : bounded(o, moving)))) out.add(k.element.address);
        continue;
      }
      // A path container's descendants may leave its slot sideways, so in a row only boxes that paint nothing may sit beside it;
      // in a column its height must hold them, and the others must keep to their bands.
      if (others.every((o) => inert(o)) || (!across && holdsHeight(k) && others.every((o) => bounded(o, moving)))) visit(k);
    }
  };
  visit(root);
  return out;
}

function kw(el: ResolvedElement, p: string): string | null {
  const v = el.props.get(p as never)?.value;
  return v === undefined ? null : v.kind === 'keyword' ? v.value : '';
}

function keeps(el: ResolvedElement, rules: readonly (readonly [string, readonly string[]])[]): boolean {
  return rules.every(([p, ok]) => { const k = kw(el, p); return k === null || ok.includes(k); });
}

function zero(el: ResolvedElement, p: string, autoOk: boolean): boolean {
  const v = el.props.get(p as never)?.value;
  if (v === undefined) return true;
  if (v.kind === 'keyword') return autoOk && v.value === 'auto';
  return (v.kind === 'length' || v.kind === 'percentage') && v.value === 0;
}

function nonNegative(el: ResolvedElement, p: string): boolean {
  const v = el.props.get(p as never)?.value;
  if (v === undefined) return true;
  if (v.kind === 'keyword') return v.value === 'auto';
  return (v.kind === 'length' || v.kind === 'percentage') && v.value >= 0;
}

function hidden(el: ResolvedElement): boolean {
  return kw(el, 'display') === 'none';
}

/** In flow where flow put it, unmoved, with nothing painted outside its border box. */
function plainBox(el: ResolvedElement, moving: ReadonlySet<string>): boolean {
  if (moving.has(el.element.address) || !keeps(el, PLAIN)) return false;
  const position = kw(el, 'position') ?? 'static';
  if (position !== 'static' && (position !== 'relative' || !OFFSETS.every((s) => zero(el, s, true)))) return false;
  return SIDES.every((s) => nonNegative(el, `margin-${s}`));
}

/** An ancestor on the path: unlayered, one square background colour, no painted border and no text. */
function ancestorPaint(el: ResolvedElement): boolean {
  const o = el.props.get('opacity')?.value;
  if (o !== undefined && opacityOf(o) !== 1) return false;
  if (!keeps(el, ANCESTOR)) return false;
  if (!SIDES.every((s) => unpaintedBorder(el, s))) return false;
  return CORNERS.every((c) => zero(el, `border-${c}-radius`, false));
}

function unpaintedBorder(el: ResolvedElement, side: string): boolean {
  const style = kw(el, `border-${side}-style`);
  return style === null || style === 'none' || style === 'hidden' || zero(el, `border-${side}-width`, false);
}

/** A box beside the path that paints nothing at all: no colour, image, border, shadow, outline or text, and nothing inside that does. */
function inert(el: ResolvedElement): boolean {
  if (hidden(el)) return true;
  if (usedColors(el)['background-color'].alpha !== 0 || !keeps(el, [['background-image', ['none']], ['box-shadow', ['none']], ['outline-style', ['none']], ['border-image-source', ['none']]])) return false;
  if (!SIDES.every((s) => unpaintedBorder(el, s))) return false;
  return el.children.every((c) => (c.kind === 'text' ? c.text.trim() === '' : inert(c)));
}

/** A box beside the path in a column whose paint stays inside its own band: a plain leaf, or a container whose height holds its content. */
function bounded(el: ResolvedElement, moving: ReadonlySet<string>): boolean {
  if (hidden(el) || inert(el)) return true;
  if (!plainBox(el, moving)) return false;
  if (el.children.some((c) => c.kind === 'text' && c.text.trim() !== '')) return false;
  const kids = el.children.filter((c): c is ResolvedElement => c.kind === 'element');
  return kids.length === 0 || (holdsHeight(el) && kids.every((k) => bounded(k, moving)));
}

/** A box beside a leaf in a row whose paint keeps to its own slot: a plain leaf, or a fixed-width container its content fits across. */
function keepsSlot(el: ResolvedElement, moving: ReadonlySet<string>): boolean {
  if (!plainBox(el, moving)) return false;
  if (el.children.length === 0) return true;
  const w = px(el, 'width');
  return w !== null && fitsAcross(el, w, moving);
}

/** Whether every in-flow descendant of a box of border-box width w fits inside its content box sideways (lengths only). */
function fitsAcross(el: ResolvedElement, w: number, moving: ReadonlySet<string>): boolean {
  const own = sideways(el);
  if (own === null) return false;
  const content = w - own;
  if (el.children.some((c) => c.kind === 'text' && c.text.trim() !== '')) return false;
  const kids = el.children.filter((c): c is ResolvedElement => c.kind === 'element' && !hidden(c));
  const outer: number[] = [];
  for (const k of kids) {
    if (inert(k)) continue;
    const width = px(k, 'width');
    const ml = px(k, 'margin-left'), mr = px(k, 'margin-right');
    const extra = sideways(k);
    if (!plainBox(k, moving) || width === null || ml === null || mr === null || extra === null) return false;
    const border = (kw(k, 'box-sizing') ?? 'content-box') === 'border-box' ? width : width + extra;
    if (!fitsAcross(k, border, moving)) return false;
    outer.push(ml + border + mr);
  }
  const across = kw(el, 'display') === 'flex' && !(kw(el, 'flex-direction') ?? 'row').startsWith('column');
  // A row lays its items side by side (an inert box takes no paint but may take room, so a row with one is not proven).
  if (across && outer.length !== kids.length) return false;
  const gap = across ? px(el, 'column-gap') ?? 0 : 0;
  const need = across ? outer.reduce((a, b) => a + b, 0) + gap * Math.max(0, outer.length - 1) : Math.max(0, ...outer);
  return need <= content;
}

/** A box's padding and painted border widths across, in px, or null when one is not a px length. */
function sideways(el: ResolvedElement): number | null {
  let n = 0;
  for (const s of ['left', 'right'] as const) {
    const pad = px(el, `padding-${s}`);
    const border = unpaintedBorder(el, s) ? 0 : px(el, `border-${s}-width`);
    if (pad === null || border === null) return null;
    n += pad + border;
  }
  return n;
}

/** A length in px, 0 for an unset longhand, or null for anything else (a percentage, auto, calc). */
function px(el: ResolvedElement, p: string): number | null {
  const v = el.props.get(p as never)?.value;
  if (v === undefined) return 0;
  return v.kind === 'length' && v.unit === 'px' ? v.value : null;
}

/** Whether a box's height grows to its in-flow content: auto, uncapped and with no ratio. */
function holdsHeight(el: ResolvedElement): boolean {
  return (kw(el, 'height') ?? 'auto') === 'auto' && (kw(el, 'max-height') ?? 'none') === 'none' && (kw(el, 'aspect-ratio') ?? 'auto') === 'auto';
}
